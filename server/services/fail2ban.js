import { readFileSync } from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/fail2ban-write-config.sh');
const JAIL_LOCAL = '/etc/fail2ban/jail.local';
const MAX_CONTENT_LENGTH = 200000;

function readJailConfig() {
  try {
    return readFileSync(JAIL_LOCAL, 'utf-8');
  } catch {
    return '';
  }
}

function writeJailConfig(content) {
  return new Promise((resolve, reject) => {
    if (typeof content !== 'string' || content.length === 0 || content.length > MAX_CONTENT_LENGTH) {
      reject(Object.assign(new Error('Nieprawidlowa tresc konfiguracji'), { status: 400 }));
      return;
    }

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
          new Error('Brak uprawnien sudo bez hasla dla zapisu konfiguracji fail2ban - sprawdz /etc/sudoers.d/caddy-dashboard'),
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

export { readJailConfig, writeJailConfig };
