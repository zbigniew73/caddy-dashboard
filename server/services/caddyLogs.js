import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/caddy-ensure-logs.sh');

// Przycisk "Utworz/sprawdz logi Caddy" w karcie uslugi Caddy - naprawia
// wlasciciela/uprawnienia /var/log/caddy i wszystkich plikow logow (patrz
// komentarz w caddy-ensure-logs.sh dlaczego to w ogole moze byc potrzebne).
async function ensureCaddyLogs() {
  try {
    const { stdout } = await execFileAsync('sudo', ['-n', SCRIPT_PATH], { timeout: 10000 });
    return { message: stdout.trim() };
  } catch (e) {
    const stderr = (e.stderr || '').toString();
    if (/password is required/i.test(stderr)) {
      throw Object.assign(
        new Error('Brak uprawnien sudo bez hasla dla caddy-ensure-logs.sh - sprawdz /etc/sudoers.d/caddy-dashboard'),
        { status: 500 }
      );
    }
    throw Object.assign(new Error(stderr.trim() || e.message), { status: 500 });
  }
}

export { ensureCaddyLogs };
