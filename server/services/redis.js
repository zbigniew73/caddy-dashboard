import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/redis-install.sh');
const MODES = ['local', 'official'];

async function getLocalRepoVersion() {
  try {
    const { stdout } = await execFileAsync('dnf', ['-q', 'info', 'redis'], { timeout: 20000 });
    const match = stdout.match(/^Version\s*:\s*(\S+)/m);
    return match ? match[1] : null;
  } catch (e) {
    throw Object.assign(
      new Error('Nie udalo sie odczytac wersji redis z lokalnego repozytorium (dnf info).'),
      { status: 500 }
    );
  }
}

async function installRedis({ mode }) {
  if (!MODES.includes(mode)) {
    throw Object.assign(new Error('Nieprawidlowy tryb instalacji'), { status: 400 });
  }

  try {
    const { stdout } = await execFileAsync('sudo', ['-n', SCRIPT_PATH, mode], { timeout: 300000 });
    return { success: true, message: stdout.trim() };
  } catch (e) {
    const stderr = (e.stderr || '').toString().trim();
    if (/password is required/i.test(stderr)) {
      throw Object.assign(
        new Error('Brak uprawnien sudo bez hasla dla instalacji Redis - sprawdz /etc/sudoers.d/caddy-dashboard'),
        { status: 403 }
      );
    }
    throw Object.assign(new Error(stderr || e.message), { status: 500 });
  }
}

async function checkAuthStatus() {
  try {
    const { stdout } = await execFileAsync('redis-cli', ['ping'], { timeout: 5000 });
    return { reachable: true, authConfigured: !/PONG/.test(stdout) };
  } catch (e) {
    const combined = `${(e.stdout || '')}${(e.stderr || '')}`;
    if (/NOAUTH|WRONGPASS/i.test(combined)) {
      return { reachable: true, authConfigured: true };
    }
    if (e.code === 'ENOENT' || /Could not connect|Connection refused/i.test(combined)) {
      return { reachable: false, authConfigured: false };
    }
    return { reachable: true, authConfigured: false };
  }
}

export { getLocalRepoVersion, installRedis, checkAuthStatus };
