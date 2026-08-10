import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data');
const DATA_PATH = path.join(DATA_DIR, 'hosting-packages.json');

const MAX_DESCRIPTION_LEN = 500;
const ALLOWED_PHP_MEMORY_LIMITS_MB = [512, 1024, 2048, 4096];
const DEFAULT_SYSTEM_RESERVE_PERCENT = 10;
const ALLOWED_DISK_FS_TYPES = ['none', 'ext4', 'xfs'];
const DEFAULT_DISK_FS_TYPE = 'none';
const DEFAULT_DISK_MOUNT_POINT = '/home';

function loadData() {
  try {
    const parsed = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
    return {
      packages: Array.isArray(parsed.packages) ? parsed.packages : [],
      systemReservePercent: Number.isInteger(parsed.systemReservePercent)
        ? parsed.systemReservePercent
        : DEFAULT_SYSTEM_RESERVE_PERCENT,
      diskFsType: ALLOWED_DISK_FS_TYPES.includes(parsed.diskFsType) ? parsed.diskFsType : DEFAULT_DISK_FS_TYPE,
      diskMountPoint: typeof parsed.diskMountPoint === 'string' && parsed.diskMountPoint.startsWith('/')
        ? parsed.diskMountPoint
        : DEFAULT_DISK_MOUNT_POINT
    };
  } catch {
    return {
      packages: [],
      systemReservePercent: DEFAULT_SYSTEM_RESERVE_PERCENT,
      diskFsType: DEFAULT_DISK_FS_TYPE,
      diskMountPoint: DEFAULT_DISK_MOUNT_POINT
    };
  }
}

function saveData(data) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function cpuCount() {
  return os.cpus().length || 1;
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

  const phpMemoryLimitMb = requirePositiveInt(body?.phpMemoryLimitMb, 'RAM na proces PHP (MB)');
  if (!ALLOWED_PHP_MEMORY_LIMITS_MB.includes(phpMemoryLimitMb)) {
    throw Object.assign(
      new Error(`Nieprawidlowa wartosc: RAM na proces PHP (dozwolone: ${ALLOWED_PHP_MEMORY_LIMITS_MB.join(', ')} MB).`),
      { status: 400 }
    );
  }

  // Procent JEDNEGO rdzenia (tak jak systemd CPUQuota=) - laczny limit
  // pakietu to cpuPercent * liczba rdzeni, przeliczane w listPackages(),
  // nie przechowywane (liczba rdzeni VPS moze sie zmienic).
  const cpuPercent = requirePositiveInt(body?.cpuPercent, 'limit CPU (%)');
  if (cpuPercent < 1 || cpuPercent > 100) {
    throw Object.assign(new Error('Nieprawidlowa wartosc: limit CPU (1-100%, na rdzen).'), { status: 400 });
  }

  const description = String(body?.description || '').trim().slice(0, MAX_DESCRIPTION_LEN);

  return { name, diskQuotaMb, maxDomains, maxDatabases, phpMemoryLimitMb, cpuPercent, description };
}

function withComputed(pkg, diskFsType) {
  // Pakiety zapisane przed dodaniem cpuPercent (starsze dane na VPS) nie
  // maja tego pola - domyslnie 100% jednego rdzenia, zeby lista sie nie
  // wywalala na NaN, dopoki admin nie zapisze pakietu ponownie.
  const cpuPercent = Number.isInteger(pkg.cpuPercent) ? pkg.cpuPercent : 100;
  // diskQuotaMode jest wyliczany z GLOBALNEGO ustawienia filesystemu
  // (patrz getDiskSettings/setDiskSettings), nie jest polem pakietu -
  // wszystkie pakiety na danym VPS egzekwuja limit dysku tym samym
  // mechanizmem, bo mechanizm zalezy od filesystemu, nie od planu.
  return { ...pkg, cpuPercent, cpuTotalPercent: cpuPercent * cpuCount(), diskQuotaMode: diskFsType };
}

function listPackages() {
  const data = loadData();
  return data.packages.map((p) => withComputed(p, data.diskFsType));
}

function createPackage(body) {
  const fields = normalizeInput(body);
  const data = loadData();
  const pkg = { id: randomUUID(), ...fields, createdAt: new Date().toISOString() };
  data.packages.push(pkg);
  saveData(data);
  return withComputed(pkg, data.diskFsType);
}

function updatePackage(id, body) {
  const fields = normalizeInput(body);
  const data = loadData();
  const idx = data.packages.findIndex((p) => p.id === id);
  if (idx === -1) {
    throw Object.assign(new Error('Nie znaleziono pakietu.'), { status: 404 });
  }
  data.packages[idx] = { ...data.packages[idx], ...fields };
  saveData(data);
  return withComputed(data.packages[idx], data.diskFsType);
}

function deletePackage(id) {
  const data = loadData();
  const idx = data.packages.findIndex((p) => p.id === id);
  if (idx === -1) {
    throw Object.assign(new Error('Nie znaleziono pakietu.'), { status: 404 });
  }
  data.packages.splice(idx, 1);
  saveData(data);
}

function getSystemReservePercent() {
  return loadData().systemReservePercent;
}

function setSystemReservePercent(percent) {
  const data = loadData();
  data.systemReservePercent = percent;
  saveData(data);
}

function getDiskSettings() {
  const { diskFsType, diskMountPoint } = loadData();
  return { diskFsType, diskMountPoint };
}

function setDiskSettings({ diskFsType, diskMountPoint }) {
  if (!ALLOWED_DISK_FS_TYPES.includes(diskFsType)) {
    throw Object.assign(
      new Error(`Nieprawidlowy typ filesystemu (dozwolone: ${ALLOWED_DISK_FS_TYPES.join(', ')}).`),
      { status: 400 }
    );
  }
  const mountPoint = String(diskMountPoint || '').trim();
  if (!mountPoint.startsWith('/')) {
    throw Object.assign(new Error('Punkt montowania musi byc absolutna sciezka (zaczynac sie od /).'), { status: 400 });
  }
  const data = loadData();
  data.diskFsType = diskFsType;
  data.diskMountPoint = mountPoint;
  saveData(data);
  return { diskFsType, diskMountPoint: mountPoint };
}

export {
  listPackages, createPackage, updatePackage, deletePackage,
  getSystemReservePercent, setSystemReservePercent,
  getDiskSettings, setDiskSettings, cpuCount
};
