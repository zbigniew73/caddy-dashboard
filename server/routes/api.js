import { Router } from 'express';
import os from 'os';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getServiceDef, getServiceStatus, listServices, runServiceAction, installService, rebootSystem } from '../services/systemServices.js';
import { checkForUpdate, applyUpdate } from '../services/update.js';
import { getCurrentSshPort, setSshPort } from '../services/sshConfig.js';
import { listFirewallEntries, addFirewallPort, updateFirewallPortDescription, removeFirewallEntry } from '../services/firewall.js';
import { readJailConfig, writeJailConfig } from '../services/fail2ban.js';
import { getPublicConfig as getTurnstilePublicConfig, saveKeys as saveTurnstileKeys, setEnabled as setTurnstileEnabled, verifyWithCloudflare } from '../services/turnstile.js';
import { isGateEnabled as isPhpmyadminGateEnabled, setGateEnabled as setPhpmyadminGateEnabled } from '../services/phpmyadminGate.js';
import { isGateEnabled as isAdminerGateEnabled, setGateEnabled as setAdminerGateEnabled } from '../services/adminerGate.js';
import {
  listPackages, createPackage, updatePackage, deletePackage,
  getSystemReservePercent, setSystemReservePercent, getDiskSettings, setDiskSettings
} from '../services/hostingPackages.js';
import { getSliceStatus, applySystemReserve } from '../services/hostingSlice.js';
import { getQuotaStatus, installQuotaPackage } from '../services/diskQuota.js';
import { getStatus as getCaddyPerformanceStatus, applyPerformanceConfig, readCaddyfile, getSiteCount } from '../services/caddyPerformance.js';
import { getAllowedUsers } from '../services/auth.js';
import { getLocalRepoVersion, installMariadb } from '../services/mariadb.js';
import { getRamRecommendation, applyPerformanceConfig as applyMariadbPerformanceConfig } from '../services/mariadbPerformance.js';
import { getTestDbStatus as getMariadbTestDbStatus, createTestDb as createMariadbTestDb, dropTestDb as dropMariadbTestDb } from '../services/mariadbTestDb.js';
import { getTestDbStatus as getPostgresqlTestDbStatus, createTestDb as createPostgresqlTestDb, dropTestDb as dropPostgresqlTestDb } from '../services/postgresqlTestDb.js';
import { getLocalRepoVersion as getPostgresqlLocalRepoVersion, installPostgresql } from '../services/postgresql.js';
import { getRamRecommendation as getPostgresqlRamRecommendation, applyPerformanceConfig as applyPostgresqlPerformanceConfig } from '../services/postgresqlPerformance.js';
import { installMongodb, checkAuthStatus as checkMongodbAuthStatus } from '../services/mongodb.js';
import { getTestDbStatus as getMongodbTestDbStatus, createTestDb as createMongodbTestDb, dropTestDb as dropMongodbTestDb } from '../services/mongodbTestDb.js';
import { getRamRecommendation as getMongodbRamRecommendation, applyPerformanceConfig as applyMongodbPerformanceConfig } from '../services/mongodbPerformance.js';
import { getLocalRepoVersion as getRedisLocalRepoVersion, installRedis, checkAuthStatus as checkRedisAuthStatus } from '../services/redis.js';
import { getRamRecommendation as getRedisRamRecommendation, applyPerformanceConfig as applyRedisPerformanceConfig } from '../services/redisPerformance.js';
import { getInstalledStatus as getResticStatus } from '../services/restic.js';
import {
  getAvailablePhp, getInstalledPhp, installPhp, getPhpSettings, applyPhpSettings,
  getPhpOpcache, applyPhpOpcache, getPhpModules, togglePhpModule,
  getAvailableFrankenphp, getFrankenphpStatus, installFrankenphp,
  getPhpmyadminStatus, installPhpmyadmin, uninstallPhpmyadmin,
  getAdminerStatus, installAdminer, uninstallAdminer
} from '../services/runtimeManagerClient.js';

const router = Router();
const execFileAsync = promisify(execFile);

function cpuTimesSnapshot() {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    for (const type in cpu.times) total += cpu.times[type];
    idle += cpu.times.idle;
  }
  return { idle, total };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getOsPrettyName() {
  try {
    const content = fs.readFileSync('/etc/os-release', 'utf-8');
    const match = content.match(/^PRETTY_NAME="?([^"\n]*)"?$/m);
    if (match) return match[1];
  } catch {
    // ignore, fall through to os.platform()/os.release()
  }
  return `${os.platform()} ${os.release()}`;
}

