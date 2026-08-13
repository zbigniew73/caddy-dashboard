import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import { listUsedProxyPorts } from './hostingUserSites.js';

const execFileAsync = promisify(execFile);

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data');
const DATA_PATH = path.join(DATA_DIR, 'hosting-python-apps.json');
const SCRIPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts');
const APP_SCRIPT_NAME = 'hosting-user-python-app.sh';

// 'manual' = tylko czysty venv (bez pakietow, bez szkieletu) - user
// instaluje i uruchamia swoja aplikacje samodzielnie przez SSH. Dlatego
// startApp() nizej wprost odrzuca 'manual' - panel nigdy nie tworzy dla
// niej uslugi systemd (sudo script tez to blokuje, patrz akcja 'start' w
// hosting-user-python-app.sh - podwojna walidacja, jak wszedzie w tym
// projekcie).
const FRAMEWORKS = ['django', 'flask', 'fastapi', 'manual'];
// Jak etykieta domeny (DOMAIN_RE w hostingUserSites.js), tylko krotsza -
// slug jest jedynym identyfikatorem aplikacji (unikalnym per-konto, patrz
// createApp), wchodzi wprost do sciezek na dysku i do nazwy uslugi
// systemd (cd-pyapp-<username>-<slug>.service).
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

// Prawdziwe, zainstalowane binarki Python - NIE zgadujemy, czytamy
// rzeczywisty stan systemu (world-readable pliki, bez sudo), ten sam
// wzorzec co listPhpCliPaths() w hostingUserCron.js dla PHP CLI. AlmaLinux/
// Rocky 9+ typowo ma kilka wersji /usr/bin/python3.X obok siebie (np.
// domyslna 3.9/3.11 + ewentualnie nowsza doinstalowana recznie przez
// admina) - sortujemy NUMERYCZNIE po minor (sort tekstowy dawalby "3.11"
// przed "3.9", co jest odwrotnie niz chronologicznie).
function listPythonVersions() {
  let entries = [];
  try {
    entries = fs.readdirSync('/usr/bin')
      .map((f) => /^python3\.([0-9]+)$/.exec(f))
      .filter(Boolean)
      .map((m) => ({ id: `3.${m[1]}`, version: `3.${m[1]}`, path: `/usr/bin/python3.${m[1]}`, minor: parseInt(m[1], 10) }));
  } catch {
    entries = [];
  }
  entries.sort((a, b) => a.minor - b.minor);
  return entries.map(({ id, version, path: p }) => ({ id, version, path: p }));
}

