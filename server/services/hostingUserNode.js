import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data');
const DATA_PATH = path.join(DATA_DIR, 'hosting-node-apps.json');
const SCRIPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts');
const APP_SCRIPT_NAME = 'hosting-user-node-app.sh';

// 'manual' = tylko `npm init -y` (pusty package.json, bez pakietow, bez
// szkieletu) - user instaluje i uruchamia swoja aplikacje samodzielnie
// przez SSH. startApp() nizej wprost odrzuca 'manual' - panel nigdy nie
// tworzy dla niej uslugi systemd (sudo script tez to blokuje w akcji
// 'start', podwojna walidacja, jak wszedzie w tym projekcie).
const FRAMEWORKS = ['express', 'fastify', 'koa', 'manual'];
// Jak w hostingUserPython.js - slug jest jedynym identyfikatorem
// aplikacji (unikalnym per-konto), wchodzi wprost do sciezek na dysku
// (~/node-apps/<slug>/) i do nazwy uslugi systemd
// (cd-nodeapp-<username>-<slug>.service).
const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function loadApps() {
  try {
    const parsed = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
    return Array.isArray(parsed.apps) ? parsed.apps : [];
  } catch {
    return [];
  }
}

function saveApps(apps) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_PATH, JSON.stringify({ apps }, null, 2), { mode: 0o600 });
}

function sudoErrorMessage(stderr) {
  if (/password is required/i.test(stderr)) {
    return `Brak uprawnien sudo bez hasla dla ${APP_SCRIPT_NAME} - sprawdz /etc/sudoers.d/caddy-dashboard`;
  }
  return stderr.trim() || null;
}

function runAppScript(action, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('sudo', ['-n', `${SCRIPTS_DIR}/${APP_SCRIPT_NAME}`, action, ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => reject(Object.assign(new Error(e.message), { status: 500 })));
    child.on('close', (code) => {
      if (code === 0) { resolve(stdout); return; }
      const message = sudoErrorMessage(stderr);
      reject(Object.assign(new Error(message || stdout.trim() || `exit code ${code}`), { status: message ? 403 : 500 }));
    });
    child.stdin.end();
  });
}

// Prawdziwe, zainstalowane binarki Node - NIE zgadujemy, czytamy
// rzeczywisty stan systemu (world-readable pliki, bez sudo), ten sam
// wzorzec co listPythonVersions() w hostingUserPython.js. W odroznieniu
// od Pythona (gdzie wiele wersji obok siebie jest normalne, pakiety
// dystrybucji) Node typowo ma JEDNA systemowa wersje - AlmaLinux/Rocky
// nie ma odpowiednika Remi dla Node - ale skanujemy uczciwie oba typowe
// miejsca instalacji (NodeSource ląduje w /usr/bin, recznie/przez moduly
// czasem w /usr/local/bin) i obie formy nazwy (plain "node" i wersjonowane
// symlinki "nodeXX", na wypadek wielu strumieni), zamiast zakladac z
// gory jedna sciezke.
function listNodeVersions() {
  const dirs = ['/usr/bin', '/usr/local/bin'];
  const found = new Map();
  for (const dir of dirs) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of entries) {
      if (!/^node[0-9]*$/.test(f)) continue;
      const fullPath = path.join(dir, f);
      if (!found.has(fullPath)) found.set(fullPath, fullPath);
    }
  }
  return Array.from(found.keys()).map((p) => ({ id: p, version: p, path: p }));
}

// Wersja jest zawsze rozstrzygana LENIWIE, dopiero gdy user faktycznie
// wybierze pozycje z listy - `node --version` woalny sam skan
// listNodeVersions() (odczyt katalogu) nie wymaga uruchamiania procesow,
// ale sama etykieta w <select> ma pokazywac prawdziwa wersje, nie
// sama sciezke - stad osobna funkcja, wywolywana per wpis przy
// renderowaniu listy w routes (patrz GET /node/versions w userApi.js).
async function resolveNodeVersionLabel(nodePath) {
  try {
    const { stdout } = await execFileAsync(nodePath, ['--version']);
    return stdout.trim() || nodePath;
  } catch {
    return nodePath;
  }
}

async function listNodeVersionsWithLabels() {
  const versions = listNodeVersions();
  return Promise.all(versions.map(async (v) => ({
    id: v.id,
    version: await resolveNodeVersionLabel(v.path),
    path: v.path
  })));
}

function validateNodePath(nodePath) {
  const versions = listNodeVersions();
  const match = versions.find((v) => v.path === nodePath);
  if (!match) throw badRequest('Wybrana wersja Node nie jest dostepna na tym serwerze.');
  return match.path;
}

function validateSlug(slug) {
  if (!SLUG_RE.test(slug || '')) {
    throw badRequest('Nieprawidlowa nazwa aplikacji (male litery, cyfry, myslnik, 1-32 znaki).');
  }
  return slug;
}