function getSwapInfo() {
  try {
    const content = fs.readFileSync('/proc/meminfo', 'utf-8');
    const totalMatch = content.match(/^SwapTotal:\s+(\d+) kB/m);
    const freeMatch = content.match(/^SwapFree:\s+(\d+) kB/m);
    if (!totalMatch || !freeMatch) return null;

    const totalBytes = parseInt(totalMatch[1], 10) * 1024;
    if (totalBytes === 0) return null;

    const freeBytes = parseInt(freeMatch[1], 10) * 1024;
    const usedBytes = totalBytes - freeBytes;
    return {
      totalBytes,
      freeBytes,
      usedBytes,
      usedPercent: Math.round((usedBytes / totalBytes) * 100)
    };
  } catch {
    return null;
  }
}

async function getCpuUsagePercent() {
  const start = cpuTimesSnapshot();
  await sleep(200);
  const end = cpuTimesSnapshot();
  const idleDelta = end.idle - start.idle;
  const totalDelta = end.total - start.total;
  if (totalDelta <= 0) return 0;
  return Math.round((1 - idleDelta / totalDelta) * 100);
}

async function getCaddyVersion() {
  try {
    const { stdout } = await execFileAsync('caddy', ['version'], { timeout: 3000 });
    return stdout.trim().split(/\s+/)[0] || null;
  } catch {
    return null;
  }
}

async function getPythonVersion() {
  try {
    const { stdout, stderr } = await execFileAsync('python3', ['--version'], { timeout: 3000 });
    const raw = (stdout || stderr).trim();
    const match = raw.match(/[\d.]+/);
    return match ? `v${match[0]}` : (raw || null);
  } catch {
    return null;
  }
}

async function getMariadbVersion() {
  try {
    const { stdout } = await execFileAsync('mariadb', ['--version'], { timeout: 3000 });
    const match = stdout.match(/Distrib\s+([\d.]+)/i);
    return match ? `v${match[1]}` : null;
  } catch {
    return null;
  }
}

async function getPostgresqlVersion() {
  try {
    const { stdout } = await execFileAsync('psql', ['--version'], { timeout: 3000 });
    const match = stdout.match(/([\d.]+)\s*$/);
    return match ? `v${match[1]}` : null;
  } catch {
    return null;
  }
}

async function getMongodbVersion() {
  try {
    const { stdout } = await execFileAsync('mongod', ['--version'], { timeout: 3000 });
    const match = stdout.match(/db version v?([\d.]+)/i);
    return match ? `v${match[1]}` : null;
  } catch {
    return null;
  }
}

async function getRedisVersion() {
  for (const bin of ['redis-server', 'valkey-server']) {
    try {
      const { stdout } = await execFileAsync(bin, ['--version'], { timeout: 3000 });
      const match = stdout.match(/v=([\d.]+)/);
      if (match) return `v${match[1]}`;
    } catch {
      // sprobuj kolejnego binarnego pliku
    }
  }
  return null;
}

async function getCaddySiteCountSafe() {
  try {
    return await getSiteCount();
  } catch {
    return null;
  }
}

async function getResticVersionSafe() {
  const { installed, version } = await getResticStatus();
  return installed && version ? `v${version}` : null;
}

// Wpisy PHP-FPM dolaczane do listy uslug (/api/services): jeden na kazda
// juz zainstalowana wersje (klucz "phpXX" jest dynamiczny, wiec nazwa
// przychodzi z serwera - "name" - zamiast z i18n jak reszta uslug) plus
// jeden staly wpis "php-fpm" reprezentujacy kafelek instalacji w sekcji
// Install (found=true gdy chociaz jedna wersja jest juz zainstalowana -
// wtedy znika "install-pending" w nawigacji, ale NIE ma to trafic do
// Glownego jako osobna zakladka, patrz web/app.js).
async function phpServiceEntries() {
  let versions;
  try {
    versions = await getAvailablePhp();
  } catch {
    return [];
  }
  const installedEntries = await Promise.all(
    versions.filter((v) => v.installed).map(async (v) => {
      const key = `php${v.id}`;
      const status = await getServiceStatus(getServiceDef(key));
      return { ...status, name: `PHP ${v.version}`, installable: false };
    })
  );
  const installTileEntry = {
    key: 'php-fpm',
    found: versions.some((v) => v.installed),
    installable: true
  };
  return [...installedEntries, installTileEntry];
}

