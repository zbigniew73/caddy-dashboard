import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import tls from 'tls';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/mail-install.sh');
const TOGGLE_ACCESS_SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/mail-toggle-access.sh');
const MAIL_DISABLED_LIST = '/etc/dovecot/mail-disabled.list';
const USERNAME_RE = /^srv_[0-9]+$/;

// Bez trybow/wersji do wyboru (w odroznieniu od MariaDB/Redis) - jeden,
// stabilny, systemowy zestaw pakietow (postfix + dovecot + opendkim),
// patrz mail-install.sh. Timeout jak przy MariaDB - instalacja trzech
// pakietow + generowanie certyfikatu moze potrwac.
async function installMail() {
  try {
    const { stdout } = await execFileAsync('sudo', ['-n', SCRIPT_PATH], { timeout: 300000 });
    return { success: true, message: stdout.trim() };
  } catch (e) {
    const stderr = (e.stderr || '').toString().trim();
    if (/password is required/i.test(stderr)) {
      throw Object.assign(
        new Error('Brak uprawnien sudo bez hasla dla instalacji Mail Server - sprawdz /etc/sudoers.d/caddy-dashboard'),
        { status: 403 }
      );
    }
    throw Object.assign(new Error(stderr || e.message), { status: 500 });
  }
}

// Odczyt bezposredni (bez sudo) - mail-toggle-access.sh zawsze zostawia
// ten plik world-readable (chmod 644), a zawartosc to tylko nazwy
// istniejacych juz kont (i tak widoczne w /etc/passwd), wiec nie ma tu
// nic wrazliwego. Brak pliku (Poczta niezainstalowana albo nikt jeszcze
// nikogo nie wylaczyl) = pusta lista = wszyscy maja dostep.
function readDisabledUsernames() {
  try {
    return new Set(
      readFileSync(MAIL_DISABLED_LIST, 'utf-8')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    );
  } catch {
    return new Set();
  }
}

async function setMailAccess(username, enabled) {
  if (!USERNAME_RE.test(username)) {
    throw Object.assign(new Error('Nieprawidlowa nazwa uzytkownika.'), { status: 400 });
  }
  try {
    const { stdout } = await execFileAsync(
      'sudo', ['-n', TOGGLE_ACCESS_SCRIPT_PATH, username, enabled ? 'enable' : 'disable'],
      { timeout: 15000 }
    );
    return { success: true, message: stdout.trim() };
  } catch (e) {
    const stderr = (e.stderr || '').toString().trim();
    if (/password is required/i.test(stderr)) {
      throw Object.assign(
        new Error('Brak uprawnien sudo bez hasla dla zmiany dostepu do poczty - sprawdz /etc/sudoers.d/caddy-dashboard'),
        { status: 403 }
      );
    }
    throw Object.assign(new Error(stderr || e.message), { status: 500 });
  }
}

// Rozmiar kolejki pocztowej Postfixa - `postqueue -p` jest domyslnie
// dostepne bez sudo dla dowolnego lokalnego uzytkownika (standardowe
// uprawnienia Postfixa do PODGLADU kolejki, nie do jej modyfikacji).
// Zwraca null (zamiast rzucac), gdy Postfix nie jest zainstalowany/
// uruchomiony - to pole ma byc informacyjne, nie blokowac calej karty
// statystyk przy braku uslugi.
async function getMailQueueCount() {
  try {
    const { stdout } = await execFileAsync('postqueue', ['-p']);
    if (/Mail queue is empty/i.test(stdout)) return 0;
    return stdout.split('\n').filter((line) => /^[A-F0-9]/.test(line)).length;
  } catch {
    return null;
  }
}

// Sprawdza, czy dla podanej nazwy hosta jest FAKTYCZNIE serwowany zaufany
// certyfikat (Let's Encrypt) - dla WYKRYWANIA (ten kafelek) celowo NIE
// grzebiemy w plikach, tylko pytamy o dokladnie to samo, co zobaczylby
// prawdziwy klient IMAP/SMTP: prawdziwe polaczenie TLS do <host>:443 z
// weryfikacja lancucha zaufania przez systemowe CA. Self-signed =
// trusted:false (authorizationError ustawiony), brak DNS/polaczenia =
// trusted:false z osobnym powodem. Bez sudo - to zwykle wychodzace
// polaczenie sieciowe, zaden specjalny dostep nie jest potrzebny.
// (Dla samej PODMIANY certyfikatu w Postfiksie/Dovecocie - patrz
// mail-tls-swap.sh - lokalizacja magazynu certow Caddy JEST juz
// zweryfikowana na zywym serwerze 2026-08-14, `sudo find /var/lib/caddy
// -iname "mail.<domena>*"`.)
function checkMailCertTrusted(hostname, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const socket = tls.connect(
      { host: hostname, port: 443, servername: hostname, rejectUnauthorized: true, timeout: timeoutMs },
      () => {
        if (settled) return;
        settled = true;
        const cert = socket.getPeerCertificate();
        socket.end();
        resolve({
          trusted: socket.authorized === true,
          validTo: cert && cert.valid_to ? cert.valid_to : null,
          reason: socket.authorized ? null : (socket.authorizationError || 'unknown')
        });
      }
    );
    socket.on('error', (e) => {
      if (settled) return;
      settled = true;
      resolve({ trusted: false, validTo: null, reason: e.code || e.message });
    });
    socket.on('timeout', () => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ trusted: false, validTo: null, reason: 'timeout' });
    });
  });
}

const TLS_SWAP_SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/mail-tls-swap.sh');
const LE_CERT_PATH = '/etc/pki/tls/certs/mail-letsencrypt.crt';

// Odczyt bezposredni (bez sudo) - `postconf -h` czyta /etc/postfix/main.cf,
// ktory jest domyslnie world-readable, i sam binarny `postconf` nie
// wymaga roota do samego ODCZYTU wartosci (w odroznieniu od `postconf -e`,
// ktore zapisuje plik). Porownanie sciezki z LE_CERT_PATH (a nie np.
// istnienia pliku) - to jedyny wiarygodny sposob, zeby wiedziec, KTORY
// certyfikat jest aktywny TERAZ, niezaleznie od tego czy plik
// self-signed/letsencrypt akurat istnieje na dysku.
async function getMailTlsStatus() {
  try {
    const { stdout } = await execFileAsync('postconf', ['-h', 'smtpd_tls_cert_file']);
    return { active: stdout.trim() === LE_CERT_PATH ? 'letsencrypt' : 'selfsigned' };
  } catch {
    return { active: null };
  }
}

async function setMailTlsSwap(domain, enabled) {
  if (!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)) {
    throw Object.assign(new Error('Nieprawidlowa domena.'), { status: 400 });
  }
  try {
    const { stdout } = await execFileAsync(
      'sudo', ['-n', TLS_SWAP_SCRIPT_PATH, enabled ? 'enable' : 'disable', domain],
      { timeout: 30000 }
    );
    return { success: true, message: stdout.trim() };
  } catch (e) {
    const stderr = (e.stderr || '').toString().trim();
    if (/password is required/i.test(stderr)) {
      throw Object.assign(
        new Error('Brak uprawnien sudo bez hasla dla podmiany certyfikatu TLS poczty - sprawdz /etc/sudoers.d/caddy-dashboard'),
        { status: 403 }
      );
    }
    throw Object.assign(new Error(stderr || e.message), { status: 500 });
  }
}

export {
  installMail, readDisabledUsernames, setMailAccess, getMailQueueCount, checkMailCertTrusted,
  getMailTlsStatus, setMailTlsSwap
};
