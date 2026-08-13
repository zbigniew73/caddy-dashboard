import { spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import { listUsedProxyPorts } from './hostingUserSites.js';

const SCRIPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts');
const SCRIPT_NAME = 'hosting-user-python-venv.sh';
const APP_SCRIPT_NAME = 'hosting-user-python-app.sh';

const FRAMEWORKS = ['django', 'flask', 'fastapi'];
// Nazwa pakietu w `pip list --format=freeze` uzywana do wykrycia "czy
// framework juz zainstalowany" - dolna litera, bo pip normalizuje nazwy
// (Django -> django) w tym formacie wyjscia.
const FRAMEWORK_PACKAGE_NAME = { django: 'django', flask: 'flask', fastapi: 'fastapi' };

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function sudoErrorMessage(scriptName, stderr) {
  if (/password is required/i.test(stderr)) {
    return `Brak uprawnien sudo bez hasla dla ${scriptName} - sprawdz /etc/sudoers.d/caddy-dashboard`;
  }
  return stderr.trim() || null;
}

function runScript(scriptName, action, args, stdinContent) {
  return new Promise((resolve, reject) => {
    const child = spawn('sudo', ['-n', `${SCRIPTS_DIR}/${scriptName}`, action, ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => reject(Object.assign(new Error(e.message), { status: 500 })));
    child.on('close', (code) => {
      if (code === 0) { resolve(stdout); return; }
      const message = sudoErrorMessage(scriptName, stderr);
      reject(Object.assign(new Error(message || stdout.trim() || `exit code ${code}`), { status: message ? 403 : 500 }));
    });
    if (stdinContent !== undefined) child.stdin.write(stdinContent);
    child.stdin.end();
  });
}

function runVenvScript(action, args, stdinContent) {
  return runScript(SCRIPT_NAME, action, args, stdinContent);
}

function runAppScript(action, args) {
  return runScript(APP_SCRIPT_NAME, action, args);
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

// Parsuje wyjscie akcji 'status' skryptu (EXISTS=/PYVERSION=/PKG=<linia>
// - patrz komentarz w hosting-user-python-venv.sh) - stan czytany ZAWSZE
// na zywo z dysku wewnatrz skryptu, nigdy nie trzymany w JSON tutaj, zeby
// nie rozjechac sie z rzeczywistoscia, gdyby user recznie doinstalowal/
// odinstalowal cos przez SSH.
function parseStatusOutput(raw) {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const exists = lines.some((l) => l === 'EXISTS=1');
  if (!exists) return { exists: false, pythonVersion: null, packages: [], frameworks: [] };

  const pyLine = lines.find((l) => l.startsWith('PYVERSION='));
  const pythonVersion = pyLine ? pyLine.slice('PYVERSION='.length) : null;
  const packages = lines
    .filter((l) => l.startsWith('PKG='))
    .map((l) => l.slice('PKG='.length));

  const installedNames = new Set(packages.map((p) => p.split('==')[0].toLowerCase()));
  const frameworks = FRAMEWORKS.filter((f) => installedNames.has(FRAMEWORK_PACKAGE_NAME[f]));

  return { exists: true, pythonVersion, packages, frameworks };
}

async function getVenvStatus(username) {
  const raw = await runVenvScript('status', [username]);
  return parseStatusOutput(raw);
}

async function createVenv(username, pythonId) {
  const versions = listPythonVersions();
  const chosen = versions.find((v) => v.id === pythonId);
  if (!chosen) throw badRequest('Wybierz wersje Pythona z listy.');
  // Odtworzenie venv (rm -rf + od nowa) pod nogami dzialajacej aplikacji
  // (gunicorn/uvicorn) to dokladnie ten typ cichego psucia, ktory juz
  // raz naprawialismy w tym projekcie (memory_limit) - zatrzymujemy
  // aplikacje najpierw, best-effort (brak aplikacji/bledu tu nie jest
  // powodem do przerywania tworzenia venv).
  await runAppScript('stop', [username]).catch(() => {});
  await runVenvScript('create', [username, validatePythonPath(chosen.path)]);
  return getVenvStatus(username);
}

async function installFramework(username, framework) {
  if (!FRAMEWORKS.includes(framework)) throw badRequest('Nieznany framework.');
  await runVenvScript('install', [username, framework]);
  return getVenvStatus(username);
}

async function deleteVenv(username) {
  await runAppScript('stop', [username]).catch(() => {});
  await runVenvScript('remove', [username]);
  return getVenvStatus(username);
}

// Parsuje wyjscie akcji 'status' skryptu hosting-user-python-app.sh
// (ACTIVE=/FRAMEWORK=/PORT=/LOG=<linia> - patrz komentarz w tym
// skrypcie). Podobnie jak status venv, ZAWSZE czytany na zywo z systemd/
// journalctl, nigdy nie trzymany w JSON.
function parseAppStatusOutput(raw) {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const activeLine = lines.find((l) => l.startsWith('ACTIVE='));
  const running = activeLine ? activeLine.slice('ACTIVE='.length) === 'active' : false;

  const frameworkLine = lines.find((l) => l.startsWith('FRAMEWORK='));
  const framework = frameworkLine ? frameworkLine.slice('FRAMEWORK='.length) : null;

  const portLine = lines.find((l) => l.startsWith('PORT='));
  const port = portLine ? parseInt(portLine.slice('PORT='.length), 10) : null;

  const logs = lines.filter((l) => l.startsWith('LOG=')).map((l) => l.slice('LOG='.length));

  return { running, framework, port: Number.isInteger(port) ? port : null, logs };
}

async function getAppStatus(username) {
  const raw = await runAppScript('status', [username]);
  return parseAppStatusOutput(raw);
}

async function startApp(username, { framework, port }) {
  if (!FRAMEWORKS.includes(framework)) throw badRequest('Nieznany framework.');
  const portNum = parseInt(port, 10);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    throw badRequest('Nieprawidlowy numer portu (1-65535).');
  }
  await runAppScript('start', [username, framework, String(portNum)]);
  return getAppStatus(username);
}

async function stopApp(username) {
  await runAppScript('stop', [username]);
  return getAppStatus(username);
}

// Sprawdzenie "wolnego portu" - DWA niezalezne sygnaly, oba musza wyjsc
// czysto:
//   1) rejestr: czy ten port jest juz PRZYPISANY do strony reverseproxy
//      JAKIEGOKOLWIEK konta (data/hosting-sites.json, patrz
//      listUsedProxyPorts() w hostingUserSites.js) - lapie porty
//      "zarezerwowane", nawet jesli akurat nic na nich teraz nie dziala.
//   2) zywy test bindowania - lapie WSZYSTKO co faktycznie nasluchuje TERAZ
//      (Caddy, baza danych, juz dzialajaca aplikacja innego usera spoza
//      tego panelu, cokolwiek) - to jest sygnal, ktory NAPRAWDE
//      gwarantuje wolny port, rejestr sam w sobie by tego nie zlapal.
// PORT_RANGE to tylko PUNKT STARTOWY przeszukiwania przy szukaniu wolnego
// portu - nie jest zrodlem prawdy o tym, co jest "bezpieczne" (to robi
// zywy test), tylko wygodny, udokumentowany zakres do zaczecia (ponizej
// typowych portow uslug, ponizej typowego zakresu efemerycznych portow
// wychodzacych Linuksa).
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
  const usedByAccounts = await Promise.resolve(listUsedProxyPorts());
  if (usedByAccounts.includes(port)) return false;
  return isPortListening(port);
}

async function findFreePort(preferredPort) {
  if (preferredPort !== undefined && preferredPort !== null && preferredPort !== '') {
    const port = parseInt(preferredPort, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw badRequest('Nieprawidlowy numer portu (1-65535).');
    }
    return { port, free: await isPortFree(port) };
  }

  const [start, end] = PORT_RANGE;
  for (let port = start; port <= end; port++) {
    if (await isPortFree(port)) return { port, free: true };
  }
  throw Object.assign(new Error('Nie znaleziono wolnego portu w zakresie ' + start + '-' + end + '.'), { status: 500 });
}

export {
  listPythonVersions, getVenvStatus, createVenv, installFramework, deleteVenv, findFreePort,
  getAppStatus, startApp, stopApp
};
