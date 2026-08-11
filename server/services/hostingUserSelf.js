import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { pamAuthenticate } from './auth.js';
import { listAccounts } from './hostingAccounts.js';
import { countOwnDatabases } from './hostingUserDatabases.js';

const execFileAsync = promisify(execFile);
const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url)) + '/../scripts';

// Musi byc zgodne z DEFAULT_TEMP_PASSWORD w hosting-account-create.sh -
// blokujemy "zmiane" hasla z powrotem na znany, publiczny default.
const DEFAULT_TEMP_PASSWORD = 'PassWord!1234';
const MIN_PASSWORD_LENGTH = 8;

function sudoErrorMessage(scriptName, stderr) {
  if (/password is required/i.test(stderr)) {
    return `Brak uprawnien sudo bez hasla dla ${scriptName} - sprawdz /etc/sudoers.d/caddy-dashboard`;
  }
  return stderr.trim() || null;
}

async function getMustChangePassword(username) {
  try {
    const { stdout } = await execFileAsync(
      'sudo', ['-n', `${SCRIPTS_DIR}/hosting-user-password-status.sh`, username], { timeout: 10000 }
    );
    return stdout.trim() === 'MUST_CHANGE';
  } catch (e) {
    const stderr = (e.stderr || '').toString();
    throw Object.assign(
      new Error(sudoErrorMessage('hosting-user-password-status.sh', stderr) || e.message), { status: 500 }
    );
  }
}

// Nowe haslo idzie na stdin skryptu (spawn, nie execFile) - patrz komentarz
// w hosting-user-set-password.sh, argv nie jest bezpiecznym kanalem.
function setSystemPassword(username, newPassword) {
  return new Promise((resolve, reject) => {
    const child = spawn('sudo', ['-n', `${SCRIPTS_DIR}/hosting-user-set-password.sh`, username]);
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => reject(Object.assign(new Error(e.message), { status: 500 })));
    child.on('close', (code) => {
      if (code === 0) { resolve(); return; }
      const message = sudoErrorMessage('hosting-user-set-password.sh', stderr);
      reject(Object.assign(new Error(message || `exit code ${code}`), { status: message ? 403 : 500 }));
    });
    child.stdin.write(newPassword);
    child.stdin.end();
  });
}

async function changeOwnPassword(username, currentPassword, newPassword) {
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw Object.assign(new Error(`Nowe haslo musi miec co najmniej ${MIN_PASSWORD_LENGTH} znakow.`), { status: 400 });
  }
  if (newPassword === DEFAULT_TEMP_PASSWORD) {
    throw Object.assign(new Error('Nowe haslo nie moze byc takie samo jak haslo tymczasowe.'), { status: 400 });
  }
  if (newPassword === currentPassword) {
    throw Object.assign(new Error('Nowe haslo musi byc inne niz obecne.'), { status: 400 });
  }

  const currentOk = await pamAuthenticate(username, currentPassword);
  if (!currentOk) {
    throw Object.assign(new Error('Obecne haslo jest nieprawidlowe.'), { status: 401 });
  }

  await setSystemPassword(username, newPassword);
}

