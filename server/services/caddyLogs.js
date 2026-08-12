import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { listSiteOwners } from './hostingUserSites.js';

const SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/caddy-ensure-logs.sh');

// Przycisk "Utworz/sprawdz logi Caddy" w karcie uslugi Caddy - naprawia
// wlasciciela/uprawnienia /var/log/caddy, wszystkich plikow logow oraz
// (na podstawie par username/domena z hosting-sites.json) plikow
// per-domena /etc/caddy/sites/<domena>.caddy - patrz komentarz w
// caddy-ensure-logs.sh po szczegoly i uzasadnienie.
function ensureCaddyLogs() {
  return new Promise((resolve, reject) => {
    const stdin = listSiteOwners().map(({ username, domain }) => `${username} ${domain}`).join('\n');

    const child = spawn('sudo', ['-n', SCRIPT_PATH]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => reject(Object.assign(new Error(e.message), { status: 500 })));
    child.on('close', (code) => {
      if (code === 0) { resolve({ message: stdout.trim() }); return; }
      if (/password is required/i.test(stderr)) {
        reject(Object.assign(
          new Error('Brak uprawnien sudo bez hasla dla caddy-ensure-logs.sh - sprawdz /etc/sudoers.d/caddy-dashboard'),
          { status: 500 }
        ));
        return;
      }
      reject(Object.assign(new Error(stderr.trim() || `exit code ${code}`), { status: 500 }));
    });
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

export { ensureCaddyLogs };
