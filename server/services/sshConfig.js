import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/ssh-set-port.sh');

async function getCurrentSshPort() {
  try {
    const { stdout } = await execFileAsync('sudo', ['-n', SCRIPT_PATH, 'get'], { timeout: 10000 });
    const port = parseInt(stdout.trim(), 10);
    return Number.isInteger(port) ? port : 22;
  } catch {
    return 22;
  }
}

async function setSshPort(newPort) {
  const port = parseInt(newPort, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw Object.assign(new Error('Nieprawidlowy numer portu (1-65535)'), { status: 400 });
  }

  try {
    const { stdout } = await execFileAsync('sudo', ['-n', SCRIPT_PATH, String(port)], { timeout: 30000 });
    return { success: true, message: stdout.trim(), port };
  } catch (e) {
    const stderr = (e.stderr || '').toString().trim();
    if (/password is required/i.test(stderr)) {
      throw Object.assign(
        new Error('Brak uprawnien sudo bez hasla dla skryptu zmiany portu SSH - sprawdz /etc/sudoers.d/caddy-dashboard'),
        { status: 403 }
      );
    }
    throw Object.assign(new Error(stderr || e.message), { status: 500 });
  }
}

export { getCurrentSshPort, setSshPort };
