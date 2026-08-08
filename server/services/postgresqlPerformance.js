import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/postgresql-set-performance.sh');

function getRamRecommendation() {
  const totalMb = Math.round(os.totalmem() / (1024 * 1024));
  return {
    totalMb,
    recommendedMinMb: Math.floor(totalMb * 0.2),
    recommendedMaxMb: Math.floor(totalMb * 0.25)
  };
}

function applyPerformanceConfig({ sharedBuffersMb, maxConnections, trackActivities }) {
  return new Promise((resolve, reject) => {
    const buffers = parseInt(sharedBuffersMb, 10);
    const maxConn = parseInt(maxConnections, 10);

    if (!Number.isInteger(buffers) || buffers < 16 || buffers > 1000000) {
      reject(Object.assign(new Error('Nieprawidlowa wartosc Shared Buffers (MB)'), { status: 400 }));
      return;
    }
    if (!Number.isInteger(maxConn) || maxConn < 1 || maxConn > 100000) {
      reject(Object.assign(new Error('Nieprawidlowa wartosc Max Connections'), { status: 400 }));
      return;
    }

    const stdin = `${buffers}\n${maxConn}\n${trackActivities ? 'on' : 'off'}\n`;

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
          new Error('Brak uprawnien sudo bez hasla dla ustawien wydajnosci PostgreSQL - sprawdz /etc/sudoers.d/caddy-dashboard'),
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
