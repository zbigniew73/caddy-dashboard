import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { listPackages, getDiskSettings } from './hostingPackages.js';
import { applyExt4Quota, applyXfsQuota } from './diskQuota.js';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data');
const DATA_PATH = path.join(DATA_DIR, 'hosting-accounts.json');
const SCRIPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts');

const USERNAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOSTING_PREFIX = 'srv_';
// Katalog domowy kont hostingowych jest ZAWSZE pod /home, niezaleznie od
// diskMountPoint (Zasoby systemowe > Mechanizm limitu dysku) - to drugie
// to WYLACZNIE punkt montowania dla komend quota (xfs_quota/setquota),
// ktory u czesci adminow to "/" (root, bo /home nie jest osobna
// partycja) - mieszanie tych dwoch pojec dawalo homeDir w stylu
// "//srv_1001" i konta bez katalogu w /home.
const HOME_BASE_DIR = '/home';
const HOSTING_ID_START = 1000;

// Pierwszy wolny numer dla "srv_<id>" - <id> jest jednoczesnie wymuszanym
// UID-em konta (patrz hosting-account-create.sh: -u <id> gdy nazwa pasuje
// do tego wzorca), wiec sprawdzamy zarowno zajete nazwy jak i zajete UID-y
// w /etc/passwd (swiatoczytelny, nie trzeba sudo). To tylko PODPOWIEDZ w
// formularzu - admin moze ja nadpisac, useradd i tak odrzuci kolizje.
function getNextHostingUsername() {
  const passwd = readFileSync('/etc/passwd', 'utf-8');
  const usedUids = new Set();
  const usedIds = new Set();
  for (const line of passwd.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split(':');
    const uid = parseInt(parts[2], 10);
    if (Number.isInteger(uid)) usedUids.add(uid);
    const m = /^srv_([0-9]+)$/.exec(parts[0]);
    if (m) usedIds.add(parseInt(m[1], 10));
  }
  let id = HOSTING_ID_START;
  while (usedIds.has(id) || usedUids.has(id)) id += 1;
  return { prefix: HOSTING_PREFIX, nextId: id, username: `${HOSTING_PREFIX}${id}` };
}

// UID konta - potrzebny do egzekwowania limitu RAM (user-<uid>.slice, patrz
// applyRamLimit ponizej). Swiatoczytelny odczyt z /etc/passwd, bez sudo -
// ten sam wzorzec co getNextHostingUsername powyzej. Zwraca null, jesli
// usera nie ma (nie powinno sie zdarzyc dla realnie istniejacego konta).
function getUidForUsername(username) {
  const passwd = readFileSync('/etc/passwd', 'utf-8');
  for (const line of passwd.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split(':');
    if (parts[0] === username) {
      const uid = parseInt(parts[2], 10);
      return Number.isInteger(uid) ? uid : null;
    }
  }
  return null;
}

function loadAccounts() {
  try {
    const parsed = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
    return Array.isArray(parsed.accounts) ? parsed.accounts : [];
  } catch {
    return [];
  }
}

function saveAccounts(accounts) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_PATH, JSON.stringify({ accounts }, null, 2), { mode: 0o600 });
}

function runScript(scriptName, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('sudo', ['-n', `${SCRIPTS_DIR}/${scriptName}`, ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => reject(Object.assign(new Error(e.message), { status: 500 })));
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      if (/password is required/i.test(stderr)) {
        reject(Object.assign(
          new Error(`Brak uprawnien sudo bez hasla dla ${scriptName} - sprawdz /etc/sudoers.d/caddy-dashboard`),
          { status: 403 }
        ));
        return;
      }
      reject(Object.assign(new Error(stderr.trim() || `exit code ${code}`), { status: 500 }));
    });
  });
}

// Egzekwuje GLOWNY limit RAM konta (pole ramLimitMb pakietu) przez
// user-<uid>.slice - natywny mechanizm systemd, ktory ogranicza LACZNE
// zuzycie pamieci wszystkich procesow dzialajacych jako dany Linux user
// (sesje SSH, a przy wlaczonym lingeringu takze uslugi w tle). To JEDEN,
// wspolny parametr zamiast osobnego limitu pamieci w kazdej przyszlej
// uslugsie hostowanej na koncie (PHP-FPM, cron itd.) - patrz
// hosting-account-slice-set.sh.
async function applyRamLimit(uid, ramLimitMb) {
  await runScript('hosting-account-slice-set.sh', [String(uid), String(ramLimitMb)]);
}

