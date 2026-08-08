import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/redis-set-performance.sh');

function getRamRecommendation() {
  const totalMb = Math.round(os.totalmem() / (1024 * 1024));
  return {
    totalMb,
    recommendedMinMb: Math.floor(totalMb * 0.5),
    recommendedMaxMb: Math.floor(totalMb * 0.75)
  };
}

function applyPerformanceConfig({ maxmemoryMb, maxClients, slowlogEnabled }) {
  return new Promise((resolve, reject) => {
    const memMb = parseInt(maxmemoryMb, 10);
    const clients = parseInt(maxClients, 10);

    if (!Number.isInteger(memMb) || memMb < 16 || memMb > 1000000) {
      reject(Object.assign(new Error('Nieprawidlowa wartosc Max Memory (MB)'), { status: 400 }));
      return;
    }
    if (!Number.isInteger(clients) || clients < 1 || clients > 1000000) {
      reject(Object.assign(new Error('Nieprawidlowa wartosc Max Clients'), { status: 400 }));
      return;
    }

    const slowlogThreshold = slowlogEnabled ? 10000 : -1;
    const stdin = `${memMb}\n${clients}\n${slowlogThreshold}\n`;

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
          new Error('Brak uprawnien sudo bez hasla dla ustawien wydajnosci Redis - sprawdz /etc/sudoers.d/caddy-dashboard'),
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
