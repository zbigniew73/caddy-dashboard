import { Router } from 'express';
import os from 'os';
import fs from 'fs';
import { getServiceDef, getServiceStatus, listServices, runServiceAction } from '../services/systemServices.js';

const router = Router();

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

async function getCpuUsagePercent() {
  const start = cpuTimesSnapshot();
  await sleep(200);
  const end = cpuTimesSnapshot();
  const idleDelta = end.idle - start.idle;
  const totalDelta = end.total - start.total;
  if (totalDelta <= 0) return 0;
  return Math.round((1 - idleDelta / totalDelta) * 100);
}

router.get('/system', async (req, res) => {
  const cpus = os.cpus();
  const usagePercent = await getCpuUsagePercent();

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
    disk
  });
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

router.post('/services/:key/:action', async (req, res) => {
  try {
    const status = await runServiceAction(req.params.key, req.params.action);
    res.json(status);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

export default router;
