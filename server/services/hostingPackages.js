import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data');
const DATA_PATH = path.join(DATA_DIR, 'hosting-packages.json');

const MAX_DESCRIPTION_LEN = 500;
// Wczesniej "RAM na proces PHP" - teraz GLOWNY limit RAM calego konta
// (patrz hostingAccounts.js: egzekwowany przez user-<uid>.slice, obejmuje
// LACZNIE wszystkie procesy usera, nie tylko PHP-FPM), wiec zakres
// rozszerzony w gore wzgledem starych wartosci per-proces.
const ALLOWED_RAM_LIMITS_MB = [512, 1024, 2048, 4096, 8192, 16384];
const DEFAULT_SYSTEM_RESERVE_PERCENT = 10;
const ALLOWED_DISK_FS_TYPES = ['none', 'ext4', 'xfs'];
const ALLOWED_DISK_MOUNT_POINTS = ['/', '/home'];
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
      diskMountPoint: ALLOWED_DISK_MOUNT_POINTS.includes(parsed.diskMountPoint)
        ? parsed.diskMountPoint
        : DEFAULT_DISK_MOUNT_POINT,
      diskQuotaVerified: typeof parsed.diskQuotaVerified === 'boolean' ? parsed.diskQuotaVerified : false,
      diskQuotaVerifiedMessage: typeof parsed.diskQuotaVerifiedMessage === 'string' ? parsed.diskQuotaVerifiedMessage : ''
    };
  } catch {
    return {
      packages: [],
      systemReservePercent: DEFAULT_SYSTEM_RESERVE_PERCENT,
      diskFsType: DEFAULT_DISK_FS_TYPE,
      diskMountPoint: DEFAULT_DISK_MOUNT_POINT,
      diskQuotaVerified: false,
      diskQuotaVerifiedMessage: ''
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

  const ramLimitMb = requirePositiveInt(body?.ramLimitMb, 'RAM (MB)');
  if (!ALLOWED_RAM_LIMITS_MB.includes(ramLimitMb)) {
    throw Object.assign(
      new Error(`Nieprawidlowa wartosc: RAM (dozwolone: ${ALLOWED_RAM_LIMITS_MB.join(', ')} MB).`),
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

  return { name, diskQuotaMb, maxDomains, maxDatabases, ramLimitMb, cpuPercent, description };
}

function withComputed(pkg, diskFsType) {
  // Pakiety zapisane przed dodaniem cpuPercent (starsze dane na VPS) nie
  // maja tego pola - domyslnie 100% jednego rdzenia, zeby lista sie nie
  // wywalala na NaN, dopoki admin nie zapisze pakietu ponownie.
  const cpuPercent = Number.isInteger(pkg.cpuPercent) ? pkg.cpuPercent : 100;
  // Migracja nazwy pola: dawniej phpMemoryLimitMb ("RAM na proces PHP").
  // Stare wpisy na VPS moga jeszcze miec tylko to pole - czytamy je jako
  // fallback, dopoki admin nie zapisze pakietu ponownie pod nowa nazwa.
  const ramLimitMb = Number.isInteger(pkg.ramLimitMb)
    ? pkg.ramLimitMb
    : (Number.isInteger(pkg.phpMemoryLimitMb) ? pkg.phpMemoryLimitMb : 1024);
  // diskQuotaMode jest wyliczany z GLOBALNEGO ustawienia filesystemu
  // (patrz getDiskSettings/setDiskSettings), nie jest polem pakietu -
  // wszystkie pakiety na danym VPS egzekwuja limit dysku tym samym
  // mechanizmem, bo mechanizm zalezy od filesystemu, nie od planu.
  return { ...pkg, cpuPercent, cpuTotalPercent: cpuPercent * cpuCount(), diskQuotaMode: diskFsType, ramLimitMb };
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
  const { diskFsType, diskMountPoint, diskQuotaVerified, diskQuotaVerifiedMessage } = loadData();
  return { diskFsType, diskMountPoint, diskQuotaVerified, diskQuotaVerifiedMessage };
}

// Zmiana mechanizmu/punktu montowania ZAWSZE kasuje flage weryfikacji -
// poprzednia weryfikacja dotyczyla innej kombinacji fstype+mountpoint i nie
// jest juz miarodajna. Wyjatek: diskFsType "none" nie ma nic do
// weryfikowania (konta powstaja bez egzekwowanego limitu), wiec ustawiamy
// verified=true od razu, zeby nie blokowac tworzenia kont bez sensu.
function setDiskSettings({ diskFsType, diskMountPoint }) {
  if (!ALLOWED_DISK_FS_TYPES.includes(diskFsType)) {
    throw Object.assign(
      new Error(`Nieprawidlowy typ filesystemu (dozwolone: ${ALLOWED_DISK_FS_TYPES.join(', ')}).`),
      { status: 400 }
    );
  }
  const mountPoint = String(diskMountPoint || '').trim();
  if (!ALLOWED_DISK_MOUNT_POINTS.includes(mountPoint)) {
    throw Object.assign(
      new Error(`Nieprawidlowy punkt montowania (dozwolone: ${ALLOWED_DISK_MOUNT_POINTS.join(', ')}).`),
      { status: 400 }
    );
  }
  const data = loadData();
  data.diskFsType = diskFsType;
  data.diskMountPoint = mountPoint;
  data.diskQuotaVerified = diskFsType === 'none';
  data.diskQuotaVerifiedMessage = '';
  saveData(data);
  return {
    diskFsType, diskMountPoint: mountPoint,
    diskQuotaVerified: data.diskQuotaVerified, diskQuotaVerifiedMessage: data.diskQuotaVerifiedMessage
  };
}

// Wolane po realnym sprawdzeniu na filesystemie (patrz diskQuota.js
// verifyQuotaMechanism + POST /quota/verify) - NIGDY nie zgadujemy, tylko
// zapisujemy wynik faktycznie wykonanej komendy.
function setDiskQuotaVerified(verified, message) {
  const data = loadData();
  data.diskQuotaVerified = !!verified;
  data.diskQuotaVerifiedMessage = String(message || '');
  saveData(data);
  return { diskQuotaVerified: data.diskQuotaVerified, diskQuotaVerifiedMessage: data.diskQuotaVerifiedMessage };
}

export {
  listPackages, createPackage, updatePackage, deletePackage,
  getSystemReservePercent, setSystemReservePercent,
  getDiskSettings, setDiskSettings, setDiskQuotaVerified, cpuCount
};
