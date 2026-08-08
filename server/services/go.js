import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/go-install.sh');
const MODES = ['local', 'official'];

// Sciezka "official" wypakowuje do /usr/local/go i dodaje PATH tylko dla
// nowych sesji logowania (/etc/profile.d) - to NIE dotyczy juz dzialajacego
// procesu panelu (systemd nie czyta profile.d), wiec sprawdzamy tez
// bezposrednio sciezke absolutna, nie tylko PATH.
async function getInstalledStatus() {
  for (const bin of ['go', '/usr/local/go/bin/go']) {
    try {
      const { stdout } = await execFileAsync(bin, ['version'], { timeout: 5000 });
      const match = stdout.match(/go version go([\d.]+)/i);
      return { installed: true, version: match ? match[1] : null };
    } catch {
      // sprobuj kolejnej sciezki
    }
  }
  return { installed: false, version: null };
}

async function getLocalRepoVersion() {
  try {
    const { stdout } = await execFileAsync('dnf', ['-q', 'info', 'golang'], { timeout: 20000 });
    const match = stdout.match(/^Version\s*:\s*(\S+)/m);
    return match ? match[1] : null;
  } catch (e) {
    throw Object.assign(
      new Error('Nie udalo sie odczytac wersji golang z lokalnego repozytorium (dnf info).'),
      { status: 500 }
    );
  }
}

async function installGo({ mode }) {
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
        new Error('Brak uprawnien sudo bez hasla dla instalacji Go - sprawdz /etc/sudoers.d/caddy-dashboard'),
        { status: 403 }
      );
    }
    throw Object.assign(new Error(stderr || e.message), { status: 500 });
  }
}

export { getInstalledStatus, getLocalRepoVersion, installGo };
