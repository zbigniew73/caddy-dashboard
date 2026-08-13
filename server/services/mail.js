import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/mail-install.sh');

// Bez trybow/wersji do wyboru (w odroznieniu od MariaDB/Redis) - jeden,
// stabilny, systemowy zestaw pakietow (postfix + dovecot + opendkim),
// patrz mail-install.sh. Timeout jak przy MariaDB - instalacja trzech
// pakietow + generowanie certyfikatu moze potrwac.
async function installMail() {
  try {
    const { stdout } = await execFileAsync('sudo', ['-n', SCRIPT_PATH], { timeout: 300000 });
    return { success: true, message: stdout.trim() };
  } catch (e) {
    const stderr = (e.stderr || '').toString().trim();
    if (/password is required/i.test(stderr)) {
      throw Object.assign(
        new Error('Brak uprawnien sudo bez hasla dla instalacji Mail Server - sprawdz /etc/sudoers.d/caddy-dashboard'),
        { status: 403 }
      );
    }
    throw Object.assign(new Error(stderr || e.message), { status: 500 });
  }
}

export { installMail };
