import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/mariadb-set-performance.sh');

function getRamRecommendation() {
  const totalMb = Math.round(os.totalmem() / (1024 * 1024));
  return {
    totalMb,
    recommendedMinMb: Math.floor(totalMb * 0.25),
    recommendedMaxMb: Math.floor(totalMb * 0.5)
  };
}

function applyPerformanceConfig({ innodbBufferPoolMb, maxConnections, performanceSchema }) {
  return new Promise((resolve, reject) => {
    const bufferPool = parseInt(innodbBufferPoolMb, 10);
    const maxConn = parseInt(maxConnections, 10);

    if (!Number.isInteger(bufferPool) || bufferPool < 16 || bufferPool > 1000000) {
      reject(Object.assign(new Error('Nieprawidlowy InnoDB Buffer Pool Size (MB)'), { status: 400 }));
      return;
    }
    if (!Number.isInteger(maxConn) || maxConn < 1 || maxConn > 100000) {
      reject(Object.assign(new Error('Nieprawidlowa wartosc Max Connections'), { status: 400 }));
      return;
    }

    const content = `[mysqld]
innodb_buffer_pool_size = ${bufferPool}M
max_connections = ${maxConn}
performance_schema = ${performanceSchema ? 'ON' : 'OFF'}
`;

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
          new Error('Brak uprawnien sudo bez hasla dla ustawien wydajnosci MariaDB - sprawdz /etc/sudoers.d/caddy-dashboard'),
          { status: 403 }
        ));
        return;
      }
      reject(Object.assign(new Error(stderr.trim() || `exit code ${code}`), { status: 500 }));
    });
    child.stdin.write(content);
    child.stdin.end();
  });
}

export { getRamRecommendation, applyPerformanceConfig };
