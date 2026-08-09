import { Router } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const SCRIPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts');
const INSTALL_SCRIPT = path.join(SCRIPTS_DIR, 'adminer-install.sh');
const UNINSTALL_SCRIPT = path.join(SCRIPTS_DIR, 'adminer-uninstall.sh');

const DOCROOT = '/opt/caddy-dashboard/adminer';
const SOCKET_PATH = '/opt/caddy-dashboard/run/adminer.sock';

// Ten sam blok co phpMyAdmin (server/runtime-manager/routes/phpmyadmin.js)
// - jeden bezposredni blok Caddy, bez posredniego skoku przez wewnetrzny
// port (uproszczenie zastosowane po fakcie u phpMyAdmin, tutaj od razu).
const CADDY_BLOCK = `adm.twojadomena.pl {
	header -X-Powered-By
	root * ${DOCROOT}
	php_fastcgi unix/${SOCKET_PATH}
	file_server
}`;

const router = Router();

// Runtime Manager dziala jako SVC_USER (cdadmin), nie root - install/
// uninstall ida przez `sudo -n`, dokladnie ten sam wzorzec co
// server/runtime-manager/routes/phpmyadmin.js (patrz Cmnd_Alias
// CDDASH_ADMINER_* w server/scripts/write-sudoers.sh).
async function runViaSudo(scriptPath, timeout, sudoErrorLabel) {
  try {
    return await execFileAsync('sudo', ['-n', scriptPath], { timeout });
  } catch (e) {
    const stderr = (e.stderr || '').toString().trim();
    if (/password is required/i.test(stderr)) {
      throw Object.assign(
        new Error(`Brak uprawnien sudo bez hasla dla ${sudoErrorLabel} - sprawdz /etc/sudoers.d/caddy-dashboard`),
        { status: 403 }
      );
    }
    throw Object.assign(new Error(stderr || e.message), { status: 500, stderr });
  }
}

// Odczyt statusu NIE wymaga sudo - `rpm -q` i sprawdzenie istnienia
// pliku to odczyt, nie zmiana stanu systemu, tak samo jak w
// routes/phpmyadmin.js.
async function getStatus() {
  let php83Installed = false;
  try {
    await execFileAsync('rpm', ['-q', 'php83'], { timeout: 5000 });
    php83Installed = true;
  } catch {
    php83Installed = false;
  }

  // Adminer to pojedynczy plik, nie pakiet rpm - test na "zainstalowane"
  // to istnienie index.php (zapisywanego na samym koncu instalacji).
  let installed = false;
  try {
    await execFileAsync('test', ['-f', `${DOCROOT}/index.php`], { timeout: 5000 });
    installed = true;
  } catch {
    installed = false;
  }

  // Wersja czytana z wlasnego markera zapisanego przez
  // adminer-install.sh, NIE parsowana z wewnetrznego pliku Adminera.
  let version = null;
  if (installed) {
    try {
      const { stdout } = await execFileAsync('cat', [`${DOCROOT}/.cddash-version`], { timeout: 5000 });
      version = stdout.trim() || null;
    } catch {
      version = null;
    }
  }

  return {
    php83Installed,
    installed,
    version,
    docroot: DOCROOT,
    socketPath: SOCKET_PATH,
    caddyBlock: CADDY_BLOCK
  };
}

router.get('/', async (req, res) => {
  try {
    res.json(await getStatus());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Nie udalo sie odczytac statusu Adminera.' });
  }
});

router.post('/install', async (req, res) => {
  try {
    const { stdout } = await runViaSudo(INSTALL_SCRIPT, 60000, 'instalacji Adminera');
    res.json({ success: true, message: stdout.trim() });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Instalacja Adminera nie powiodla sie.' });
  }
});

router.post('/uninstall', async (req, res) => {
  try {
    const { stdout } = await runViaSudo(UNINSTALL_SCRIPT, 30000, 'usuniecia Adminera');
    res.json({ success: true, message: stdout.trim() });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Usuniecie Adminera nie powiodlo sie.' });
  }
});

export default router;
