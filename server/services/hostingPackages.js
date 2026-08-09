import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data');
const DATA_PATH = path.join(DATA_DIR, 'hosting-packages.json');

const MAX_DESCRIPTION_LEN = 500;

function loadPackages() {
  try {
    const parsed = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
    return Array.isArray(parsed.packages) ? parsed.packages : [];
  } catch {
    return [];
  }
}

function savePackages(packages) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_PATH, JSON.stringify({ packages }, null, 2), { mode: 0o600 });
}

// Waliduje/normalizuje pola pakietu - dzielone przez create i update, ten
// sam wzorzec "walidacja rzuca czytelny blad 400" co
// requireIntInRange() w server/runtime-manager/routes/php.js.
function normalizeInput(body) {
  const name = String(body?.name || '').trim();
  if (!name) {
    throw Object.assign(new Error('Nazwa pakietu jest wymagana.'), { status: 400 });
  }

  function requirePositiveInt(value, label) {
    const parsed = parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw Object.assign(new Error(`Nieprawidlowa wartosc: ${label} (liczba calkowita >= 0).`), { status: 400 });
    }
    return parsed;
  }

  const diskQuotaMb = requirePositiveInt(body?.diskQuotaMb, 'limit dysku (MB)');
  const maxDomains = requirePositiveInt(body?.maxDomains, 'liczba domen');
  const maxDatabases = requirePositiveInt(body?.maxDatabases, 'liczba baz danych');

  // Wersja PHP trzymana jako zwykly string (nie walidowana przeciwko
  // liscie zainstalowanych wersji) - celowo, zeby usuniecie wersji PHP
  // pozniej nie uniewazniało istniejacego pakietu; front podpowiada
  // liste z /api/php, ale to tylko UX, nie twardy wymog.
  const phpVersion = String(body?.phpVersion || '').trim();

  const description = String(body?.description || '').trim().slice(0, MAX_DESCRIPTION_LEN);

  return { name, diskQuotaMb, maxDomains, maxDatabases, phpVersion, description };
}

function listPackages() {
  return loadPackages();
}

function createPackage(body) {
  const data = normalizeInput(body);
  const packages = loadPackages();
  const pkg = { id: randomUUID(), ...data, createdAt: new Date().toISOString() };
  packages.push(pkg);
  savePackages(packages);
  return pkg;
}

function updatePackage(id, body) {
  const data = normalizeInput(body);
  const packages = loadPackages();
  const idx = packages.findIndex((p) => p.id === id);
  if (idx === -1) {
    throw Object.assign(new Error('Nie znaleziono pakietu.'), { status: 404 });
  }
  packages[idx] = { ...packages[idx], ...data };
  savePackages(packages);
  return packages[idx];
}

function deletePackage(id) {
  const packages = loadPackages();
  const idx = packages.findIndex((p) => p.id === id);
  if (idx === -1) {
    throw Object.assign(new Error('Nie znaleziono pakietu.'), { status: 404 });
  }
  packages.splice(idx, 1);
  savePackages(packages);
}

export { listPackages, createPackage, updatePackage, deletePackage };
