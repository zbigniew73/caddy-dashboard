import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { getServiceDef, getServiceStatus } from './systemServices.js';
import { listAccounts } from './hostingAccounts.js';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data');
const DATA_PATH = path.join(DATA_DIR, 'hosting-databases.json');
const SCRIPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts');

// Kazdy silnik ma wlasny skrypt tworzacy/usuwajacy (root, patrz komentarze
// w tych skryptach - haslo roota/admina czytaja z tego samego pliku co
// */install.sh), wlasny domyslny port (std, do wyswietlenia jako
// podpowiedz polaczenia - NIE odczytywany z realnej konfiguracji, ale to
// standardowy, nigdy niezmieniany przez ten panel port kazdego silnika).
const ENGINES = {
  mariadb: { scriptName: 'hosting-db-mariadb.sh', defaultPort: 3306 },
  postgresql: { scriptName: 'hosting-db-postgresql.sh', defaultPort: 5432 },
  mongodb: { scriptName: 'hosting-db-mongodb.sh', defaultPort: 27017 }
};

const NAME_SUFFIX_RE = /^[A-Za-z0-9_]{1,32}$/;

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function loadData() {
  try {
    const parsed = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
    return Array.isArray(parsed.databases) ? parsed.databases : [];
  } catch {
    return [];
  }
}

function saveData(databases) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_PATH, JSON.stringify({ databases }, null, 2), { mode: 0o600 });
}

// Ta sama regula co gen_password() w lib-gen-password.sh (16 znakow = 5
// wielkich + 5 malych + 3 cyfry + 3 znaki specjalne z bezpiecznego
// zestawu bez cudzyslowow/apostrofow/backslasha - haslo trafia
// bezposrednio do zapytan SQL/mongosh w skryptach powyzej) - jedna regula
// haseł w calym projekcie, teraz tez tutaj.
function generatePassword() {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  const special = '!@#%*()_+=-';
  const pick = (set, n) => Array.from({ length: n }, () => set[Math.floor(Math.random() * set.length)]);
  const chars = [...pick(upper, 5), ...pick(lower, 5), ...pick(digits, 3), ...pick(special, 3)];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// Silniki FAKTYCZNIE zainstalowane i uruchomione na serwerze - user widzi
// tylko te, ktore admin zainstalowal (patrz systemServices.js, ten sam
// mechanizm co panel admina). "found" samo nie wystarcza (usluga moglaby
// byc zainstalowana, ale zatrzymana) - wymagamy activeState==='active'.
async function listAvailableEngines() {
  const results = await Promise.all(
    Object.keys(ENGINES).map(async (engine) => {
      const status = await getServiceStatus(getServiceDef(engine));
      return status.found && status.activeState === 'active' ? engine : null;
    })
  );
  return results.filter(Boolean);
}

function getAccount(username) {
  return listAccounts().find((a) => a.username === username) || null;
}

async function listOwnDatabases(username) {
  const [all, engines] = await Promise.all([Promise.resolve(loadData()), listAvailableEngines()]);
  const account = getAccount(username);
  return {
    engines,
    maxDatabases: account?.maxDatabases ?? null,
    items: all.filter((d) => d.accountUsername === username).map((d) => ({
      id: d.id,
      engine: d.engine,
      dbName: d.dbName,
      dbUser: d.dbName,
      password: d.password,
      host: 'localhost',
      port: ENGINES[d.engine]?.defaultPort ?? null,
      createdAt: d.createdAt
    }))
  };
}

function countOwnDatabases(username) {
  return loadData().filter((d) => d.accountUsername === username).length;
}

async function createDatabase(username, { engine, nameSuffix }) {
  const availableEngines = await listAvailableEngines();
  if (!availableEngines.includes(engine)) {
    throw badRequest('Wybrany silnik bazy danych nie jest dostepny na tym serwerze.');
  }
  const suffix = String(nameSuffix || '').trim();
  if (!NAME_SUFFIX_RE.test(suffix)) {
    throw badRequest('Nazwa bazy moze zawierac tylko litery, cyfry i podkreslenia (max 32 znaki).');
  }

  const account = getAccount(username);
  const maxDatabases = account?.maxDatabases ?? 0;
  const used = countOwnDatabases(username);
  if (used >= maxDatabases) {
    throw badRequest(`Osiagnieto limit baz danych z pakietu (${maxDatabases}).`);
  }

  const dbName = `${username}_${suffix}`;
  const all = loadData();
  if (all.some((d) => d.dbName === dbName)) {
    throw badRequest('Baza o tej nazwie juz istnieje.');
  }

  const password = generatePassword();
  await runDbScript(ENGINES[engine].scriptName, 'create', dbName, password);

  const record = {
    id: randomUUID(),
    accountUsername: username,
    engine,
    dbName,
    password,
    createdAt: new Date().toISOString()
  };
  all.push(record);
  saveData(all);
  return {
    id: record.id,
    engine,
    dbName,
    dbUser: dbName,
    password,
    host: 'localhost',
    port: ENGINES[engine].defaultPort,
    createdAt: record.createdAt
  };
}

async function deleteDatabase(username, id) {
  const all = loadData();
  const record = all.find((d) => d.id === id && d.accountUsername === username);
  if (!record) throw Object.assign(new Error('Nie znaleziono bazy danych.'), { status: 404 });

  const engineDef = ENGINES[record.engine];
  if (engineDef) await runDbScript(engineDef.scriptName, 'delete', record.dbName, null);

  saveData(all.filter((d) => d.id !== id));
}

function sudoErrorMessage(scriptName, stderr) {
  if (/password is required/i.test(stderr)) {
    return `Brak uprawnien sudo bez hasla dla ${scriptName} - sprawdz /etc/sudoers.d/caddy-dashboard`;
  }
  return stderr.trim() || null;
}

function runDbScript(scriptName, action, dbName, password) {
  return new Promise((resolve, reject) => {
    const child = spawn('sudo', ['-n', `${SCRIPTS_DIR}/${scriptName}`, action, dbName]);
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => reject(Object.assign(new Error(e.message), { status: 500 })));
    child.on('close', (code) => {
      if (code === 0) { resolve(); return; }
      const message = sudoErrorMessage(scriptName, stderr);
      reject(Object.assign(new Error(message || `exit code ${code}`), { status: message ? 403 : 500 }));
    });
    if (password !== null) {
      child.stdin.write(password);
    }
    child.stdin.end();
  });
}

export { listOwnDatabases, createDatabase, deleteDatabase, countOwnDatabases, listAvailableEngines };
