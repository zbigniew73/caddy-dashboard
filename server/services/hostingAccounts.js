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
const HOSTING_PREFIX = 'srv_';
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

function listAccounts() {
  const packages = listPackages();
  return loadAccounts().map((a) => {
    const pkg = packages.find((p) => p.id === a.packageId);
    return { ...a, packageName: pkg ? pkg.name : null, diskQuotaMb: pkg ? pkg.diskQuotaMb : null };
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

  await runScript('hosting-account-create.sh', [username, diskMountPoint]);
  const homeDir = `${diskMountPoint}/${username}`;

  if (diskFsType === 'ext4') {
    await applyExt4Quota(username, pkg.diskQuotaMb, pkg.diskQuotaMb, diskMountPoint);
  } else if (diskFsType === 'xfs') {
    await applyXfsQuota(username, homeDir, pkg.diskQuotaMb, pkg.diskQuotaMb, diskMountPoint);
  }

  const account = {
    id: randomUUID(), username, packageId, homeDir, diskFsType, createdAt: new Date().toISOString()
  };
  accounts.push(account);
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
  await runScript('hosting-account-delete.sh', [account.username]);
  accounts.splice(idx, 1);
  saveAccounts(accounts);
  return account;
}

export { listAccounts, createAccount, deleteAccount, getNextHostingUsername };
