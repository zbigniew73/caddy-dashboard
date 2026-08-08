import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/restic-install.sh');
const MODES = ['local', 'official'];

async function getInstalledStatus() {
  try {
    const { stdout } = await execFileAsync('restic', ['version'], { timeout: 5000 });
    const match = stdout.match(/restic\s+([\d.]+)/i);
    return { installed: true, version: match ? match[1] : null };
  } catch {
    return { installed: false, version: null };
  }
}

async function getLocalRepoVersion() {
  try {
    const { stdout } = await execFileAsync('dnf', ['-q', 'info', 'restic'], { timeout: 20000 });
    const match = stdout.match(/^Version\s*:\s*(\S+)/m);
    return match ? match[1] : null;
  } catch (e) {
    throw Object.assign(
      new Error('Nie udalo sie odczytac wersji restic z lokalnego repozytorium (dnf info) - sprawdz czy EPEL jest wlaczone.'),
      { status: 500 }
    );
  }
}

async function installRestic({ mode }) {
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
        new Error('Brak uprawnien sudo bez hasla dla instalacji restic - sprawdz /etc/sudoers.d/caddy-dashboard'),
        { status: 403 }
      );
    }
    throw Object.assign(new Error(stderr || e.message), { status: 500 });
  }
}

export { getInstalledStatus, getLocalRepoVersion, installRestic };
