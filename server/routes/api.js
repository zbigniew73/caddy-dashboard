import { Router } from 'express';
import os from 'os';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getServiceDef, getServiceStatus, listServices, runServiceAction, installService, rebootSystem } from '../services/systemServices.js';
import { getCronJobsSummary } from '../services/cronJobs.js';
import { listAllRedisInstances, adminSetMaxMemoryMb } from '../services/hostingUserRedis.js';
import { checkForUpdate, applyUpdate } from '../services/update.js';
import { getCurrentSshPort, setSshPort } from '../services/sshConfig.js';
import { listFirewallEntries, addFirewallPort, updateFirewallPortDescription, removeFirewallEntry } from '../services/firewall.js';
import { readJailConfig, writeJailConfig } from '../services/fail2ban.js';
import { getPublicConfig as getTurnstilePublicConfig, saveKeys as saveTurnstileKeys, setEnabled as setTurnstileEnabled, verifyWithCloudflare } from '../services/turnstile.js';
import { isGateEnabled as isPhpmyadminGateEnabled, setGateEnabled as setPhpmyadminGateEnabled } from '../services/phpmyadminGate.js';
import { isGateEnabled as isAdminerGateEnabled, setGateEnabled as setAdminerGateEnabled } from '../services/adminerGate.js';
import {
  listPackages, createPackage, updatePackage, deletePackage,
  getSystemReservePercent, setSystemReservePercent, getDiskSettings, setDiskSettings, setDiskQuotaVerified
} from '../services/hostingPackages.js';
import { getSliceStatus, applySystemReserve } from '../services/hostingSlice.js';
import { getQuotaStatus, installQuotaPackage, verifyQuotaMechanism } from '../services/diskQuota.js';
import { listAccounts, createAccount, updateAccount, deleteAccount, getNextHostingUsername } from '../services/hostingAccounts.js';
import { getStatus as getCaddyPerformanceStatus, applyPerformanceConfig, readCaddyfile, getSiteCount } from '../services/caddyPerformance.js';
import { ensureCaddyLogs } from '../services/caddyLogs.js';
import { getAllowedUsers } from '../services/auth.js';
import { getLocalRepoVersion, installMariadb } from '../services/mariadb.js';
import { installMail, readDisabledUsernames, setMailAccess, getMailQueueCount, checkMailCertTrusted, getMailTlsStatus, setMailTlsSwap, getPostfixLimits, setPostfixLimits, getDovecotLimits, setDovecotLimits, getMydestinationStatus, addMydestinationDomain, getDkimStatus, installDkim, getSpfDmarcInfo, getPostfwdStatus, installPostfwd, setPostfwdLimits, getAntispamStatus, setAntispamStatus, getSpamassassinStatus, installSpamassassin, setSpamassassinThreshold } from '../services/mail.js';
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
  getPhpmyadminStatus, installPhpmyadmin, uninstallPhpmyadmin,
  getAdminerStatus, installAdminer, uninstallAdminer,
  getRoundcubeStatus, installRoundcube, uninstallRoundcube
} from '../services/runtimeManagerClient.js';
import { detectBaseDomain, applyCaddyConfig, removeCaddyConfig, getCaddyConfigStatus } from '../services/roundcubeSite.js';
import { getRoundcubeConfig, setRoundcubeConfig, clearRoundcubeConfig } from '../services/roundcubeConfig.js';
import { getAllMailLimits, setMailLimit, DEFAULT_LIMIT as DEFAULT_MAIL_LIMIT } from '../services/mailLimits.js';
import {
  listVirtualDomains, addVirtualDomain, removeVirtualDomain,
  listVirtualMailboxes, addVirtualMailbox, setVirtualMailboxPassword, removeVirtualMailbox,
  listVirtualAliases, addVirtualAlias, removeVirtualAlias
} from '../services/mailVirtual.js';
import { listSiteOwners } from '../services/hostingUserSites.js';

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

