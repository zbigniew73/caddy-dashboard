import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import { listAccounts } from './hostingAccounts.js';
import { getMailLimit } from './mailLimits.js';

const execFileAsync = promisify(execFile);
const SCRIPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts');
const DOMAIN_SCRIPT = path.join(SCRIPTS_DIR, 'mail-virtual-domain.sh');
const ACCOUNT_SCRIPT = path.join(SCRIPTS_DIR, 'mail-virtual-account.sh');
const ALIAS_SCRIPT = path.join(SCRIPTS_DIR, 'mail-virtual-alias.sh');

// Te same wzorce co server/services/hostingUserSites.js (DOMAIN_RE) i
// mail-virtual-*.sh (musza zostac zsynchronizowane recznie - jeden
// string, dwa jezyki, jak wszedzie w tym projekcie).
const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const ACCOUNT_RE = /^srv_[0-9]+$/;
const LOCALPART_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const EMAIL_RE = /^[a-z0-9._%+-]+@([a-z0-9-]+\.)+[a-z]{2,}$/;

function sudoErrorMessage(scriptName, stderr) {
  if (/password is required/i.test(stderr)) {
    return `Brak uprawnien sudo bez hasla dla ${scriptName} - sprawdz /etc/sudoers.d/caddy-dashboard`;
  }
  return stderr.trim() || null;
}

function runScript(scriptPath, scriptName, args, { timeout = 15000 } = {}) {
  return execFileAsync('sudo', ['-n', scriptPath, ...args], { timeout })
    .then(({ stdout }) => stdout)
    .catch((e) => {
      const stderr = (e.stderr || '').toString();
      throw Object.assign(new Error(sudoErrorMessage(scriptName, stderr) || e.message), { status: 500 });
    });
}

