import { Router } from 'express';
import os from 'os';
import fs from 'fs';

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

export default router;
