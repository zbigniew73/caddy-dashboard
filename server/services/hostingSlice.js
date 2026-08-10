import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { cpuCount } from './hostingPackages.js';

const SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/hosting-slice-set.sh');
const UNIT_PATH = '/etc/systemd/system/hosting.slice';

function runScript(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('sudo', ['-n', SCRIPT_PATH, ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => reject(Object.assign(new Error(e.message), { status: 500 })));
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      if (/password is required/i.test(stderr)) {
        reject(Object.assign(
          new Error('Brak uprawnien sudo bez hasla dla hosting.slice - sprawdz /etc/sudoers.d/caddy-dashboard'),
          { status: 403 }
        ));
        return;
      }
      reject(Object.assign(new Error(stderr.trim() || `exit code ${code}`), { status: 500 }));
    });
  });
}

// Unit w /etc/systemd/system/ jest standardowo swiatoczytelny (0644, root:root)
// - odczyt nie wymaga sudo, tylko zapis (patrz applySystemReserve nizej).
function getSliceStatus() {
  let unitContent = '';
  try {
    unitContent = readFileSync(UNIT_PATH, 'utf-8');
  } catch {
    // brak pliku = slice jeszcze nie skonfigurowany, nie blad
  }
  const match = /CPUQuota=(\d+)%/.exec(unitContent);
  return {
    installed: !!match,
    cpuQuotaPercent: match ? parseInt(match[1], 10) : null,
    cpuCount: cpuCount()
  };
}

async function applySystemReserve(reservePercent) {
  const reserve = parseInt(reservePercent, 10);
  if (!Number.isInteger(reserve) || reserve < 0 || reserve > 90) {
    throw Object.assign(new Error('Rezerwa dla systemu musi byc liczba calkowita 0-90 (%).'), { status: 400 });
  }
  const quotaPercent = Math.max(1, Math.round((100 - reserve) * cpuCount()));
  await runScript([String(quotaPercent)]);
  return { reservePercent: reserve, cpuQuotaPercent: quotaPercent, cpuCount: cpuCount() };
}

export { getSliceStatus, applySystemReserve };
