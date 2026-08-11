import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { pamAuthenticate } from './auth.js';
import { listAccounts } from './hostingAccounts.js';
import { cpuCount } from './hostingPackages.js';

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

// Biezace zuzycie CPU/RAM konta - suma po WSZYSTKICH procesach usera z `ps`
// (kolumny %cpu/rss), bez sudo (odczyt /proc jest publiczny na typowej
// instalacji). Brak procesow (user aktualnie nie ma zadnej sesji SSH) to
// normalny stan, nie blad - `ps` wtedy zwraca kod 1 i pusty wynik, co
// oddajemy jako zera, a nie wyjatek.
// UWAGA: kolumna `ps -o %cpu` to NIE biezace obciazenie - to srednia
// zuzycia CPU liczona OD STARTU PROCESU (czas CPU / czas zycia procesu).
// Dla dlugo dzialajacej sesji SSH (bash) ta wartosc jest praktycznie
// zawsze bliska 0%, nawet gdy user cos realnie obciaza w danej chwili -
// kafelek CPU na Dashboardzie z tego powodu "nie reagowal" (zgloszone
// przez usera). Zamiast tego liczymy realna delte: sumujemy `cputimes`
// (kumulatywny czas CPU w SEKUNDACH, rozszerzenie GNU ps - `ps -o
// cputimes`) wszystkich procesow usera TERAZ, porownujemy z poprzednia
// probka (in-memory cache per username) i dzielimy przez rzeczywisty
// uplyw czasu miedzy probkami - dokladnie tak jak liczy to `top`/`htop`.
//
// Pierwsza wersja tej poprawki czytala /proc/<pid>/stat BEZPOSREDNIO
// (fs.readFile) zamiast przez `ps` - dzialalo to w testach (ten sam
// user), ale na prawdziwym VPS user serwisowy panelu (cdadmin) nie moglo
// w ten sposob odczytac /proc procesow NALEZACYCH DO INNEGO USERA
// (konto hostingowe), wiec CPU dalej pokazywalo 0% (zgloszone ponownie
// przez usera - "w konsoli top -u srv_1001 dziala, w panelu nadal nic").
// Naprawione przez oparcie sie WYLACZNIE na `ps` (ten sam kanal dostepu,
// ktory juz dziala dla RSS/RAM), zamiast na bezposrednim dostepie do
// /proc.
//
// Pierwsza probka po starcie panelu (lub po restarcie serwisu) nie ma z
// czym sie porownac, wiec zwraca 0% - kolejne odswiezenie (Dashboard
// odpytuje co 5s) juz pokazuje realna wartosc.
const cpuSampleCache = new Map(); // username -> { totalCpuSeconds, timestampMs }

async function getProcessUsage(username) {
  try {
    const { stdout } = await execFileAsync('ps', ['-u', username, '--no-headers', '-o', 'rss,cputimes'], { timeout: 5000 });
    let rssKb = 0;
    let totalCpuSeconds = 0;
    for (const line of stdout.trim().split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [rss, cputimes] = trimmed.split(/\s+/);
      rssKb += parseInt(rss, 10) || 0;
      totalCpuSeconds += parseInt(cputimes, 10) || 0;
    }

    const nowMs = Date.now();
    const prev = cpuSampleCache.get(username);
    cpuSampleCache.set(username, { totalCpuSeconds, timestampMs: nowMs });

    let cpuUsedPercent = 0;
    if (prev) {
      const deltaSeconds = (nowMs - prev.timestampMs) / 1000;
      if (deltaSeconds > 0) {
        const deltaCpuSeconds = Math.max(0, totalCpuSeconds - prev.totalCpuSeconds);
        cpuUsedPercent = (deltaCpuSeconds / deltaSeconds) * 100;
      }
    }

    return { cpuUsedPercent: Math.round(cpuUsedPercent * 10) / 10, ramUsedMb: Math.round(rssKb / 1024) };
  } catch {
    return { cpuUsedPercent: 0, ramUsedMb: 0 };
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
// databasesUsed jest NA STALE 0 - w panelu nie istnieje jeszcze zaden
// mechanizm wiazacy bazy danych z kontem hostingowym (MariaDB/PostgreSQL/
// MongoDB sa zarzadzane globalnie w panelu admina, nie per-konto), wiec
// uczciwa odpowiedz to "0 z limitu pakietu", a nie zgadywanie.
async function getOwnAccount(username) {
  const account = listAccounts().find((a) => a.username === username);
  const [usage, sitesUsed, diskUsedMb] = await Promise.all([
    getProcessUsage(username),
    account ? countSites(username).catch(() => 0) : Promise.resolve(0),
    getDiskUsageMb(username).catch(() => 0)
  ]);
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
    // system.cpu.model w panelu admina) + liczba rdzeni PRZYDZIELONYCH
    // PRZEZ PAKIET, nie fizycznych rdzeni serwera. cpuPercent pakietu
    // (1-100) to procent JEDNEGO rdzenia; cpuCount() (hostingPackages.js)
    // to liczba fizycznych rdzeni serwera - iloczyn/100 daje realny
    // ekwiwalent rdzeni (np. cpuPercent=50 na 4-rdzeniowym serwerze =
    // 2 rdzenie), zgodnie z tym samym przelicznikiem co
    // packages.cpuTotalPercent w panelu admina.
    cpuModel: (os.cpus()[0]?.model || '').trim() || null,
    cpuCoresAllocated: account?.cpuPercent ? Math.round((account.cpuPercent * cpuCount()) / 100 * 10) / 10 : null,
    createdAt: account?.createdAt || null,
    cpuUsedPercent: usage.cpuUsedPercent,
    ramUsedMb: usage.ramUsedMb,
    sitesUsed,
    databasesUsed: 0
  };
}

export { getMustChangePassword, changeOwnPassword, getOwnAccount };