function validatePythonPath(pythonPath) {
  const versions = listPythonVersions();
  const match = versions.find((v) => v.path === pythonPath);
  if (!match) throw badRequest('Wybrana wersja Pythona nie jest dostepna na tym serwerze.');
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
// getUnitActiveState w hostingUserRedis.js) - dzieki temu listApps() dla
// CALEJ listy aplikacji nie odpala ani jednego procesu sudo.
async function getUnitActiveState(username, slug) {
  try {
    const { stdout } = await execFileAsync('systemctl', [
      'show', `cd-pyapp-${username}-${slug}.service`, '--no-page', '-p', 'ActiveState'
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
    pythonId: record.pythonId,
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

async function createApp(username, { slug, pythonId, framework, port }) {
  const slugValue = validateSlug(slug);
  if (!FRAMEWORKS.includes(framework)) throw badRequest('Nieznany framework.');
  const portValue = validatePort(port);

  const versions = listPythonVersions();
  const chosen = versions.find((v) => v.id === pythonId);
  if (!chosen) throw badRequest('Wybierz wersje Pythona z listy.');

  const all = loadApps();
  if (all.some((a) => a.accountUsername === username && a.slug === slugValue)) {
    throw badRequest('Aplikacja o tej nazwie juz istnieje.');
  }

  await runAppScript('create', [username, slugValue, validatePythonPath(chosen.path), framework]);

  const record = {
    accountUsername: username,
    slug: slugValue,
    framework,
    pythonId,
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
  await runAppScript('start', [username, slug, record.framework, String(portValue)]);

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

// Logi sa pobierane TYLKO na zadanie (przycisk "Pokaz logi" per
// aplikacja), nigdy przy odswiezeniu calej listy - w odroznieniu od
// running (listApps), ktore czyta sie bez sudo, journalctl wymaga roota,
// wiec kazde wywolanie to osobny proces sudo - nie chcemy N takich przy
// kazdym renderze listy.
async function getAppLogs(username, slug) {
  getOwnApp(username, slug);
  const raw = await runAppScript('status', [username, slug]);
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const activeLine = lines.find((l) => l.startsWith('ACTIVE='));
  const running = activeLine ? activeLine.slice('ACTIVE='.length) === 'active' : false;
  const logs = lines.filter((l) => l.startsWith('LOG=')).map((l) => l.slice('LOG='.length));
  return { running, logs };
}

// Porty JUZ PRZYPISANE do jakiejkolwiek aplikacji Python, DOWOLNEGO konta
// - drugi rejestr obok listUsedProxyPorts() (strony reverseproxy) w
// hostingUserSites.js - findFreePort/isPortFree ponizej musza sprawdzac
// OBA, bo aplikacja Python i strona reverseproxy moga kolidowac o ten sam
// port tak samo jak dwie aplikacje Python miedzy soba.
function listUsedPythonAppPorts() {
  return loadApps().map((a) => a.port).filter((p) => Number.isInteger(p));
}

// Sprawdzenie "wolnego portu" - TRZY niezalezne sygnaly, wszystkie musza
// wyjsc czysto:
//   1) rejestr stron: port juz PRZYPISANY do strony reverseproxy
//      JAKIEGOKOLWIEK konta (listUsedProxyPorts() w hostingUserSites.js).
//   2) rejestr aplikacji Python: port juz PRZYPISANY do innej aplikacji
//      Python, tego samego lub innego konta (listUsedPythonAppPorts()
//      powyzej) - lapie porty "zarezerwowane", nawet jesli akurat nic na
//      nich teraz nie dziala (np. aplikacja jeszcze nie wystartowana).
//   3) zywy test bindowania - lapie WSZYSTKO co faktycznie nasluchuje
//      TERAZ (Caddy, baza danych, cokolwiek spoza obu rejestrow) - to
//      jedyny sygnal, ktory NAPRAWDE gwarantuje wolny port.
// PORT_RANGE to tylko PUNKT STARTOWY przeszukiwania - nie jest zrodlem
// prawdy o tym, co jest "bezpieczne" (to robia powyzsze sygnaly), tylko
// wygodny, udokumentowany zakres do zaczecia (ponizej typowych portow
// uslug, ponizej typowego zakresu efemerycznych portow wychodzacych
// Linuksa).
const PORT_RANGE = [20000, 29999];

function panelOwnPort() {
  const fromEnv = parseInt(process.env.PORT, 10);
  return Number.isInteger(fromEnv) ? fromEnv : 4300;
}

function isPortListening(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function isPortFree(port) {
  if (port === panelOwnPort()) return false;
  if (listUsedProxyPorts().includes(port)) return false;
  if (listUsedPythonAppPorts().includes(port)) return false;
  return isPortListening(port);
}

async function findFreePort(preferredPort) {
  if (preferredPort !== undefined && preferredPort !== null && preferredPort !== '') {
    const port = validatePort(preferredPort);
    return { port, free: await isPortFree(port) };
  }

  const [start, end] = PORT_RANGE;
  for (let port = start; port <= end; port++) {
    if (await isPortFree(port)) return { port, free: true };
  }
  throw Object.assign(new Error('Nie znaleziono wolnego portu w zakresie ' + start + '-' + end + '.'), { status: 500 });
}

export {
  listPythonVersions, listApps, createApp, startApp, stopApp, deleteApp, getAppLogs,
  listUsedPythonAppPorts, findFreePort
};
