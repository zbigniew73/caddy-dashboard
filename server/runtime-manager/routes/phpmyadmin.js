import { Router } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const SCRIPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts');
const INSTALL_SCRIPT = path.join(SCRIPTS_DIR, 'phpmyadmin-install.sh');
const UNINSTALL_SCRIPT = path.join(SCRIPTS_DIR, 'phpmyadmin-uninstall.sh');

const DOCROOT = '/opt/caddy-dashboard/phpmyadmin';
const SOCKET_PATH = '/opt/caddy-dashboard/run/phpmyadmin.sock';

// Ten sam blok co w template/caddy/reverse-proxy.Caddyfile (sekcja
// phpmyadmin) - jedyne miejsce prawdy dla tej tresci to ten plik szablonu,
// tutaj tylko kopia do wyswietlenia w panelu (Caddyfile NIE jest
// edytowany automatycznie - patrz komentarz w phpmyadmin-install.sh).
const CADDY_BLOCK = `pma.twojadomena.pl {
	header -X-Powered-By
	root * ${DOCROOT}
	php_fastcgi unix/${SOCKET_PATH}
	file_server
}`;

const router = Router();

// Runtime Manager dziala jako SVC_USER (cdadmin), nie root - install/
// uninstall ida przez `sudo -n`, dokladnie ten sam wzorzec co
// server/runtime-manager/routes/php.js (patrz Cmnd_Alias
// CDDASH_PHPMYADMIN_* w server/scripts/write-sudoers.sh).
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

// Odczyt statusu (czy PHP 8.3 jest zainstalowany, czy phpMyAdmin jest
// zainstalowany) NIE wymaga sudo - `rpm -q` i sprawdzenie istnienia
// katalogu to odczyt, nie zmiana stanu systemu, tak samo jak sprawdzenie
// `frankenphp version` w routes/frankenphp.js.
async function getStatus() {
  let php83Installed = false;
  try {
    await execFileAsync('rpm', ['-q', 'php83'], { timeout: 5000 });
    php83Installed = true;
  } catch {
    php83Installed = false;
  }

  // phpMyAdmin to rozpakowane archiwum, nie pakiet rpm - test na
  // "zainstalowane" to istnienie config.inc.php, zapisywanego na samym
  // koncu instalacji (patrz phpmyadmin-install.sh).
  let installed = false;
  try {
    await execFileAsync('test', ['-f', `${DOCROOT}/config.inc.php`], { timeout: 5000 });
    installed = true;
  } catch {
    installed = false;
  }

  // Wersja czytana z wlasnego markera zapisanego przez
  // phpmyadmin-install.sh, NIE parsowana z wewnetrznych plikow
  // phpMyAdmin (ich dokladny format nie byl weryfikowany na zywo) -
  // pewne zrodlo prawdy zamiast zgadywania.
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
    res.status(e.status || 500).json({ error: e.message || 'Nie udalo sie odczytac statusu phpMyAdmin.' });
  }
});

router.post('/install', async (req, res) => {
  try {
    const { stdout } = await runViaSudo(INSTALL_SCRIPT, 180000, 'instalacji phpMyAdmin');
    res.json({ success: true, message: stdout.trim() });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Instalacja phpMyAdmin nie powiodla sie.' });
  }
});

router.post('/uninstall', async (req, res) => {
  try {
    const { stdout } = await runViaSudo(UNINSTALL_SCRIPT, 30000, 'usuniecia phpMyAdmin');
    res.json({ success: true, message: stdout.trim() });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Usuniecie phpMyAdmin nie powiodlo sie.' });
  }
});

export default router;