function parseContactFields(body) {
  const fullName = String(body?.fullName || '').trim();
  const email = String(body?.email || '').trim();
  if (email && !EMAIL_RE.test(email)) {
    throw Object.assign(new Error('Nieprawidlowy adres e-mail.'), { status: 400 });
  }
  return { fullName, email };
}

function listAccounts() {
  const packages = listPackages();
  return loadAccounts().map((a) => {
    const pkg = packages.find((p) => p.id === a.packageId);
    return {
      ...a,
      packageName: pkg ? pkg.name : null,
      diskQuotaMb: pkg ? pkg.diskQuotaMb : null,
      ramLimitMb: pkg ? pkg.ramLimitMb : null,
      maxDomains: pkg ? pkg.maxDomains : null,
      maxDatabases: pkg ? pkg.maxDatabases : null,
      cpuPercent: pkg ? pkg.cpuPercent : null
    };
  });
}

// Tworzy usera systemowego z dostepem SSH (haslo tymczasowe, wymuszona
// zmiana przy pierwszym logowaniu, katalog stron Caddy - patrz
// hosting-account-create.sh) i OD RAZU stosuje limit dysku pakietu przez
// mechanizm ustawiony globalnie w getDiskSettings() (Brak/ext4/XFS). Jesli
// mechanizm to "none", konto powstaje bez wymuszonego limitu (tak samo jak
// pakiet pokazuje wtedy diskQuotaMode: "none"). Dla ext4/XFS wymagana jest
// wczesniejsza pozytywna weryfikacja (POST /quota/verify, patrz
// diskQuota.js verifyQuotaMechanism) - bez niej wpisy do /etc/projects i
// /etc/projid (XFS) w ogole nie powstaja, funkcja odrzuca zadanie ponizej.
// Rowniez OD RAZU naklada GLOWNY limit RAM pakietu (ramLimitMb) przez
// user-<uid>.slice - patrz applyRamLimit powyzej.
//
// Jesli useradd sie powiedzie, ale nastepny krok (nalozenie quota) zawiedzie,
// blad leci dalej i rekord konta NIE jest zapisywany w panelu - w systemie
// zostaje jednak juz utworzony (osierocony z punktu widzenia panelu) user.
// To swiadomy kompromis (brak automatycznego rollbacku/userdel na błąd) -
// admin dostanie czytelny blad i moze dokonczyc/posprzatac recznie.
async function createAccount(body) {
  const username = String(body?.username || '').trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    throw Object.assign(
      new Error('Nieprawidlowa nazwa uzytkownika (male litery/cyfry/_/-, zaczyna sie od litery lub _, max 32 znaki).'),
      { status: 400 }
    );
  }

  const packageId = String(body?.packageId || '');
  const pkg = listPackages().find((p) => p.id === packageId);
  if (!pkg) {
    throw Object.assign(new Error('Nie znaleziono wybranego pakietu.'), { status: 400 });
  }

  const accounts = loadAccounts();
  if (accounts.some((a) => a.username === username)) {
    throw Object.assign(new Error(`Konto '${username}' juz istnieje w panelu.`), { status: 409 });
  }

  const { fullName, email } = parseContactFields(body);

  const { diskFsType, diskMountPoint, diskQuotaVerified } = getDiskSettings();
  if (diskFsType !== 'none' && !diskQuotaVerified) {
    throw Object.assign(
      new Error(
        `Mechanizm limitu dysku (${diskFsType.toUpperCase()} na ${diskMountPoint}) nie zostal zweryfikowany - ` +
        `przejdz do karty "Zasoby systemowe" i nacisnij Zastosuj, az pojawi sie potwierdzenie ze quota dziala, zanim dodasz konto.`
      ),
      { status: 409 }
    );
  }

  await runScript('hosting-account-create.sh', [username, HOME_BASE_DIR]);
  const homeDir = `${HOME_BASE_DIR}/${username}`;
  const uid = getUidForUsername(username);
  if (uid === null) {
    throw Object.assign(new Error(`Konto '${username}' utworzone, ale nie mozna ustalic jego UID (limit RAM nie zostal nalozony).`), { status: 500 });
  }

  if (diskFsType === 'ext4') {
    await applyExt4Quota(username, pkg.diskQuotaMb, pkg.diskQuotaMb, diskMountPoint);
  } else if (diskFsType === 'xfs') {
    await applyXfsQuota(username, homeDir, pkg.diskQuotaMb, pkg.diskQuotaMb, diskMountPoint);
  }

  await applyRamLimit(uid, pkg.ramLimitMb);

  const account = {
    id: randomUUID(), username, uid, packageId, homeDir, diskFsType, fullName, email, createdAt: new Date().toISOString()
  };
  accounts.push(account);
  saveAccounts(accounts);
  return account;
}

