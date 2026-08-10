import crypto from 'crypto';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const SCRIPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts');

const SESSION_COOKIE = 'cd_session';
const USER_SESSION_COOKIE = 'cd_user_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

// Konta hostingowe (panel klienta, /user/) - tylko ta konwencja nazw ma
// dostep, patrz hosting-account-create.sh. Osobna sesja/ciasteczko od
// panelu admina (USER_SESSION_COOKIE), zeby logowanie do jednego nie
// wygaszalo sesji w drugim w tej samej przegladarce.
const HOSTING_USERNAME_RE = /^srv_[0-9]+$/;

function isHostingUsername(username) {
  return typeof username === 'string' && HOSTING_USERNAME_RE.test(username);
}

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'SESSION_SECRET nie jest ustawiony lub jest za krotki (min. 32 znaki). Wygeneruj: openssl rand -hex 32'
    );
  }
  return secret;
}

function sign(payload) {
  const secret = getSecret();
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const hmac = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${hmac}`;
}

// Generyczna weryfikacja podpisu HMAC + wygasniecia - BEZ zadnej wiedzy o
// "sesji panelu" (username/allowlist). To jest bezpieczne do ponownego
// uzycia dla innych podpisywanych ciasteczek (np. bramka Turnstile przed
// phpMyAdmin) - `verify()` ponizej dokleja na to warstwe specyficzna dla
// sesji admina, nie odwrotnie.
function verifyRaw(token) {
  try {
    const secret = getSecret();
    const [data, hmac] = token.split('.');
    if (!data || !hmac) return null;

    const expected = crypto.createHmac('sha256', secret).update(data).digest('base64url');
    const expectedBuf = Buffer.from(expected);
    const hmacBuf = Buffer.from(hmac);
    if (expectedBuf.length !== hmacBuf.length || !crypto.timingSafeEqual(expectedBuf, hmacBuf)) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf-8'));
    if (!payload.exp || Date.now() > payload.exp) return null;

    return payload;
  } catch {
    return null;
  }
}

function verify(token) {
  try {
    const payload = verifyRaw(token);
    if (!payload) return null;

    const allowed = getAllowedUsers();
    if (allowed.length > 0 && !allowed.includes(payload.username)) return null;

    return payload;
  } catch {
    return null;
  }
}

function getAllowedUsers() {
  return (process.env.AUTH_USERS || '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
}

const SUDO_GROUPS = ['wheel'];

async function userHasSudoAccess(username) {
  try {
    const { stdout } = await execFileAsync('id', ['-nG', username]);
    const groups = stdout.trim().split(/\s+/);
    return groups.some((g) => SUDO_GROUPS.includes(g));
  } catch {
    return false;
  }
}

// MUSI isc przez sudo (root) - unix_chkpwd (pomocnik pam_unix.so) pozwala
// sprawdzic CUDZE haslo tylko procesowi root, nigdy zwyklemu userowi (jak
// SVC_USER, ktorym dziala ta usluga) - patrz komentarz w
// server/scripts/pam-login-check.cjs. Bez tego logowanie dzialaloby
// PRZYPADKIEM tylko dla admina = SVC_USER (self-check), a dla kazdego
// innego konta (hostingowego, drugiego admina) zawsze konczyloby sie
// falszywym "Nieprawidlowy uzytkownik lub haslo".
function pamAuthenticate(username, password) {
  return new Promise((resolve) => {
    const child = spawn('sudo', ['-n', `${SCRIPTS_DIR}/pam-login-check.cjs`, username]);
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
    child.stdin.write(password || '');
    child.stdin.end();
  });
}

async function authenticateSystemUser(username, password) {
  const allowed = getAllowedUsers();
  if (!username || !allowed.includes(username)) return false;

  const pamOk = await pamAuthenticate(username, password);
  if (!pamOk) return false;

  return userHasSudoAccess(username);
}

// Panel klienta (/user/) - PAM przeciwko temu samemu systemowemu kontu co
// SSH (patrz hosting-account-create.sh), ale BEZ AUTH_USERS/wheel - to
// osobna, nieuprzywilejowana rola. Explicit "NIE ma sudo" jako dodatkowe
// zabezpieczenie przed pomyleniem roli, gdyby jakis srv_* user kiedys
// trafil do wheel przez pomylke.
async function authenticateHostingUser(username, password) {
  if (!isHostingUsername(username)) return false;

  const pamOk = await pamAuthenticate(username, password);
  if (!pamOk) return false;

  const hasSudo = await userHasSudoAccess(username);
  return !hasSudo;
}

function issueSessionCookie(res, username) {
  const token = sign({ username, exp: Date.now() + SESSION_TTL_MS });
  const secure = (process.env.EXPOSURE || 'local') === 'world';
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    maxAge: SESSION_TTL_MS,
    path: '/'
  });
}

function issueUserSessionCookie(res, username) {
  const token = sign({ username, role: 'user', exp: Date.now() + SESSION_TTL_MS });
  const secure = (process.env.EXPOSURE || 'local') === 'world';
  res.cookie(USER_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    maxAge: SESSION_TTL_MS,
    path: '/'
  });
}

function isSameOrigin(req) {
  const origin = req.headers?.origin;
  if (!origin) return true;

  const allowed = (process.env.ALLOWED_ORIGIN || '').trim();
  if (allowed && origin === allowed) return true;

  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

function clearUserSessionCookie(res) {
  res.clearCookie(USER_SESSION_COOKIE, { path: '/' });
}

function verifySessionToken(token) {
  return verify(token);
}

// Celowo NIE przez verify() (ten dokleja AUTH_USERS - liste adminow, ktora
// nigdy nie zawiera kont hostingowych) - tylko podpis+wygasniecie z
// verifyRaw(), plus wlasny check roli/konwencji nazwy.
function verifyUserSessionToken(token) {
  const payload = verifyRaw(token);
  if (!payload || payload.role !== 'user' || !isHostingUsername(payload.username)) return null;
  return payload;
}

function requireAuth(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return res.status(401).json({ error: 'Brak sesji - zaloguj sie' });

  const payload = verify(token);
  if (!payload) return res.status(401).json({ error: 'Sesja wygasla lub nieprawidlowa - zaloguj sie ponownie' });

  req.user = payload.username;
  next();
}

function requireUserAuth(req, res, next) {
  const token = req.cookies?.[USER_SESSION_COOKIE];
  if (!token) return res.status(401).json({ error: 'Brak sesji - zaloguj sie' });

  const payload = verifyUserSessionToken(token);
  if (!payload) return res.status(401).json({ error: 'Sesja wygasla lub nieprawidlowa - zaloguj sie ponownie' });

  req.hostingUser = payload.username;
  next();
}

export {
  authenticateSystemUser,
  authenticateHostingUser,
  isHostingUsername,
  pamAuthenticate,
  getAllowedUsers,
  isSameOrigin,
  issueSessionCookie,
  issueUserSessionCookie,
  clearSessionCookie,
  clearUserSessionCookie,
  verifySessionToken,
  verifyUserSessionToken,
  requireAuth,
  requireUserAuth,
  SESSION_COOKIE,
  USER_SESSION_COOKIE,
  sign,
  verifyRaw
};
