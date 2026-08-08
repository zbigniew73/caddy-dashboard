import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/mongodb-set-performance.sh');

function getRamRecommendation() {
  const totalMb = Math.round(os.totalmem() / (1024 * 1024));
  const totalGb = totalMb / 1024;
  // Oficjalna formula MongoDB dla WiredTiger cache: max(256MB, (RAM-1GB)/2)
  const recommendedGb = Math.max(0.25, Math.round(((totalGb - 1) / 2) * 100) / 100);
  return { totalMb, recommendedGb };
}

function applyPerformanceConfig({ cacheSizeGb, maxConnections, profilerEnabled }) {
  return new Promise((resolve, reject) => {
    const cacheGb = parseFloat(cacheSizeGb);
    const maxConn = parseInt(maxConnections, 10);

    if (!Number.isFinite(cacheGb) || cacheGb < 0.25 || cacheGb > 100000) {
      reject(Object.assign(new Error('Nieprawidlowa wartosc WiredTiger Cache Size (GB)'), { status: 400 }));
      return;
    }
    if (!Number.isInteger(maxConn) || maxConn < 1 || maxConn > 200000) {
      reject(Object.assign(new Error('Nieprawidlowa wartosc Max Connections'), { status: 400 }));
      return;
    }

    const stdin = `${cacheGb}\n${maxConn}\n${profilerEnabled ? 'slowOp' : 'off'}\n`;

    const child = spawn('sudo', ['-n', SCRIPT_PATH]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => reject(Object.assign(new Error(e.message), { status: 500 })));
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, message: stdout.trim() });
        return;
      }
      if (/password is required/i.test(stderr)) {
        reject(Object.assign(
          new Error('Brak uprawnien sudo bez hasla dla ustawien wydajnosci MongoDB - sprawdz /etc/sudoers.d/caddy-dashboard'),
          { status: 403 }
        ));
        return;
      }
      reject(Object.assign(new Error(stderr.trim() || `exit code ${code}`), { status: 500 }));
    });
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

export { getRamRecommendation, applyPerformanceConfig };
