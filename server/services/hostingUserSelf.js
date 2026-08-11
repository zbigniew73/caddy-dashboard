import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import { pamAuthenticate } from './auth.js';
import { listAccounts } from './hostingAccounts.js';

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
async function getProcessUsage(username) {
  try {
    const { stdout } = await execFileAsync('ps', ['-u', username, '--no-headers', '-o', '%cpu,rss'], { timeout: 5000 });
    let cpuPercent = 0;
    let rssKb = 0;
    for (const line of stdout.trim().split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [cpu, rss] = trimmed.split(/\s+/);
      cpuPercent += parseFloat(cpu) || 0;
      rssKb += parseInt(rss, 10) || 0;
    }
    return { cpuUsedPercent: Math.round(cpuPercent * 10) / 10, ramUsedMb: Math.round(rssKb / 1024) };
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
  const [usage, sitesUsed] = await Promise.all([
    getProcessUsage(username),
    account ? countSites(username).catch(() => 0) : Promise.resolve(0)
  ]);
  return {
    username,
    homeDir: account?.homeDir || null,
    packageName: account?.packageName || null,
    diskQuotaMb: account?.diskQuotaMb ?? null,
    ramLimitMb: account?.ramLimitMb ?? null,
    maxDomains: account?.maxDomains ?? null,
    maxDatabases: account?.maxDatabases ?? null,
    cpuPercentLimit: account?.cpuPercent ?? null,
    createdAt: account?.createdAt || null,
    cpuUsedPercent: usage.cpuUsedPercent,
    ramUsedMb: usage.ramUsedMb,
    sitesUsed,
    databasesUsed: 0
  };
}

export { getMustChangePassword, changeOwnPassword, getOwnAccount };