// Haslo idzie na stdin (spawn, nie execFile) - patrz komentarz w
// mail-virtual-account.sh / hosting-user-set-password.sh, argv nie jest
// bezpiecznym kanalem na sekret.
function runScriptWithStdin(scriptPath, scriptName, args, stdinContent) {
  return new Promise((resolve, reject) => {
    const child = spawn('sudo', ['-n', scriptPath, ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => reject(Object.assign(new Error(e.message), { status: 500 })));
    child.on('close', (code) => {
      if (code === 0) { resolve(stdout); return; }
      const message = sudoErrorMessage(scriptName, stderr);
      reject(Object.assign(new Error(message || `exit code ${code}`), { status: message ? 403 : 500 }));
    });
    child.stdin.write(stdinContent);
    child.stdin.end();
  });
}

function parseLines(stdout) {
  return stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}

async function listVirtualDomains() {
  const stdout = await runScript(DOMAIN_SCRIPT, 'mail-virtual-domain.sh', ['list']);
  return parseLines(stdout).map((line) => {
    const [domain, ownerAccount, createdAt] = line.split('|');
    return { domain, ownerAccount, createdAt };
  });
}

async function getDomainOwner(domain) {
  const domains = await listVirtualDomains();
  const found = domains.find((d) => d.domain === domain);
  if (!found) {
    throw Object.assign(new Error(`Domena '${domain}' nie jest zarejestrowana jako wirtualna.`), { status: 404 });
  }
  return found.ownerAccount;
}

async function addVirtualDomain(domain, ownerAccount) {
  const domainValue = String(domain || '').trim().toLowerCase();
  if (!DOMAIN_RE.test(domainValue)) {
    throw Object.assign(new Error('Nieprawidlowa domena.'), { status: 400 });
  }
  if (!ACCOUNT_RE.test(ownerAccount || '')) {
    throw Object.assign(new Error('Nieprawidlowe konto hostingowe.'), { status: 400 });
  }
  if (!listAccounts().some((a) => a.username === ownerAccount)) {
    throw Object.assign(new Error('Nie znaleziono konta hostingowego.'), { status: 400 });
  }
  const stdout = await runScript(DOMAIN_SCRIPT, 'mail-virtual-domain.sh', ['add', domainValue, ownerAccount]);
  return { success: true, message: stdout.trim() };
}

async function removeVirtualDomain(domain) {
  const domainValue = String(domain || '').trim().toLowerCase();
  if (!DOMAIN_RE.test(domainValue)) {
    throw Object.assign(new Error('Nieprawidlowa domena.'), { status: 400 });
  }
  const stdout = await runScript(DOMAIN_SCRIPT, 'mail-virtual-domain.sh', ['remove', domainValue]);
  return { success: true, message: stdout.trim() };
}

async function listVirtualMailboxes(domain) {
  const domainValue = String(domain || '').trim().toLowerCase();
  const stdout = await runScript(ACCOUNT_SCRIPT, 'mail-virtual-account.sh', ['list', domainValue]);
  return parseLines(stdout).map((line) => {
    const [localpart, enabled, createdAt] = line.split('|');
    return { localpart, enabled: enabled === '1', createdAt };
  });
}

async function addVirtualMailbox(domain, localpart, password) {
  const domainValue = String(domain || '').trim().toLowerCase();
  const localpartValue = String(localpart || '').trim().toLowerCase();
  if (!DOMAIN_RE.test(domainValue)) {
    throw Object.assign(new Error('Nieprawidlowa domena.'), { status: 400 });
  }
  if (!LOCALPART_RE.test(localpartValue)) {
    throw Object.assign(new Error('Nieprawidlowy login skrzynki.'), { status: 400 });
  }
  if (typeof password !== 'string' || password.length < 8) {
    throw Object.assign(new Error('Haslo musi miec co najmniej 8 znakow.'), { status: 400 });
  }
  const ownerAccount = await getDomainOwner(domainValue);
  const limit = getMailLimit(ownerAccount);
  const stdout = await runScriptWithStdin(
    ACCOUNT_SCRIPT, 'mail-virtual-account.sh',
    ['add', domainValue, localpartValue, String(limit.mailboxes)],
    password
  );
  return { success: true, message: stdout.trim() };
}

async function setVirtualMailboxPassword(domain, localpart, password) {
  const domainValue = String(domain || '').trim().toLowerCase();
  const localpartValue = String(localpart || '').trim().toLowerCase();
  if (!DOMAIN_RE.test(domainValue)) {
    throw Object.assign(new Error('Nieprawidlowa domena.'), { status: 400 });
  }
  if (!LOCALPART_RE.test(localpartValue)) {
    throw Object.assign(new Error('Nieprawidlowy login skrzynki.'), { status: 400 });
  }
  if (typeof password !== 'string' || password.length < 8) {
    throw Object.assign(new Error('Haslo musi miec co najmniej 8 znakow.'), { status: 400 });
  }
  const stdout = await runScriptWithStdin(
    ACCOUNT_SCRIPT, 'mail-virtual-account.sh',
    ['passwd', domainValue, localpartValue],
    password
  );
  return { success: true, message: stdout.trim() };
}

async function removeVirtualMailbox(domain, localpart) {
  const domainValue = String(domain || '').trim().toLowerCase();
  const localpartValue = String(localpart || '').trim().toLowerCase();
  if (!DOMAIN_RE.test(domainValue)) {
    throw Object.assign(new Error('Nieprawidlowa domena.'), { status: 400 });
  }
  const stdout = await runScript(ACCOUNT_SCRIPT, 'mail-virtual-account.sh', ['remove', domainValue, localpartValue]);
  return { success: true, message: stdout.trim() };
}

async function listVirtualAliases(domain) {
  const domainValue = String(domain || '').trim().toLowerCase();
  const stdout = await runScript(ALIAS_SCRIPT, 'mail-virtual-alias.sh', ['list', domainValue]);
  return parseLines(stdout).map((line) => {
    const [source, destination, createdAt] = line.split('|');
    return { source, destination, createdAt };
  });
}

async function addVirtualAlias(domain, sourceLocalpart, destination) {
  const domainValue = String(domain || '').trim().toLowerCase();
  const sourceValue = String(sourceLocalpart || '').trim().toLowerCase();
  const destinationValue = String(destination || '').trim().toLowerCase();
  if (!DOMAIN_RE.test(domainValue)) {
    throw Object.assign(new Error('Nieprawidlowa domena.'), { status: 400 });
  }
  if (!LOCALPART_RE.test(sourceValue)) {
    throw Object.assign(new Error('Nieprawidlowy login zrodlowy.'), { status: 400 });
  }
  if (!EMAIL_RE.test(destinationValue)) {
    throw Object.assign(new Error('Nieprawidlowy adres docelowy.'), { status: 400 });
  }
  const ownerAccount = await getDomainOwner(domainValue);
  const limit = getMailLimit(ownerAccount);
  const stdout = await runScript(
    ALIAS_SCRIPT, 'mail-virtual-alias.sh',
    ['add', domainValue, sourceValue, destinationValue, String(limit.aliases)]
  );
  return { success: true, message: stdout.trim() };
}

async function removeVirtualAlias(domain, sourceLocalpart, destination) {
  const domainValue = String(domain || '').trim().toLowerCase();
  const sourceValue = String(sourceLocalpart || '').trim().toLowerCase();
  const destinationValue = String(destination || '').trim().toLowerCase();
  if (!DOMAIN_RE.test(domainValue)) {
    throw Object.assign(new Error('Nieprawidlowa domena.'), { status: 400 });
  }
  const stdout = await runScript(
    ALIAS_SCRIPT, 'mail-virtual-alias.sh',
    ['remove', domainValue, sourceValue, destinationValue]
  );
  return { success: true, message: stdout.trim() };
}

export {
  listVirtualDomains, addVirtualDomain, removeVirtualDomain,
  listVirtualMailboxes, addVirtualMailbox, setVirtualMailboxPassword, removeVirtualMailbox,
  listVirtualAliases, addVirtualAlias, removeVirtualAlias
};