function validatePort(port) {
  const portNum = parseInt(port, 10);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    throw badRequest('Nieprawidlowy numer portu (1-65535).');
  }
  return portNum;
}

// Biezacy stan uslugi z systemd - bez sudo, samo "systemctl show" na
// dowolnej jednostce nie wymaga uprawnien (ten sam mechanizm co
// getUnitActiveState w hostingUserPython.js/hostingUserRedis.js) - dzieki
// temu listApps() dla CALEJ listy aplikacji nie odpala ani jednego
// procesu sudo.
async function getUnitActiveState(username, slug) {
  try {
    const { stdout } = await execFileAsync('systemctl', [
      'show', `cd-nodeapp-${username}-${slug}.service`, '--no-page', '-p', 'ActiveState'
    ]);
    const match = /ActiveState=(\S+)/.exec(stdout);
    return match ? match[1] : 'unknown';
  } catch {
    return 'unknown';
  }
}

function toPublic(record) {
  return {
    slug: record.slug,
    framework: record.framework,
    nodeId: record.nodeId,
    port: record.port,
    createdAt: record.createdAt
  };
}

async function listApps(username) {
  const records = loadApps().filter((a) => a.accountUsername === username);
  return Promise.all(records.map(async (r) => ({
    ...toPublic(r),
    running: (await getUnitActiveState(username, r.slug)) === 'active'
  })));
}

async function createApp(username, { slug, nodeId, framework, port }) {
  const slugValue = validateSlug(slug);
  if (!FRAMEWORKS.includes(framework)) throw badRequest('Nieznany framework.');
  const portValue = validatePort(port);
  const nodePath = validateNodePath(nodeId);

  const all = loadApps();
  if (all.some((a) => a.accountUsername === username && a.slug === slugValue)) {
    throw badRequest('Aplikacja o tej nazwie juz istnieje.');
  }

  await runAppScript('create', [username, slugValue, nodePath, framework]);

  const record = {
    accountUsername: username,
    slug: slugValue,
    framework,
    nodeId,
    port: portValue,
    createdAt: new Date().toISOString()
  };
  all.push(record);
  saveApps(all);
  return { ...toPublic(record), running: false };
}

function getOwnApp(username, slug) {
  const record = loadApps().find((a) => a.accountUsername === username && a.slug === slug);
  if (!record) throw badRequest('Nie znaleziono aplikacji.');
  return record;
}

async function startApp(username, slug, port) {
  const record = getOwnApp(username, slug);
  if (record.framework === 'manual') {
    throw badRequest('Aplikacje typu Manual uruchamiasz samodzielnie przez SSH - panel nie zarzadza tym procesem.');
  }
  const portValue = validatePort(port);
  const nodePath = validateNodePath(record.nodeId);
  await runAppScript('start', [username, slug, nodePath, record.framework, String(portValue)]);

  if (portValue !== record.port) {
    const all = loadApps();
    const idx = all.findIndex((a) => a.accountUsername === username && a.slug === slug);
    if (idx !== -1) {
      all[idx] = { ...all[idx], port: portValue };
      saveApps(all);
    }
  }

  return { ...toPublic({ ...record, port: portValue }), running: true };
}

async function stopApp(username, slug) {
  getOwnApp(username, slug);
  await runAppScript('stop', [username, slug]);
  return { ...toPublic(getOwnApp(username, slug)), running: false };
}

async function deleteApp(username, slug) {
  getOwnApp(username, slug);
  await runAppScript('delete', [username, slug]);
  const all = loadApps().filter((a) => !(a.accountUsername === username && a.slug === slug));
  saveApps(all);
}

// Logi sa pobierane TYLKO na zadanie (przycisk "Logi" per aplikacja),
// nigdy przy odswiezeniu calej listy - journalctl wymaga roota, wiec
// kazde wywolanie to osobny proces sudo.
async function getAppLogs(username, slug) {
  getOwnApp(username, slug);
  const raw = await runAppScript('status', [username, slug]);
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const activeLine = lines.find((l) => l.startsWith('ACTIVE='));
  const running = activeLine ? activeLine.slice('ACTIVE='.length) === 'active' : false;
  const logs = lines.filter((l) => l.startsWith('LOG=')).map((l) => l.slice('LOG='.length));
  return { running, logs };
}

// Porty JUZ PRZYPISANE do jakiejkolwiek aplikacji Node, DOWOLNEGO konta -
// jeden z rejestrow sprawdzanych przez findFreePort/isPortFree w
// hostingUserPorts.js (obok stron reverseproxy i aplikacji Python).
function listUsedNodeAppPorts() {
  return loadApps().map((a) => a.port).filter((p) => Number.isInteger(p));
}

export {
  listNodeVersions, listNodeVersionsWithLabels, listApps, createApp, startApp, stopApp,
  deleteApp, getAppLogs, listUsedNodeAppPorts
};
