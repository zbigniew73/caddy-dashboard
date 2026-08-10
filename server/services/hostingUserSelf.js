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

// Wlasny rekord z rejestru panelu (hosting-accounts.json) - jesli konto
// istnieje jako user systemowy, ale z jakiegos powodu nie ma wpisu w
// rejestrze (np. utworzone recznie poza panelem), zwracamy nulle zamiast
// bledu - panel klienta ma sie po prostu pokazac z pustymi polami.
function getOwnAccount(username) {
  const account = listAccounts().find((a) => a.username === username);
  return {
    username,
    homeDir: account?.homeDir || null,
    packageName: account?.packageName || null,
    diskQuotaMb: account?.diskQuotaMb ?? null,
    createdAt: account?.createdAt || null
  };
}

export { getMustChangePassword, changeOwnPassword, getOwnAccount };
