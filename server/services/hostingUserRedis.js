import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import { getServiceDef, getServiceStatus } from './systemServices.js';

const execFileAsync = promisify(execFile);
const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data');
const DATA_PATH = path.join(DATA_DIR, 'hosting-redis.json');
const SCRIPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts');

// Domyslny limit RAM dla NOWEJ instancji zakladanej samoobslugowo z
// panelu klienta - user nie wybiera wartosci. Podniesienie wyzej to juz
// decyzja admina (karta Redis w panelu admina, adminSetMaxMemoryMb
// ponizej) - std komunikat w panelu klienta "kontaktuj sie z
// Administracja" zamiast pola do edycji.
const DEFAULT_MAX_MEMORY_MB = 256;
const MIN_MAX_MEMORY_MB = 16;
const MAX_MAX_MEMORY_MB = 16384;

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function loadData() {
  try {
    const parsed = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
    return Array.isArray(parsed.instances) ? parsed.instances : [];
  } catch {
    return [];
  }
}

function saveData(instances) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_PATH, JSON.stringify({ instances }, null, 2), { mode: 0o600 });
}

// Ta sama regula 16-znakowego hasla co wszedzie indziej w projekcie
// (lib-gen-password.sh) - zestaw znakow bez cudzyslowow/apostrofow/
// backslasha, bo haslo trafia bezposrednio do configu Redisa
// (requirepass) i do REDISCLI_AUTH w hosting-user-redis-info.sh.
function generatePassword() {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  const special = '!@#%*()_+=-';
  const pick = (set, n) => Array.from({ length: n }, () => set[Math.floor(Math.random() * set.length)]);
  const chars = [...pick(upper, 5), ...pick(lower, 5), ...pick(digits, 3), ...pick(special, 3)];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function getRecord(username) {
  return loadData().find((r) => r.username === username) || null;
}

function upsertRecord(username, fields) {
  const all = loadData();
  const idx = all.findIndex((r) => r.username === username);
  const now = new Date().toISOString();
  if (idx >= 0) {
    all[idx] = { ...all[idx], ...fields, updatedAt: now };
  } else {
    all.push({ username, maxMemoryMb: DEFAULT_MAX_MEMORY_MB, createdAt: now, updatedAt: now, ...fields });
  }
  saveData(all);
  return all.find((r) => r.username === username);
}

// Czy pakiet redis/valkey jest w ogole zainstalowany na serwerze - ten sam
// mechanizm co panel admina (systemServices.js). "found" oznacza, ze
// jednostka systemd redis.service/valkey.service istnieje (dnf install
// jej uzyla), niezaleznie od tego, czy GLOBALNA instancja admina jest
// akurat uruchomiona - prywatne instancje userow sa od niej niezalezne
// (osobny proces, wlasny socket), potrzebuja tylko samej BINARKI na
// dysku.
async function isRedisAvailable() {
  const status = await getServiceStatus(getServiceDef('redis'));
  return !!status.found;
}

// Biezacy stan usera z systemd - bez sudo, samo "systemctl show" na
// dowolnej jednostce nie wymaga uprawnien (ten sam mechanizm co
// getServiceStatus w panelu admina, ale jednostka jest tu DYNAMICZNA
// per-user, wiec nie pasuje do statycznego SERVICE_REGISTRY).
async function getUnitActiveState(username) {
  try {
    const { stdout } = await execFileAsync('systemctl', [
      'show', `cd-user-redis@${username}.service`, '--no-page', '-p', 'ActiveState'
    ]);
    const match = /ActiveState=(\S+)/.exec(stdout);
    return match ? match[1] : 'unknown';
  } catch {
    return 'unknown';
  }
}

function sudoErrorMessage(scriptName, stderr) {
  if (/password is required/i.test(stderr)) {
    return `Brak uprawnien sudo bez hasla dla ${scriptName} - sprawdz /etc/sudoers.d/caddy-dashboard`;
  }
  return stderr.trim() || null;
}

function runRedisScript(scriptName, args, stdinInput) {
  return new Promise((resolve, reject) => {
    const child = spawn('sudo', ['-n', `${SCRIPTS_DIR}/${scriptName}`, ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => reject(Object.assign(new Error(e.message), { status: 500 })));
    child.on('close', (code) => {
      if (code === 0) { resolve(stdout); return; }
      const message = sudoErrorMessage(scriptName, stderr);
      reject(Object.assign(new Error(message || stderr.trim() || `exit code ${code}`), { status: message ? 403 : 500 }));
    });
    child.stdin.write(stdinInput || '');
    child.stdin.end();
  });
}

function parseUsedMemoryBytes(output) {
  const match = /USED_MEMORY_BYTES=(\d+)/.exec(output);
  return match ? parseInt(match[1], 10) : null;
}

async function getOwnRedisStatus(username) {
  const [available, activeState, record] = await Promise.all([
    isRedisAvailable(),
    getUnitActiveState(username),
    Promise.resolve(getRecord(username))
  ]);
  const running = activeState === 'active';
  const passwordEnabled = !!record?.password;

  let usedMemoryBytes = null;
  if (running) {
    try {
      const out = await runRedisScript('hosting-user-redis-info.sh', [username], record?.password || '');
      usedMemoryBytes = parseUsedMemoryBytes(out);
    } catch {
      usedMemoryBytes = null;
    }
  }

  return {
    available,
    running,
    maxMemoryMb: record?.maxMemoryMb ?? DEFAULT_MAX_MEMORY_MB,
    usedMemoryBytes,
    passwordEnabled,
    password: passwordEnabled ? record.password : null,
    socketPath: `/run/cd-user-redis/${username}/redis.sock`
  };
}

async function startOwnRedis(username, { enablePassword, password }) {
  if (!(await isRedisAvailable())) {
    throw badRequest('Redis nie jest zainstalowany na tym serwerze.');
  }

  let finalPassword = '';
  if (enablePassword) {
    finalPassword = String(password || '').trim();
    if (!finalPassword) finalPassword = generatePassword();
    if (/[\r\n]/.test(finalPassword)) {
      throw badRequest('Haslo nie moze zawierac znakow nowej linii.');
    }
  }

  const maxMemoryMb = getRecord(username)?.maxMemoryMb ?? DEFAULT_MAX_MEMORY_MB;
  await runRedisScript('hosting-user-redis-apply.sh', [username, String(maxMemoryMb)], finalPassword);
  upsertRecord(username, { password: enablePassword ? finalPassword : null, maxMemoryMb });

  return getOwnRedisStatus(username);
}

async function stopOwnRedis(username) {
  await runRedisScript('hosting-user-redis-stop.sh', [username], '');
  return getOwnRedisStatus(username);
}

async function testOwnRedis(username) {
  const record = getRecord(username);
  const out = await runRedisScript('hosting-user-redis-info.sh', [username], record?.password || '');
  return { pingOk: true, usedMemoryBytes: parseUsedMemoryBytes(out) };
}

// --- Panel admina: przeglad wszystkich instancji + zmiana limitu RAM ---
// Tylko konta, ktore SAME zalozyly sobie Redis (maja rekord w
// data/hosting-redis.json) - to jest "Lista userow korzystajacych z
// Redis", nie lista wszystkich kont hostingowych.
async function listAllRedisInstances() {
  const all = loadData();
  return Promise.all(all.map(async (r) => {
    const activeState = await getUnitActiveState(r.username);
    return {
      username: r.username,
      running: activeState === 'active',
      maxMemoryMb: r.maxMemoryMb ?? DEFAULT_MAX_MEMORY_MB,
      passwordEnabled: !!r.password
    };
  }));
}

// UWAGA: hosting-user-redis-apply.sh zawsze konczy sie `systemctl
// restart` (+ enable) - czyli sama zmiana limitu przez admina
// wlaczylaby na nowo instancje, ktora user CELOWO zatrzymal. Zeby
// zmiana MB nie miala efektu ubocznego w postaci "wskrzeszenia"
// zatrzymanej instancji, sprawdzamy stan PRZED zmiana i jesli nie
// dzialala, zatrzymujemy ja z powrotem zaraz po zapisaniu nowego
// configu (config i tak zostaje zaktualizowany, wiec kolejne
// samoobslugowe uruchomienie przez usera juz uzyje nowego limitu).
async function adminSetMaxMemoryMb(username, maxMemoryMb) {
  const mb = parseInt(maxMemoryMb, 10);
  if (!Number.isInteger(mb) || mb < MIN_MAX_MEMORY_MB || mb > MAX_MAX_MEMORY_MB) {
    throw badRequest(`Limit RAM musi byc liczba calkowita w zakresie ${MIN_MAX_MEMORY_MB}-${MAX_MAX_MEMORY_MB} MB.`);
  }
  const record = getRecord(username);
  if (!record) throw Object.assign(new Error('Ten user nie ma jeszcze wlasnej instancji Redis.'), { status: 404 });

  const wasRunning = (await getUnitActiveState(username)) === 'active';

  await runRedisScript('hosting-user-redis-apply.sh', [username, String(mb)], record.password || '');
  if (!wasRunning) {
    await runRedisScript('hosting-user-redis-stop.sh', [username], '').catch(() => {});
  }
  upsertRecord(username, { maxMemoryMb: mb });

  const activeState = await getUnitActiveState(username);
  return { username, running: activeState === 'active', maxMemoryMb: mb, passwordEnabled: !!record.password };
}

export {
  getOwnRedisStatus, startOwnRedis, stopOwnRedis, testOwnRedis,
  listAllRedisInstances, adminSetMaxMemoryMb
};
