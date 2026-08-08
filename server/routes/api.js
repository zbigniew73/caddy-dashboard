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
import { getStatus as getCaddyPerformanceStatus, applyPerformanceConfig, readCaddyfile, getSiteCount } from '../services/caddyPerformance.js';
import { getAllowedUsers } from '../services/auth.js';
import { getLocalRepoVersion, installMariadb } from '../services/mariadb.js';
import { getRamRecommendation, applyPerformanceConfig as applyMariadbPerformanceConfig } from '../services/mariadbPerformance.js';
import { getLocalRepoVersion as getPostgresqlLocalRepoVersion, installPostgresql } from '../services/postgresql.js';
import { getRamRecommendation as getPostgresqlRamRecommendation, applyPerformanceConfig as applyPostgresqlPerformanceConfig } from '../services/postgresqlPerformance.js';

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

async function getCaddySiteCountSafe() {
  try {
    return await getSiteCount();
  } catch {
    return null;
  }
}

router.get('/system', async (req, res) => {
  const cpus = os.cpus();
  const [usagePercent, caddyVersion, pythonVersion, mariadbVersion, caddySiteCount] = await Promise.all([
    getCpuUsagePercent(),
    getCaddyVersion(),
    getPythonVersion(),
    getMariadbVersion(),
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
      node: process.version,
      python: pythonVersion
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
    res.json({ services });
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

export default router;