// Edycja konta - nazwa uzytkownika i katalog domowy sa niezmienne (powiazane
// z realnym userem systemowym), mozna zmienic dane kontaktowe oraz pakiet.
// Zmiana pakietu przeklada sie od razu na nowy limit dysku, tym samym
// mechanizmem i tymi samymi warunkami (weryfikacja quota) co przy tworzeniu
// konta - patrz createAccount powyzej.
async function updateAccount(id, body) {
  const accounts = loadAccounts();
  const idx = accounts.findIndex((a) => a.id === id);
  if (idx === -1) {
    throw Object.assign(new Error('Nie znaleziono konta.'), { status: 404 });
  }
  const account = accounts[idx];

  const packageId = String(body?.packageId || '');
  const pkg = listPackages().find((p) => p.id === packageId);
  if (!pkg) {
    throw Object.assign(new Error('Nie znaleziono wybranego pakietu.'), { status: 400 });
  }

  const { fullName, email } = parseContactFields(body);

  if (packageId !== account.packageId) {
    const { diskFsType, diskMountPoint, diskQuotaVerified } = getDiskSettings();
    if (diskFsType !== 'none' && !diskQuotaVerified) {
      throw Object.assign(
        new Error(
          `Mechanizm limitu dysku (${diskFsType.toUpperCase()} na ${diskMountPoint}) nie zostal zweryfikowany - ` +
          `przejdz do karty "Zasoby systemowe" i nacisnij Zastosuj, az pojawi sie potwierdzenie ze quota dziala, zanim zmienisz pakiet.`
        ),
        { status: 409 }
      );
    }
    if (diskFsType === 'ext4') {
      await applyExt4Quota(account.username, pkg.diskQuotaMb, pkg.diskQuotaMb, diskMountPoint);
    } else if (diskFsType === 'xfs') {
      await applyXfsQuota(account.username, account.homeDir, pkg.diskQuotaMb, pkg.diskQuotaMb, diskMountPoint);
    }

    // Konta zalozone przed dodaniem egzekwowania RAM nie maja jeszcze
    // zapisanego uid - dociagamy go z /etc/passwd i utrwalamy przy okazji.
    const uid = Number.isInteger(account.uid) ? account.uid : getUidForUsername(account.username);
    if (uid === null) {
      throw Object.assign(new Error(`Nie mozna ustalic UID konta '${account.username}' (limit RAM nie zostal zaktualizowany).`), { status: 500 });
    }
    await applyRamLimit(uid, pkg.ramLimitMb);
    account.uid = uid;

    account.diskFsType = diskFsType;
    account.packageId = packageId;
  }

  account.fullName = fullName;
  account.email = email;
  accounts[idx] = account;
  saveAccounts(accounts);
  return account;
}

async function deleteAccount(id) {
  const accounts = loadAccounts();
  const idx = accounts.findIndex((a) => a.id === id);
  if (idx === -1) {
    throw Object.assign(new Error('Nie znaleziono konta.'), { status: 404 });
  }
  const account = accounts[idx];
  // UID trzeba znac PRZED userdel - po usunieciu konta wpis znika z
  // /etc/passwd i nie da sie go juz odczytac.
  const uid = Number.isInteger(account.uid) ? account.uid : getUidForUsername(account.username);
  await runScript('hosting-account-delete.sh', [account.username]);
  if (uid !== null) {
    await runScript('hosting-account-slice-remove.sh', [String(uid)]);
  }
  accounts.splice(idx, 1);
  saveAccounts(accounts);
  return account;
}

export { listAccounts, createAccount, updateAccount, deleteAccount, getNextHostingUsername };