// RAM: suma RSS po WSZYSTKICH procesach usera z `ps -o rss`, bez sudo
// (dziala niezawodnie - potwierdzone, RAM zawsze pokazywal sie poprawnie).
// Brak procesow (user aktualnie nie ma zadnej sesji SSH) to normalny stan,
// nie blad - `ps` wtedy zwraca kod 1 i pusty wynik, co oddajemy jako zera.
//
// CPU: liczymy realna delte czasu CPU miedzy dwoma probkami (dokladnie
// jak `top`/`htop`), NIE `ps -o %cpu` - ta kolumna to srednia OD STARTU
// PROCESU, dla dlugo dzialajacej sesji SSH prawie zawsze bliska 0% mimo
// realnego obciazenia (pierwsze zgloszenie usera: "nonstop 0%").
//
// Zrodlo danych o czasie CPU przeszlo DWIE iteracje:
//  1) bezposredni odczyt /proc/<pid>/stat (fs.readFile) jako serwisowy
//     user panelu (cdadmin, NIE root) - precyzja tikow zegara (1/100s),
//     ale niepewny dostep do /proc procesow NALEZACYCH DO INNEGO USERA
//     (konto hostingowe) na kazdym VPS.
//  2) `ps -u <user> -o cputimes` (calkowite sekundy CPU, rozszerzenie GNU
//     ps) - kanal dostepu na 100% sprawdzony (ten sam co RSS/RAM), ale
//     `cputimes` obcina do PELNYCH SEKUND. Przy niskim obciazeniu (user
//     zglosil realne wartosci z `top` rzedu 0.3-0.6%) delta miedzy
//     probkami co 5s prawie zawsze wychodzi 0 sekund - kafelek dalej
//     "nie reagowal" mimo ze dane byly poprawnie dostepne, po prostu za
//     malo precyzyjne.
// Rozwiazanie: wracamy do precyzji /proc/<pid>/stat (tiki zegara), ale
// czytamy je PRZEZ SUDO/ROOT (hosting-user-cpu-ticks.sh) zamiast liczyc
// na niepewne uprawnienia serwisowego usera do cudzego /proc - ten sam,
// juz wielokrotnie sprawdzony wzorzec co reszta danych cross-user w tym
// projekcie (hosting-account-disk-usage.sh, hosting-account-sites-count.sh
// itd.), wiec dziala niezaleznie od konfiguracji /proc (np. hidepid) na
// danym VPS.
//
// Pierwsza probka po starcie panelu (lub po restarcie serwisu) nie ma z
// czym sie porownac, wiec zwraca 0% - kolejne odswiezenie (Dashboard
// odpytuje co 5s) juz pokazuje realna wartosc.
const cpuSampleCache = new Map(); // username -> { totalTicks, timestampMs }
let clkTckCache = null;

async function getClockTicksPerSecond() {
  if (clkTckCache) return clkTckCache;
  try {
    const { stdout } = await execFileAsync('getconf', ['CLK_TCK']);
    clkTckCache = parseInt(stdout.trim(), 10) || 100;
  } catch {
    clkTckCache = 100; // standardowa wartosc na Linuksie, gdyby getconf zawiodl
  }
  return clkTckCache;
}

function getCpuTicks(username) {
  return new Promise((resolve, reject) => {
    const child = spawn('sudo', ['-n', `${SCRIPTS_DIR}/hosting-user-cpu-ticks.sh`, username]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => reject(Object.assign(new Error(e.message), { status: 500 })));
    child.on('close', (code) => {
      if (code === 0) {
        resolve(parseInt(stdout.trim(), 10) || 0);
        return;
      }
      reject(Object.assign(
        new Error(sudoErrorMessage('hosting-user-cpu-ticks.sh', stderr) || `exit code ${code}`), { status: 500 }
      ));
    });
  });
}

async function getProcessUsage(username) {
  let rssKb = 0;
  try {
    const { stdout } = await execFileAsync('ps', ['-u', username, '--no-headers', '-o', 'rss'], { timeout: 5000 });
    for (const line of stdout.trim().split('\n')) {
      const trimmed = line.trim();
      if (trimmed) rssKb += parseInt(trimmed, 10) || 0;
    }
  } catch {
    rssKb = 0;
  }

  try {
    const [totalTicks, clkTck] = await Promise.all([getCpuTicks(username), getClockTicksPerSecond()]);
    const nowMs = Date.now();
    const prev = cpuSampleCache.get(username);
    cpuSampleCache.set(username, { totalTicks, timestampMs: nowMs });

    let cpuUsedPercent = 0;
    if (prev) {
      const deltaSeconds = (nowMs - prev.timestampMs) / 1000;
      if (deltaSeconds > 0) {
        const deltaTicks = Math.max(0, totalTicks - prev.totalTicks);
        cpuUsedPercent = (deltaTicks / clkTck / deltaSeconds) * 100;
      }
    }

    return { cpuUsedPercent: Math.round(cpuUsedPercent * 10) / 10, ramUsedMb: Math.round(rssKb / 1024) };
  } catch {
    return { cpuUsedPercent: 0, ramUsedMb: Math.round(rssKb / 1024) };
  }
}

