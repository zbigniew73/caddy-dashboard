import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data');
const CONFIG_PATH = path.join(DATA_DIR, 'mail-limits.json');
const USERNAME_RE = /^srv_[0-9]+$/;

// Domyslny limit "na jedna strone www" (2 konta e-mail + 10 aliasow/
// przekierowan) - deklarowany przez admina jako polityka, NIE jeszcze
// egzekwowany przez zaden mechanizm (Faza 1 poczty daje jedno konto =
// jedna skrzynka, brak jeszcze systemu wirtualnych skrzynek/aliasow per-
// domena - patrz mail-install.sh). Ten plik trzyma TYLKO liczby, per
// konto hostingowe, edytowalne z panelu - egzekwowanie przyjdzie razem z
// przyszlym systemem wirtualnych skrzynek.
const DEFAULT_LIMIT = { mailboxes: 2, aliases: 10 };

function loadAll() {
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveAll(data) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function getMailLimit(username) {
  const all = loadAll();
  return all[username] ? { ...DEFAULT_LIMIT, ...all[username] } : { ...DEFAULT_LIMIT };
}

function getAllMailLimits() {
  return loadAll();
}

function setMailLimit(username, { mailboxes, aliases }) {
  if (!USERNAME_RE.test(username)) {
    throw Object.assign(new Error('Nieprawidlowa nazwa uzytkownika.'), { status: 400 });
  }
  if (!Number.isInteger(mailboxes) || mailboxes < 0 || mailboxes > 1000) {
    throw Object.assign(new Error('Nieprawidlowa liczba kont e-mail (0-1000).'), { status: 400 });
  }
  if (!Number.isInteger(aliases) || aliases < 0 || aliases > 1000) {
    throw Object.assign(new Error('Nieprawidlowa liczba aliasow/przekierowan (0-1000).'), { status: 400 });
  }
  const all = loadAll();
  all[username] = { mailboxes, aliases };
  saveAll(all);
  return all[username];
}

export { getMailLimit, getAllMailLimits, setMailLimit, DEFAULT_LIMIT };