// phpMyAdmin - w przeciwienstwie do PHP-FPM to JEDEN klucz dla obu sekcji
// (Install i, po instalacji, Usługi) - nie ma osobnego "tile" wpisu i
// osobnych "zainstalowanych wersji" jak przy PHP, bo phpMyAdmin nie jest
// wersjonowany per-instalacja tym mechanizmem (jedna instalacja na
// serwer). Ten sam wzorzec co MariaDB/PostgreSQL/etc - jeden
// installable:true wpis, found przelacza sie z instalacja.
async function phpmyadminServiceEntry() {
  let status;
  try {
    status = await getPhpmyadminStatus();
  } catch {
    return [];
  }
  // "unit"/"activeState" nie maja realnego odpowiednika (nie ma dedykowanej
  // jednostki systemd - phpMyAdmin jedzie na wspoldzielonym php83-php-fpm),
  // ale serviceCard() w web/app.js oczekuje tych pol dla generycznej karty
  // w gridzie Uslug - wypelniamy je sensownie (wersja zamiast nazwy
  // jednostki, zawsze "active" gdy zainstalowany, bo nie ma tu pojecia
  // "zatrzymany" odrebnego od "niezainstalowany") zamiast zostawiac
  // undefined (renderowaloby sie jako dosl. "undefined").
  return [{
    key: 'phpmyadmin',
    found: status.installed,
    installable: true,
    unit: status.version ? `v${status.version}` : status.docroot,
    activeState: status.installed ? 'active' : 'inactive'
  }];
}

// Adminer - odpowiednik phpmyadminServiceEntry() powyzej, ten sam
// powod dla "unit"/"activeState" pol. Zero hardcodowanego "name" (patrz
// notatka w phpmyadminServiceEntry - user musial ten bledny wzorzec
// pierwotnie poprawiac, tutaj od razu bez tego bledu) - nazwa zawsze z
// i18n (t('services.adminer.name')) po stronie frontu.
async function adminerServiceEntry() {
  let status;
  try {
    status = await getAdminerStatus();
  } catch {
    return [];
  }
  return [{
    key: 'adminer',
    found: status.installed,
    installable: true,
    unit: status.version ? `v${status.version}` : status.docroot,
    activeState: status.installed ? 'active' : 'inactive'
  }];
}