// Liczba stron (plikow *.caddy) konta - katalog nalezy do
// <username>:caddy (0750), panel dziala jako osobny user serwisowy bez
// dostepu do niego, wiec liczenie idzie przez skrypt sudo (root), patrz
// hosting-account-sites-count.sh.
function countSites(username) {
  return new Promise((resolve, reject) => {
    const child = spawn('sudo', ['-n', `${SCRIPTS_DIR}/hosting-account-sites-count.sh`, username]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => reject(Object.assign(new Error(e.message), { status: 500 })));
    child.on('close', (code) => {
      if (code === 0) {
        resolve(parseInt(stdout.trim(), 10) || 0);
        return;
      }
      reject(Object.assign(
        new Error(sudoErrorMessage('hosting-account-sites-count.sh', stderr) || `exit code ${code}`), { status: 500 }
      ));
    });
  });
}

// Realne zuzycie dysku (katalog domowy, `du -sm`) - dziala niezaleznie od
// tego, czy limit dysku jest juz egzekwowany przez quote na danym VPS, w
// odroznieniu od `repquota`/`xfs_quota` ktore wymagalyby wlaczonego
// mechanizmu (patrz diskQuota.js: quota moze byc "off" - packages.quota_off_badge).
function getDiskUsageMb(username) {
  return new Promise((resolve, reject) => {
    const child = spawn('sudo', ['-n', `${SCRIPTS_DIR}/hosting-account-disk-usage.sh`, username]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => reject(Object.assign(new Error(e.message), { status: 500 })));
    child.on('close', (code) => {
      if (code === 0) {
        resolve(parseInt(stdout.trim(), 10) || 0);
        return;
      }
      reject(Object.assign(
        new Error(sudoErrorMessage('hosting-account-disk-usage.sh', stderr) || `exit code ${code}`), { status: 500 }
      ));
    });
  });
}

// Wlasny rekord z rejestru panelu (hosting-accounts.json) - jesli konto
// istnieje jako user systemowy, ale z jakiegos powodu nie ma wpisu w
// rejestrze (np. utworzone recznie poza panelem), zwracamy nulle zamiast
// bledu - panel klienta ma sie po prostu pokazac z pustymi polami.
//
// databasesUsed - od hostingUserDatabases.js (Bazy) jest to juz REALNA
// liczba baz zalozonych przez to konto przez panel (wczesniej na stale 0,
// bo mechanizm wiazania bazy z kontem nie istnial - teraz istnieje).
async function getOwnAccount(username) {
  const account = listAccounts().find((a) => a.username === username);
  const [usage, sitesUsed, diskUsedMb] = await Promise.all([
    getProcessUsage(username),
    account ? countSites(username).catch(() => 0) : Promise.resolve(0),
    getDiskUsageMb(username).catch(() => 0)
  ]);
  const databasesUsed = countOwnDatabases(username);
  return {
    username,
    fullName: account?.fullName || null,
    email: account?.email || null,
    homeDir: account?.homeDir || null,
    packageName: account?.packageName || null,
    diskQuotaMb: account?.diskQuotaMb ?? null,
    diskUsedMb,
    serverUptimeSeconds: Math.floor(os.uptime()),
    ramLimitMb: account?.ramLimitMb ?? null,
    maxDomains: account?.maxDomains ?? null,
    maxDatabases: account?.maxDatabases ?? null,
    cpuPercentLimit: account?.cpuPercent ?? null,
    // Nazwa procesora serwera (os.cpus() - dziala bez sudo, to samo co
    // system.cpu.model w panelu admina).
    cpuModel: (os.cpus()[0]?.model || '').trim() || null,
    createdAt: account?.createdAt || null,
    cpuUsedPercent: usage.cpuUsedPercent,
    ramUsedMb: usage.ramUsedMb,
    sitesUsed,
    databasesUsed
  };
}

export { getMustChangePassword, changeOwnPassword, getOwnAccount };
