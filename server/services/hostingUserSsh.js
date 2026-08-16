import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { getCurrentSshPort } from './sshConfig.js';

const execFileAsync = promisify(execFile);
const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url)) + '/../scripts';

const KEY_TYPE_RE = /^(ssh-rsa|ssh-ed25519|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521)$/;
const MAX_COMMENT_LENGTH = 100;

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function sudoErrorMessage(scriptName, stderr) {
  if (/password is required/i.test(stderr)) {
    return `Brak uprawnien sudo bez hasla dla ${scriptName} - sprawdz /etc/sudoers.d/caddy-dashboard`;
  }
  return stderr.trim() || null;
}

// "Host" pod ktory user ma sie faktycznie polaczyc z zewnatrz - .env
// HOST to WLASNY adres nasluchu panelu (np. 127.0.0.1 gdy Caddy stoi
// przed nim jako reverse proxy - patrz EXPOSURE=world w install.sh),
// wiec NIE nadaje sie do pokazania jako adres SSH. Realny publiczny IP
// ustalamy przez zewnetrzny serwis (ten sam mechanizm, ktorym
// posluguje sie wiele paneli hostingowych do wyswietlenia "adresu
// serwera") - jesli polaczenie wychodzace zawiedzie (brak internetu,
// zablokowany egress), spadamy na os.hostname() jako uczciwy,
// nie-zgadywany fallback zamiast fabrykowac IP.
let cachedPublicIp = null;

async function getPublicIp() {
  if (cachedPublicIp) return cachedPublicIp;
  try {
    const res = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const ip = (await res.text()).trim();
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
        cachedPublicIp = ip;
        return ip;
      }
    }
  } catch {
    // brak internetu / egress zablokowany - honest fallback ponizej
  }
  return os.hostname();
}

function getRawKeys(username) {
  return new Promise((resolve, reject) => {
    execFileAsync('sudo', ['-n', `${SCRIPTS_DIR}/hosting-user-ssh-keys-get.sh`, username], { timeout: 10000 })
      .then(({ stdout }) => resolve(stdout))
      .catch((e) => {
        const stderr = (e.stderr || '').toString();
        reject(Object.assign(
          new Error(sudoErrorMessage('hosting-user-ssh-keys-get.sh', stderr) || e.message), { status: 500 }
        ));
      });
  });
}

function setRawKeys(username, content) {
  return new Promise((resolve, reject) => {
    const child = spawn('sudo', ['-n', `${SCRIPTS_DIR}/hosting-user-ssh-keys-set.sh`, username]);
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => reject(Object.assign(new Error(e.message), { status: 500 })));
    child.on('close', (code) => {
      if (code === 0) { resolve(); return; }
      const message = sudoErrorMessage('hosting-user-ssh-keys-set.sh', stderr);
      reject(Object.assign(new Error(message || `exit code ${code}`), { status: message ? 403 : 500 }));
    });
    child.stdin.write(content);
    child.stdin.end();
  });
}

// authorized_keys: jedna linia = "<typ> <base64> [komentarz...]".
// Komentarz standardowego formatu authorized_keys sluzy tu jako "Nazwa"
// klucza (pole Name w formularzu dodawania) - zaden osobny plik metadanych
// nie jest potrzebny, to dokladnie do tego jest przeznaczony natywny
// mechanizm OpenSSH.
function parseKeys(raw) {
  return raw.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((line) => {
      const parts = line.split(/\s+/);
      return { type: parts[0], keyData: parts[1], comment: parts.slice(2).join(' ') };
    })
    .filter((k) => KEY_TYPE_RE.test(k.type) && k.keyData);
}

function serializeKeys(keys) {
  const lines = keys.map((k) => `${k.type} ${k.keyData}${k.comment ? ' ' + k.comment : ''}`);
  return lines.length ? lines.join('\n') + '\n' : '';
}

function validatePublicKey(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed) throw badRequest('Klucz publiczny jest wymagany.');
  if (/[\r\n]/.test(trimmed)) throw badRequest('Wklej dokladnie jedna linie klucza publicznego.');
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2 || !KEY_TYPE_RE.test(parts[0])) {
    throw badRequest('Nieprawidlowy format klucza - oczekiwano np. "ssh-ed25519 AAAA..." lub "ssh-rsa AAAA...".');
  }
  if (!/^[A-Za-z0-9+/]+=*$/.test(parts[1])) {
    throw badRequest('Nieprawidlowy format klucza - czesc base64 zawiera niedozwolone znaki.');
  }
  return { type: parts[0], keyData: parts[1] };
}

async function getConnectionInfo(username) {
  const [host, port] = await Promise.all([getPublicIp(), getCurrentSshPort()]);
  return { host, port, username };
}

async function listSshKeys(username) {
  return parseKeys(await getRawKeys(username));
}

async function addSshKey(username, { name, publicKey }) {
  const { type, keyData } = validatePublicKey(publicKey);
  const comment = String(name || '').trim().slice(0, MAX_COMMENT_LENGTH).replace(/\s+/g, ' ');

  const keys = parseKeys(await getRawKeys(username));
  if (keys.some((k) => k.keyData === keyData)) {
    throw badRequest('Ten klucz publiczny jest juz dodany.');
  }
  keys.push({ type, keyData, comment });
  await setRawKeys(username, serializeKeys(keys));
  return keys;
}

async function deleteSshKey(username, keyData) {
  const keys = parseKeys(await getRawKeys(username));
  const filtered = keys.filter((k) => k.keyData !== keyData);
  if (filtered.length === keys.length) {
    throw Object.assign(new Error('Nie znaleziono klucza.'), { status: 404 });
  }
  await setRawKeys(username, serializeKeys(filtered));
  return filtered;
}

// Lokalizacja serwera (miasto/region) do kafelka Uptime na Dashboardzie
// usera - geo-IP publicznego adresu (ipapi.co, bez klucza API). Cache w
// module (bez TTL, tak samo jak cachedPublicIp powyzej) - lokalizacja
// serwera sie nie zmienia, a Dashboard odpytuje /me co 5s (patrz
// startUsageRefresh w web/user/app.js), wiec bez tego cache'a kazde
// odswiezenie bilaby to zewnetrzne zapytanie sieciowe. Cichy null przy
// niepowodzeniu (brak internetu/egress/limit API) - to czysto
// kosmetyczna dodatkowa linia, nie moze zablokowac reszty kafelka.
let cachedServerLocation;

async function getServerLocation() {
  if (cachedServerLocation !== undefined) return cachedServerLocation;
  try {
    const ip = await getPublicIp();
    const res = await fetch(`https://ipapi.co/${ip}/json/`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      const parts = [data.city, data.region].filter(Boolean);
      cachedServerLocation = parts.length ? parts.join(', ') : null;
      return cachedServerLocation;
    }
  } catch {
    // brak internetu / limit API / IP niepubliczne - honest null ponizej
  }
  cachedServerLocation = null;
  return cachedServerLocation;
}

export { getConnectionInfo, listSshKeys, addSshKey, deleteSshKey, getPublicIp, getServerLocation };