// Roundcube - odpowiednik phpmyadminServiceEntry()/adminerServiceEntry()
// powyzej. W odroznieniu od tamtych dwoch, Roundcube ma tez wlasna
// domene/blok Caddy zarzadzany przez roundcubeSite.js - "found" tutaj
// odzwierciedla WYLACZNIE czy sama aplikacja (Runtime Manager) jest
// zainstalowana, nie czy Caddy jest podpiety (to osobny stan, patrz
// GET /roundcube).
async function roundcubeServiceEntry() {
  let status;
  try {
    status = await getRoundcubeStatus();
  } catch {
    return [];
  }
  return [{
    key: 'roundcube',
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
    res.json({ services: [...services, ...(await phpServiceEntries()), ...(await phpmyadminServiceEntry()), ...(await adminerServiceEntry()), ...(await roundcubeServiceEntry())] });
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

router.get('/cron/jobs-count', async (req, res) => {
  try {
    res.json(await getCronJobsSummary());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/redis-instances', async (req, res) => {
  try {
    res.json(await listAllRedisInstances());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.put('/redis-instances/:username/max-memory', async (req, res) => {
  try {
    res.json(await adminSetMaxMemoryMb(req.params.username, req.body?.maxMemoryMb));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
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

router.post('/caddy/logs/ensure', async (req, res) => {
  try {
    res.json(await ensureCaddyLogs());
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

router.post('/mail/install', async (req, res) => {
  try {
    // Wykryta domena bazowa (jesli juz dostepna - np. reinstalacja na
    // serwerze z istniejacymi stronami) trafia od razu do warunkowego
    // auth_username_format (patrz mail-install.sh) - jesli jeszcze
    // niedostepna, dovecot-set-limits.sh uzupelni ja pozniej.
    const { suggested } = await detectBaseDomain();
    const result = await installMail(suggested);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Kafelek "Uzytkownicy z dostepem do poczty" (zakladka Poczta, drugi
// rzad) - konta hostingowe to jedyne konta z dostepem do skrzynek (patrz
// mail-install.sh: logowanie Dovecota = to samo haslo co SSH, przez PAM),
// wiec lista tutaj to po prostu listAccounts() z dopisanym stanem
// wlaczony/wylaczony z pliku blokad. Patrz services/mail.js.
router.get('/mail/access', (req, res) => {
  try {
    const disabled = readDisabledUsernames();
    const limits = getAllMailLimits();
    const accounts = listAccounts().map((a) => ({
      username: a.username,
      fullName: a.fullName,
      email: a.email,
      mailEnabled: !disabled.has(a.username),
      mailLimit: limits[a.username] ? { ...DEFAULT_MAIL_LIMIT, ...limits[a.username] } : { ...DEFAULT_MAIL_LIMIT }
    }));
    res.json({ accounts });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/mail/access/:username', async (req, res) => {
  try {
    const result = await setMailAccess(req.params.username, !!req.body?.enabled);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.put('/mail/access/:username/limit', (req, res) => {
  try {
    const mailboxes = parseInt(req.body?.mailboxes, 10);
    const aliases = parseInt(req.body?.aliases, 10);
    const result = setMailLimit(req.params.username, { mailboxes, aliases });
    res.json({ success: true, mailLimit: result });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Prawy kafelek statystyczny (Poczta, drugi rzad) - liczba
// wlaczonych/wylaczonych kont liczona po stronie frontu z /mail/access
// (juz i tak pobierane dla lewego kafelka), tu tylko to, czego nie da sie
// wyliczyc z tamtej listy: dlugosc kolejki Postfixa.
router.get('/mail/stats', async (req, res) => {
  try {
    const queueCount = await getMailQueueCount();
    res.json({ queueCount });
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

// Roundcube - w odroznieniu od phpMyAdmin/Adminer, instalacja aplikacji
// (Runtime Manager, PHP-FPM) i wpiecie w Caddy (domena, patrz
// roundcubeSite.js) to DWIE NIEZALEZNE, osobno wywolywane akcje -
// /roundcube/install tylko stawia aplikacje, /roundcube/configure tylko
// zapisuje blok Caddy. Rozdzielone celowo: jesli krok Caddy sie nie
// powiedzie (np. zla domena), instalacja aplikacji NIE przepada i nie
// trzeba jej powtarzac (install.sh i tak by odmowil - DOCROOT juz by
// istnial) - admin po prostu ponawia samo /roundcube/configure.
router.get('/roundcube', async (req, res) => {
  try {
    const status = await getRoundcubeStatus();
    const config = getRoundcubeConfig();
    let caddy = { present: false, domain: null, gate: false };
    if (status.installed) {
      try {
        caddy = await getCaddyConfigStatus();
      } catch {
        caddy = { present: false, domain: null, gate: false };
      }
    }
    res.json({ ...status, domain: config.domain, gateEnabled: config.gateEnabled, caddyConfigured: caddy.present, caddyDomain: caddy.domain });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/roundcube/detect-domain', async (req, res) => {
  try {
    res.json(await detectBaseDomain());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/roundcube/install', async (req, res) => {
  const dbEngine = req.body?.dbEngine === 'mysql' ? 'mysql' : req.body?.dbEngine === 'sqlite' ? 'sqlite' : null;
  if (!dbEngine) {
    res.status(400).json({ error: "Nieprawidlowy silnik bazy danych (oczekiwano 'mysql' albo 'sqlite')." });
    return;
  }
  try {
    res.json(await installRoundcube(dbEngine));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/roundcube/configure', async (req, res) => {
  const domain = typeof req.body?.domain === 'string' ? req.body.domain.trim().toLowerCase() : '';
  const gate = !!req.body?.gate;
  if (!domain) {
    res.status(400).json({ error: 'Podaj domene.' });
    return;
  }
  try {
    const result = await applyCaddyConfig(domain, gate);
    setRoundcubeConfig({ domain, gateEnabled: gate });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/roundcube/uninstall', async (req, res) => {
  const warnings = [];
  try {
    await removeCaddyConfig();
  } catch (e) {
    warnings.push(e.message);
  }
  try {
    const result = await uninstallRoundcube();
    clearRoundcubeConfig();
    res.json({ ...result, warnings: warnings.length ? warnings : undefined });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, warnings: warnings.length ? warnings : undefined });
  }
});

router.get('/roundcube-gate', (req, res) => {
  const config = getRoundcubeConfig();
  const turnstile = getTurnstilePublicConfig();
  res.json({ enabled: config.gateEnabled, domain: config.domain, turnstileConfigured: turnstile.configured && turnstile.enabled });
});

// W odroznieniu od bramki phpMyAdmin/Adminer (recznie wklejany blok
// Caddy), Roundcube ma juz auto-zarzadzany blok - wlaczenie/wylaczenie
// bramki PO PROSTU ponownie generuje ten sam blok z innym wariantem
// (forward_auth albo nie) i zapisuje go od razu, bez zadnego recznego
// kroku admina.
router.post('/roundcube-gate', async (req, res) => {
  const enabled = Boolean(req.body?.enabled);
  const config = getRoundcubeConfig();
  if (!config.domain) {
    res.status(400).json({ error: 'Roundcube nie ma jeszcze skonfigurowanej domeny.' });
    return;
  }
  if (enabled) {
    const turnstile = getTurnstilePublicConfig();
    if (!turnstile.configured || !turnstile.enabled) {
      res.status(400).json({ error: 'Najpierw skonfiguruj i wlacz Turnstile (Usługi -> Caddy) - bramka Roundcube uzywa tych samych kluczy.' });
      return;
    }
  }
  try {
    const result = await applyCaddyConfig(config.domain, enabled);
    setRoundcubeConfig({ gateEnabled: enabled });
    res.json({ success: true, enabled, message: result.message });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Kafelek Statystyki (Poczta, drugi rzad) - czy Caddy juz faktycznie
// serwuje zaufany certyfikat Let's Encrypt dla mail.<domena roundcube'a>.
router.get('/mail/cert-status', async (req, res) => {
  const config = getRoundcubeConfig();
  if (!config.domain) {
    res.json({ available: false, hostname: null, reason: 'no_domain' });
    return;
  }
  const hostname = `mail.${config.domain}`;
  const result = await checkMailCertTrusted(hostname);
  res.json({ available: result.trusted, hostname, validTo: result.validTo, reason: result.trusted ? null : result.reason });
});

// Ktory certyfikat TLS Postfix/Dovecot uzywaja TERAZ - self-signed
// (domyslny od mail-install.sh) albo Let's Encrypt (po kliknieciu Wlacz
// ponizej). Patrz server/scripts/mail-tls-swap.sh.
router.get('/mail/tls-status', async (req, res) => {
  try {
    res.json(await getMailTlsStatus());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/mail/tls-swap', async (req, res) => {
  const config = getRoundcubeConfig();
  if (!config.domain) {
    res.status(400).json({ error: 'Brak skonfigurowanej domeny (Roundcube -> Domena) - nie ma dla jakiej domeny szukac certyfikatu.' });
    return;
  }
  try {
    const result = await setMailTlsSwap(`mail.${config.domain}`, !!req.body?.enabled);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Kafelek "Postfix - ustawienia" (Poczta, przed kafelkiem dostepu do
// poczty) - realne wartosci z /etc/postfix/main.cf, patrz
// getPostfixLimits/setPostfixLimits w services/mail.js.
router.get('/mail/postfix-limits', async (req, res) => {
  try {
    res.json(await getPostfixLimits());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/mail/postfix-limits', async (req, res) => {
  try {
    const mailboxSizeBytes = parseInt(req.body?.mailboxSizeBytes, 10);
    const messageSizeBytes = parseInt(req.body?.messageSizeBytes, 10);
    const result = await setPostfixLimits(mailboxSizeBytes, messageSizeBytes);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Kafelek "Dovecot - ustawienia" (Poczta, obok kafelka Postfixa) -
// realna wartosc z configu Dovecota, patrz getDovecotLimits/
// setDovecotLimits w services/mail.js.
router.get('/mail/dovecot-limits', async (req, res) => {
  try {
    res.json(await getDovecotLimits());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/mail/dovecot-limits', async (req, res) => {
  try {
    const maxUseripConnections = parseInt(req.body?.maxUseripConnections, 10);
    const { suggested } = await detectBaseDomain();
    const result = await setDovecotLimits(maxUseripConnections, suggested);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Dwa kafelki pod "Dovecot - ustawienia": lewy dodaje WYKRYTA domene
// bazowa panelu do `mydestination` Postfixa (ten sam mechanizm
// wykrywania co Roundcube - detectBaseDomain w roundcubeSite.js), prawy
// jest czysto informacyjny - pokazuje gotowy adres
// <realny user procesu panelu>@<domena>, dopiero gdy domena juz jest w
// mydestination. Uzytkownik brany z `os.userInfo()` (realny user, pod
// ktorym dziala PROCES panelu - SVC_USER z instalacji, np. cdadmin),
// zamiast zaszytego na sztywno "cdadmin" - to i tak ten sam user.
router.get('/mail/mydestination', async (req, res) => {
  try {
    const { suggested } = await detectBaseDomain();
    const status = await getMydestinationStatus(suggested);
    res.json({
      detectedDomain: suggested,
      mydestinationDomains: status.domains,
      included: status.included,
      serviceUsername: os.userInfo().username
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/mail/mydestination', async (req, res) => {
  const domain = typeof req.body?.domain === 'string' ? req.body.domain.trim().toLowerCase() : '';
  if (!domain) {
    res.status(400).json({ error: 'Podaj domene.' });
    return;
  }
  try {
    res.json(await addMydestinationDomain(domain));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Kafelek "Adres e-mail administratora" - instalacja DKIM dla WYKRYTEJ
// (surowej) domeny panelu, patrz getDkimStatus/installDkim w
// services/mail.js. Po instalacji zwraca gotowy rekord DNS TXT do
// wklejenia u dostawcy (np. Cloudflare).
router.get('/mail/dkim-status', async (req, res) => {
  const domain = typeof req.query?.domain === 'string' ? req.query.domain.trim().toLowerCase() : '';
  if (!domain) {
    res.status(400).json({ error: 'Podaj domene.' });
    return;
  }
  try {
    res.json(await getDkimStatus(domain));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/mail/dkim-install', async (req, res) => {
  const domain = typeof req.body?.domain === 'string' ? req.body.domain.trim().toLowerCase() : '';
  if (!domain) {
    res.status(400).json({ error: 'Podaj domene.' });
    return;
  }
  try {
    res.json(await installDkim(domain));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// SPF/DMARC - czysto wyliczenie gotowych rekordow DNS, nic nie zapisuje
// na serwerze (patrz getSpfDmarcInfo w services/mail.js).
router.get('/mail/spf-dmarc', async (req, res) => {
  const domain = typeof req.query?.domain === 'string' ? req.query.domain.trim().toLowerCase() : '';
  if (!domain) {
    res.status(400).json({ error: 'Podaj domene.' });
    return;
  }
  try {
    res.json(await getSpfDmarcInfo(domain));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Postfwd - limiter tempa wysylki per uwierzytelnione konto (sasl_username),
// chroni PRZED WYCHODZACYM naduzyciem (przejete konto spamujace przez nasz
// serwer) - patrz server/scripts/postfwd-install.sh.
router.get('/mail/postfwd-status', async (req, res) => {
  try {
    res.json(await getPostfwdStatus());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/mail/postfwd-install', async (req, res) => {
  try {
    res.json(await installPostfwd());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/mail/postfwd-limits', async (req, res) => {
  try {
    const perMinute = parseInt(req.body?.perMinute, 10);
    const perHour = parseInt(req.body?.perHour, 10);
    const perDay = parseInt(req.body?.perDay, 10);
    res.json(await setPostfwdLimits(perMinute, perHour, perDay));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Natywna ochrona antyspamowa Postfixa (PTR/HELO/DNSBL Spamhaus) - czysta
// konfiguracja main.cf, zero nowych uslug - patrz postfix-antispam.sh.
router.get('/mail/antispam-status', async (req, res) => {
  try {
    res.json(await getAntispamStatus());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/mail/antispam', async (req, res) => {
  try {
    res.json(await setAntispamStatus(!!req.body?.enabled));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// SpamAssassin + spamass-milter - filtrowanie tresci (punkt 9 z serii
// LinuxBabe) - patrz server/scripts/spamassassin-install.sh.
router.get('/mail/spamassassin-status', async (req, res) => {
  try {
    res.json(await getSpamassassinStatus());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/mail/spamassassin-install', async (req, res) => {
  try {
    res.json(await installSpamassassin());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/mail/spamassassin-threshold', async (req, res) => {
  try {
    const threshold = parseInt(req.body?.threshold, 10);
    res.json(await setSpamassassinThreshold(threshold));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Wirtualne domeny/skrzynki pocztowe (klienci hostingu, NIEZALEZNE od kont
// systemowych/SSH) - patrz server/services/mailVirtual.js i
// server/scripts/mail-virtual-*.sh. DODATKOWA sciezka obok Fazy 1
// (system/PAM) powyzej, nie zastepuje niczego istniejacego.
router.get('/mail/virtual/site-domains', (req, res) => {
  try {
    res.json({ items: listSiteOwners() });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/mail/virtual/domains', async (req, res) => {
  try {
    res.json({ items: await listVirtualDomains() });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/mail/virtual/domains', async (req, res) => {
  try {
    res.json(await addVirtualDomain(req.body?.domain, req.body?.ownerAccount));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.delete('/mail/virtual/domains/:domain', async (req, res) => {
  try {
    res.json(await removeVirtualDomain(req.params.domain));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/mail/virtual/mailboxes', async (req, res) => {
  const domain = typeof req.query?.domain === 'string' ? req.query.domain.trim().toLowerCase() : '';
  if (!domain) {
    res.status(400).json({ error: 'Podaj domene.' });
    return;
  }
  try {
    res.json({ items: await listVirtualMailboxes(domain) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/mail/virtual/mailboxes', async (req, res) => {
  try {
    res.json(await addVirtualMailbox(req.body?.domain, req.body?.localpart, req.body?.password));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.put('/mail/virtual/mailboxes/:domain/:localpart', async (req, res) => {
  try {
    res.json(await setVirtualMailboxPassword(req.params.domain, req.params.localpart, req.body?.password));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.delete('/mail/virtual/mailboxes/:domain/:localpart', async (req, res) => {
  try {
    res.json(await removeVirtualMailbox(req.params.domain, req.params.localpart));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/mail/virtual/aliases', async (req, res) => {
  const domain = typeof req.query?.domain === 'string' ? req.query.domain.trim().toLowerCase() : '';
  if (!domain) {
    res.status(400).json({ error: 'Podaj domene.' });
    return;
  }
  try {
    res.json({ items: await listVirtualAliases(domain) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/mail/virtual/aliases', async (req, res) => {
  try {
    res.json(await addVirtualAlias(req.body?.domain, req.body?.source, req.body?.destination));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.delete('/mail/virtual/aliases/:domain/:source/:destination', async (req, res) => {
  try {
    res.json(await removeVirtualAlias(req.params.domain, req.params.source, req.params.destination));
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

// Realna weryfikacja na filesystemie mechanizmu ustawionego przez
// /quota/settings powyzej (findmnt + xfs_quota state / quotaon -p, patrz
// server/scripts/quota-verify.sh) - NIE zaklada niczego, tylko sprawdza
// biezacy stan. Wynik (ok/blad) jest trwale zapisywany przez
// setDiskQuotaVerified i dopiero pozytywny wynik odblokowuje POST
// /accounts z egzekwowanym limitem (patrz hostingAccounts.js
// createAccount). diskFsType "none" nie ma nic do weryfikowania.
router.post('/quota/verify', async (req, res) => {
  try {
    const { diskFsType, diskMountPoint } = getDiskSettings();
    if (diskFsType === 'none') {
      const saved = setDiskQuotaVerified(true, '');
      res.json({ ok: true, message: '', ...saved });
      return;
    }
    const result = await verifyQuotaMechanism(diskFsType, diskMountPoint);
    const saved = setDiskQuotaVerified(true, result.message);
    res.json({ ok: true, message: result.message, ...saved });
  } catch (e) {
    setDiskQuotaVerified(false, e.message);
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

// Konta hostingowe - realne Linux-usery (bez logowania) tworzone panelem,
// z limitem dysku przypisanego pakietu nakladanym od razu przez mechanizm
// z /quota/settings powyzej. Patrz server/services/hostingAccounts.js.
router.get('/accounts', (req, res) => {
  try {
    res.json({ accounts: listAccounts() });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Podpowiedz nazwy dla formularza "Utworz konto" - patrz
// getNextHostingUsername w hostingAccounts.js (srv_<id>, <id> = wolny UID,
// tylko sugestia, admin moze nadpisac).
router.get('/accounts/next-username', (req, res) => {
  try {
    res.json(getNextHostingUsername());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/accounts', async (req, res) => {
  try {
    res.json(await createAccount(req.body));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.put('/accounts/:id', async (req, res) => {
  try {
    res.json(await updateAccount(req.params.id, req.body));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.delete('/accounts/:id', async (req, res) => {
  try {
    await deleteAccount(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

export default router;
