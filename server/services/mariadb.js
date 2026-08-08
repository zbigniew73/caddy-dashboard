import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/mariadb-install.sh');
const OFFICIAL_VERSIONS = ['10.11', '11.8'];

async function getLocalRepoVersion() {
  try {
    const { stdout } = await execFileAsync('dnf', ['-q', 'info', 'mariadb-server'], { timeout: 20000 });
    const match = stdout.match(/^Version\s*:\s*(\S+)/m);
    return match ? match[1] : null;
  } catch (e) {
    throw Object.assign(
      new Error('Nie udalo sie odczytac wersji mariadb-server z lokalnego repozytorium (dnf info).'),
      { status: 500 }
    );
  }
}

async function installMariadb({ mode, version }) {
  const args = [];
  if (mode === 'local') {
    args.push('local');
  } else if (mode === 'official') {
    if (!OFFICIAL_VERSIONS.includes(version)) {
      throw Object.assign(new Error('Nieprawidlowa wersja MariaDB (dozwolone: 10.11, 11.8)'), { status: 400 });
    }
    args.push('official', version);
  } else {
    throw Object.assign(new Error('Nieprawidlowy tryb instalacji'), { status: 400 });
  }

  try {
    const { stdout } = await execFileAsync('sudo', ['-n', SCRIPT_PATH, ...args], { timeout: 300000 });
    return { success: true, message: stdout.trim() };
  } catch (e) {
    const stderr = (e.stderr || '').toString().trim();
    if (/password is required/i.test(stderr)) {
      throw Object.assign(
        new Error('Brak uprawnien sudo bez hasla dla instalacji MariaDB - sprawdz /etc/sudoers.d/caddy-dashboard'),
        { status: 403 }
      );
    }
    throw Object.assign(new Error(stderr || e.message), { status: 500 });
  }
}

export { getLocalRepoVersion, installMariadb };