router.get('/system', async (req, res) => {
  const cpus = os.cpus();
  const [usagePercent, caddyVersion, pythonVersion, mariadbVersion, postgresqlVersion, mongodbVersion, redisVersion, resticVersion, caddySiteCount] = await Promise.all([
    getCpuUsagePercent(),
    getCaddyVersion(),
    getPythonVersion(),
    getMariadbVersion(),
    getPostgresqlVersion(),
    getMongodbVersion(),
    getRedisVersion(),
    getResticVersionSafe(),
    getCaddySiteCountSafe()
  ]);

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  let disk = null;
  try {
    const stat = fs.statfsSync('/');
    const diskTotal = stat.blocks * stat.bsize;
    const diskFree = stat.bavail * stat.bsize;
    const diskUsed = diskTotal - diskFree;
    disk = {
      path: '/',
      totalBytes: diskTotal,
      freeBytes: diskFree,
      usedBytes: diskUsed,
      usedPercent: diskTotal ? Math.round((diskUsed / diskTotal) * 100) : 0
    };
  } catch {
    disk = null;
  }

  res.json({
    hostname: os.hostname(),
    osName: getOsPrettyName(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    uptimeSeconds: Math.floor(os.uptime()),
    cpu: {
      model: (cpus[0]?.model || '').trim(),
      cores: cpus.length,
      usagePercent
    },
    memory: {
      totalBytes: totalMem,
      freeBytes: freeMem,
      usedBytes: usedMem,
      usedPercent: totalMem ? Math.round((usedMem / totalMem) * 100) : 0
    },
    swap: getSwapInfo(),
    disk,
    versions: {
      caddy: caddyVersion,
      mariadb: mariadbVersion,
      postgresql: postgresqlVersion,
      mongodb: mongodbVersion,
      redis: redisVersion,
      node: process.version,
      python: pythonVersion,
      restic: resticVersion
    },
    usersCount: getAllowedUsers().length,
    caddySiteCount
  });
});

router.post('/system/reboot', (req, res) => {
  res.json({ success: true });
  rebootSystem();
});

router.get('/services', async (req, res) => {
  try {
    const services = await listServices();
    res.json({ services: [...services, ...(await phpServiceEntries()), ...(await phpmyadminServiceEntry()), ...(await adminerServiceEntry())] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/services/:key', async (req, res) => {
  const def = getServiceDef(req.params.key);
  if (!def) return res.status(404).json({ error: 'Nieznana usluga' });
  try {
    const status = await getServiceStatus(def);
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/services/:key/install', async (req, res) => {
  try {
    const status = await installService(req.params.key);
    res.json(status);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/services/:key/:action', async (req, res) => {
  try {
    const status = await runServiceAction(req.params.key, req.params.action);
    res.json(status);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/update/check', async (req, res) => {
  try {
    const result = await checkForUpdate();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/update/apply', async (req, res) => {
  try {
    const result = await applyUpdate();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/firewall/entries', async (req, res) => {
  try {
    const result = await listFirewallEntries();
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/firewall/entries', async (req, res) => {
  try {
    const result = await addFirewallPort(req.body?.port, req.body?.protocol, req.body?.description);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/firewall/entries/description', async (req, res) => {
  try {
    const result = await updateFirewallPortDescription(req.body?.port, req.body?.protocol, req.body?.description);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/firewall/entries/remove', async (req, res) => {
  try {
    const result = await removeFirewallEntry(req.body?.type, req.body?.value);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/fail2ban/config', (req, res) => {
  res.json({ content: readJailConfig() });
});

router.post('/fail2ban/config', async (req, res) => {
  try {
    const result = await writeJailConfig(req.body?.content);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/ssh/port', async (req, res) => {
  res.json({ port: await getCurrentSshPort() });
});

router.post('/ssh/port', async (req, res) => {
  try {
    const result = await setSshPort(req.body?.port);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/caddy/turnstile', (req, res) => {
  res.json(getTurnstilePublicConfig());
});

router.post('/caddy/turnstile/verify', async (req, res) => {
  try {
    const { siteKey, secretKey, token } = req.body || {};
    if (!siteKey || !secretKey || !token) {
      return res.status(400).json({ error: 'Brak site key, secret key albo tokenu z widgetu' });
    }
    const result = await verifyWithCloudflare(secretKey, token, req.ip);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/caddy/turnstile/apply', (req, res) => {
  try {
    saveTurnstileKeys(req.body?.siteKey, req.body?.secretKey);
    setTurnstileEnabled(true);
    res.json(getTurnstilePublicConfig());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/caddy/turnstile/mode', (req, res) => {
  try {
    setTurnstileEnabled(Boolean(req.body?.enabled));
    res.json(getTurnstilePublicConfig());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/caddy/performance', async (req, res) => {
  try {
    res.json(await getCaddyPerformanceStatus());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/caddy/performance', async (req, res) => {
  try {
    const result = await applyPerformanceConfig({ profile: req.body?.profile, expertBlock: req.body?.expertBlock });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/caddy/caddyfile', async (req, res) => {
  try {
    res.json({ content: await readCaddyfile() });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/mariadb/local-version', async (req, res) => {
  try {
    res.json({ version: await getLocalRepoVersion() });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/mariadb/install', async (req, res) => {
  try {
    const result = await installMariadb({ mode: req.body?.mode, version: req.body?.version });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/mariadb/ram-info', (req, res) => {
  res.json(getRamRecommendation());
});

router.post('/mariadb/performance', async (req, res) => {
  try {
    const result = await applyMariadbPerformanceConfig({
      innodbBufferPoolMb: req.body?.innodbBufferPoolMb,
      maxConnections: req.body?.maxConnections,
      performanceSchema: Boolean(req.body?.performanceSchema)
    });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/mariadb/test-db', async (req, res) => {
  try {
    res.json(await getMariadbTestDbStatus());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/mariadb/test-db/create', async (req, res) => {
  try {
    res.json(await createMariadbTestDb());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/mariadb/test-db/drop', async (req, res) => {
  try {
    res.json(await dropMariadbTestDb());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/postgresql/local-version', async (req, res) => {
  try {
    res.json({ version: await getPostgresqlLocalRepoVersion() });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/postgresql/install', async (req, res) => {
  try {
    const result = await installPostgresql({ mode: req.body?.mode, version: req.body?.version });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/postgresql/ram-info', (req, res) => {
  res.json(getPostgresqlRamRecommendation());
});

router.post('/postgresql/performance', async (req, res) => {
  try {
    const result = await applyPostgresqlPerformanceConfig({
      sharedBuffersMb: req.body?.sharedBuffersMb,
      maxConnections: req.body?.maxConnections,
      trackActivities: Boolean(req.body?.trackActivities)
    });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/postgresql/test-db', async (req, res) => {
  try {
    res.json(await getPostgresqlTestDbStatus());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/postgresql/test-db/create', async (req, res) => {
  try {
    res.json(await createPostgresqlTestDb());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/postgresql/test-db/drop', async (req, res) => {
  try {
    res.json(await dropPostgresqlTestDb());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/mongodb/install', async (req, res) => {
  try {
    const result = await installMongodb({ version: req.body?.version });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/mongodb/auth-status', async (req, res) => {
  res.json(await checkMongodbAuthStatus());
});

router.get('/mongodb/test-db', async (req, res) => {
  try {
    res.json(await getMongodbTestDbStatus());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/mongodb/test-db/create', async (req, res) => {
  try {
    res.json(await createMongodbTestDb());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/mongodb/test-db/drop', async (req, res) => {
  try {
    res.json(await dropMongodbTestDb());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/mongodb/ram-info', (req, res) => {
  res.json(getMongodbRamRecommendation());
});

router.post('/mongodb/performance', async (req, res) => {
  try {
    const result = await applyMongodbPerformanceConfig({
      cacheSizeGb: req.body?.cacheSizeGb,
      maxConnections: req.body?.maxConnections,
      profilerEnabled: Boolean(req.body?.profilerEnabled)
    });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/redis/local-version', async (req, res) => {
  try {
    res.json({ version: await getRedisLocalRepoVersion() });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/redis/install', async (req, res) => {
  try {
    const result = await installRedis({ mode: req.body?.mode });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/redis/auth-status', async (req, res) => {
  res.json(await checkRedisAuthStatus());
});

router.get('/redis/ram-info', (req, res) => {
  res.json(getRedisRamRecommendation());
});

router.post('/redis/performance', async (req, res) => {
  try {
    const result = await applyRedisPerformanceConfig({
      maxmemoryMb: req.body?.maxmemoryMb,
      maxClients: req.body?.maxClients,
      slowlogEnabled: Boolean(req.body?.slowlogEnabled)
    });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/php/available', async (req, res) => {
  try {
    res.json({ versions: await getAvailablePhp() });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/php', async (req, res) => {
  try {
    res.json({ installed: await getInstalledPhp() });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/php/:id/install', async (req, res) => {
  try {
    const result = await installPhp(req.params.id);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/php/:id/settings', async (req, res) => {
  try {
    res.json(await getPhpSettings(req.params.id));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/php/:id/settings', async (req, res) => {
  try {
    const result = await applyPhpSettings(req.params.id, {
      timezone: req.body?.timezone,
      memoryLimitMb: req.body?.memoryLimitMb,
      uploadMaxMb: req.body?.uploadMaxMb,
      maxExecutionTime: req.body?.maxExecutionTime,
      maxInputTime: req.body?.maxInputTime,
      maxInputVars: req.body?.maxInputVars,
      maxFileUploads: req.body?.maxFileUploads,
      exposePhp: req.body?.exposePhp
    });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/php/:id/opcache', async (req, res) => {
  try {
    res.json(await getPhpOpcache(req.params.id));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/php/:id/opcache', async (req, res) => {
  try {
    const result = await applyPhpOpcache(req.params.id, {
      memoryConsumptionMb: req.body?.memoryConsumptionMb,
      internedStringsBufferMb: req.body?.internedStringsBufferMb,
      maxAcceleratedFiles: req.body?.maxAcceleratedFiles,
      revalidateFreqSec: req.body?.revalidateFreqSec,
      validateTimestamps: req.body?.validateTimestamps
    });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/php/:id/modules', async (req, res) => {
  try {
    res.json({ modules: await getPhpModules(req.params.id) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/php/:id/modules/:module/:action', async (req, res) => {
  try {
    const result = await togglePhpModule(req.params.id, req.params.module, req.params.action);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/frankenphp/available', async (req, res) => {
  try {
    res.json({ versions: await getAvailableFrankenphp() });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/frankenphp', async (req, res) => {
  try {
    res.json(await getFrankenphpStatus());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/frankenphp/:version/install', async (req, res) => {
  try {
    const result = await installFrankenphp(req.params.version);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/phpmyadmin', async (req, res) => {
  try {
    res.json(await getPhpmyadminStatus());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/phpmyadmin/install', async (req, res) => {
  try {
    res.json(await installPhpmyadmin());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/phpmyadmin/uninstall', async (req, res) => {
  try {
    res.json(await uninstallPhpmyadmin());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/phpmyadmin-gate', (req, res) => {
  const turnstile = getTurnstilePublicConfig();
  res.json({ enabled: isPhpmyadminGateEnabled(), turnstileConfigured: turnstile.configured && turnstile.enabled });
});

router.post('/phpmyadmin-gate', (req, res) => {
  const enabled = Boolean(req.body?.enabled);
  if (enabled) {
    const turnstile = getTurnstilePublicConfig();
    if (!turnstile.configured || !turnstile.enabled) {
      return res.status(400).json({ error: 'Najpierw skonfiguruj i wlacz Turnstile (Usługi -> Caddy) - bramka phpMyAdmin uzywa tych samych kluczy.' });
    }
  }
  setPhpmyadminGateEnabled(enabled);
  res.json({ success: true, enabled });
});

router.get('/adminer-gate', (req, res) => {
  const turnstile = getTurnstilePublicConfig();
  res.json({ enabled: isAdminerGateEnabled(), turnstileConfigured: turnstile.configured && turnstile.enabled });
});

router.post('/adminer-gate', (req, res) => {
  const enabled = Boolean(req.body?.enabled);
  if (enabled) {
    const turnstile = getTurnstilePublicConfig();
    if (!turnstile.configured || !turnstile.enabled) {
      return res.status(400).json({ error: 'Najpierw skonfiguruj i wlacz Turnstile (Usługi -> Caddy) - bramka Adminera uzywa tych samych kluczy.' });
    }
  }
  setAdminerGateEnabled(enabled);
  res.json({ success: true, enabled });
});

router.get('/adminer', async (req, res) => {
  try {
    res.json(await getAdminerStatus());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/adminer/install', async (req, res) => {
  try {
    res.json(await installAdminer());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/adminer/uninstall', async (req, res) => {
  try {
    res.json(await uninstallAdminer());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/packages', (req, res) => {
  res.json({ packages: listPackages() });
});

router.post('/packages', (req, res) => {
  try {
    res.json(createPackage(req.body));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.put('/packages/:id', (req, res) => {
  try {
    res.json(updatePackage(req.params.id, req.body));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.delete('/packages/:id', (req, res) => {
  try {
    deletePackage(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Nadrzedny systemd slice (hosting.slice) - globalny sufit CPU dla
// wszystkich pakietow razem, zeby procent CPU per-pakiet (patrz /packages
// wyzej) nie mogl w sumie zdlawic systemu. Nie nested pod /packages/, zeby
// nie kolidowac z /packages/:id powyzej.
router.get('/system-resources', async (req, res) => {
  try {
    const [slice, quota] = await Promise.all([getSliceStatus(), getQuotaStatus()]);
    res.json({ reservePercent: getSystemReservePercent(), slice, quota, ...getDiskSettings() });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.put('/system-resources', async (req, res) => {
  try {
    const result = await applySystemReserve(req.body?.reservePercent);
    setSystemReservePercent(result.reservePercent);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/quota/install', async (req, res) => {
  try {
    res.json(await installQuotaPackage());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Wybor mechanizmu egzekwowania limitu dysku (patrz getDiskSettings w
// hostingPackages.js) - GLOBALNY dla calego VPS, bo mechanizm (ext4 quota
// vs XFS project quota) zalezy od filesystemu, nie od pakietu. Pakiety
// (GET /packages) wystawiaja to jako diskQuotaMode, wyliczone z tego
// ustawienia - informacyjnie, admin go tam nie wybiera osobno per pakiet.
router.put('/quota/settings', (req, res) => {
  try {
    res.json(setDiskSettings(req.body || {}));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

export default router;
