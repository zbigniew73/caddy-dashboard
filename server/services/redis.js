import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/redis-install.sh');
const MODES = ['local', 'official'];

// Alma/Rocky 9.5+/10 zastapily pakiet "redis" forkiem "valkey" po zmianie
// licencji Redis Ltd w 2024 (SSPL, niedopuszczona do RHEL/EPEL) - proba
// "redis", potem fallback na "valkey".
const LOCAL_PACKAGE_CANDIDATES = ['redis', 'valkey'];

async function getLocalRepoVersion() {
  for (const pkg of LOCAL_PACKAGE_CANDIDATES) {
    try {
      const { stdout } = await execFileAsync('dnf', ['-q', 'info', pkg], { timeout: 20000 });
      const match = stdout.match(/^Version\s*:\s*(\S+)/m);
      if (match) return `${match[1]} (${pkg})`;
    } catch {
      // sprobuj kolejnej nazwy pakietu
    }
  }
  throw Object.assign(
    new Error('Nie znaleziono pakietu redis ani valkey w lokalnym repozytorium (dnf info).'),
    { status: 500 }
  );
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

async function pingWith(cli) {
  const { stdout } = await execFileAsync(cli, ['ping'], { timeout: 5000 });
  return stdout;
}

async function checkAuthStatus() {
  for (const cli of ['redis-cli', 'valkey-cli']) {
    try {
      const stdout = await pingWith(cli);
      return { reachable: true, authConfigured: !/PONG/.test(stdout) };
    } catch (e) {
      if (e.code === 'ENOENT') continue; // sprobuj drugiego klienta
      const combined = `${(e.stdout || '')}${(e.stderr || '')}`;
      if (/NOAUTH|WRONGPASS/i.test(combined)) {
        return { reachable: true, authConfigured: true };
      }
      if (/Could not connect|Connection refused/i.test(combined)) {
        return { reachable: false, authConfigured: false };
      }
      return { reachable: true, authConfigured: false };
    }
  }
  return { reachable: false, authConfigured: false };
}

export { getLocalRepoVersion, installRedis, checkAuthStatus };
