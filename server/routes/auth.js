import { Router } from 'express';
import {
  authenticateSystemUser,
  authenticateHostingUser,
  isHostingUsername,
  getAllowedUsers,
  issueSessionCookie,
  issueUserSessionCookie,
  clearSessionCookie,
  clearUserSessionCookie,
  verifySessionToken,
  verifyUserSessionToken,
  SESSION_COOKIE,
  USER_SESSION_COOKIE
} from '../services/auth.js';
import { getMustChangePassword } from '../services/hostingUserSelf.js';
import { APP_VERSION } from '../version.js';
import { getPublicConfig as getTurnstilePublicConfig, isEnabled as isTurnstileEnabled, getSecretKey, verifyWithCloudflare } from '../services/turnstile.js';

const router = Router();

const attempts = new Map();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 5 * 60 * 1000;

const MIN_FAILED_LOGIN_MS = 5000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function padFailure(startedAt) {
  const elapsed = Date.now() - startedAt;
  if (elapsed < MIN_FAILED_LOGIN_MS) await sleep(MIN_FAILED_LOGIN_MS - elapsed);
}

function isRateLimited(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

router.post('/login', async (req, res) => {
  const startedAt = Date.now();
  const { username, password, turnstileToken } = req.body || {};

  if (getAllowedUsers().length === 0) {
    return res.status(503).json({ error: 'Logowanie wylaczone - AUTH_USERS nie jest ustawiony' });
  }

  if (isRateLimited(req.ip)) {
    return res.status(429).json({ error: 'Zbyt wiele prob logowania - sprobuj ponownie za kilka minut' });
  }

  if (isTurnstileEnabled()) {
    if (!turnstileToken) {
      await padFailure(startedAt);
      return res.status(400).json({ error: 'Wymagana weryfikacja Turnstile' });
    }
    const cfResult = await verifyWithCloudflare(getSecretKey(), turnstileToken, req.ip).catch(() => ({ success: false }));
    if (!cfResult.success) {
      await padFailure(startedAt);
      return res.status(401).json({ error: 'Weryfikacja Turnstile nie powiodla sie - sprobuj ponownie' });
    }
  }

  // Panel klienta (/user/) - te same pola formularza logowania co panel
  // admina, rozgraniczenie po samej konwencji nazwy usera (srv_<id>).
  if (isHostingUsername(username)) {
    const ok = await authenticateHostingUser(username, password);
    if (!ok) {
      await padFailure(startedAt);
      return res.status(401).json({ error: 'Nieprawidlowy uzytkownik lub haslo' });
    }
    issueUserSessionCookie(res, username);
    let mustChangePassword = false;
    try {
      mustChangePassword = await getMustChangePassword(username);
    } catch {
      // Nieznany stan (np. sudoers jeszcze nie odswiezony) - nie blokujemy
      // logowania, panel klienta po prostu pokaze Dashboard zamiast
      // wymuszonej zmiany hasla.
    }
    res.json({ success: true, role: 'user', username, redirect: '/user/', mustChangePassword });
    return;
  }

  const ok = await authenticateSystemUser(username, password);
  if (!ok) {
    await padFailure(startedAt);
    return res.status(401).json({ error: 'Nieprawidlowy uzytkownik lub haslo' });
  }

  issueSessionCookie(res, username);
  res.json({ success: true, role: 'admin', username, redirect: '/' });
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  clearUserSessionCookie(res);
  res.json({ success: true });
});

router.get('/status', (req, res) => {
  const authRequired = getAllowedUsers().length > 0;
  const token = req.cookies?.[SESSION_COOKIE];
  const payload = token ? verifySessionToken(token) : null;
  const turnstile = getTurnstilePublicConfig();
  res.json({
    authRequired,
    username: payload?.username || null,
    version: APP_VERSION,
    turnstile: { enabled: turnstile.enabled, siteKey: turnstile.enabled ? turnstile.siteKey : '' }
  });
});

// Bootstrap dla panelu klienta (/user/) - analogiczne do /status powyzej,
// ale sprawdza USER_SESSION_COOKIE (rola "user"), nie sesje admina.
router.get('/user-status', (req, res) => {
  const authRequired = getAllowedUsers().length > 0;
  const token = req.cookies?.[USER_SESSION_COOKIE];
  const payload = token ? verifyUserSessionToken(token) : null;
  res.json({ authRequired, username: payload?.username || null, version: APP_VERSION });
});

export default router;
