import { Router } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const SCRIPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts');
const INSTALL_SCRIPT = path.join(SCRIPTS_DIR, 'roundcube-install.sh');
const UNINSTALL_SCRIPT = path.join(SCRIPTS_DIR, 'roundcube-uninstall.sh');

const DOCROOT = '/opt/webmail';
const SOCKET_PATH = '/opt/webmail/run/roundcube.sock';

const router = Router();

// Runtime Manager dziala jako SVC_USER (cdadmin), nie root - install/
// uninstall ida przez `sudo -n`, ten sam wzorzec co
// server/runtime-manager/routes/phpmyadmin.js.
async function runViaSudo(args, timeout, sudoErrorLabel) {
  try {
    return await execFileAsync('sudo', ['-n', ...args], { timeout });
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

// Odczyt statusu (czy PHP 8.4 jest zainstalowany, czy Roundcube jest
// zainstalowany) NIE wymaga sudo.
async function getStatus() {
  let php84Installed = false;
  try {
    await execFileAsync('rpm', ['-q', 'php84'], { timeout: 5000 });
    php84Installed = true;
  } catch {
    php84Installed = false;
  }

  let installed = false;
  try {
    await execFileAsync('test', ['-f', `${DOCROOT}/config/config.inc.php`], { timeout: 5000 });
    installed = true;
  } catch {
    installed = false;
  }

  let version = null;
  let dbEngine = null;
  if (installed) {
    try {
      const { stdout } = await execFileAsync('cat', [`${DOCROOT}/.cddash-version`], { timeout: 5000 });
      version = stdout.trim() || null;
    } catch {
      version = null;
    }
    try {
      const { stdout } = await execFileAsync('cat', [`${DOCROOT}/.cddash-db-engine`], { timeout: 5000 });
      dbEngine = stdout.trim() || null;
    } catch {
      dbEngine = null;
    }
  }

  return {
    php84Installed,
    installed,
    version,
    dbEngine,
    docroot: DOCROOT,
    socketPath: SOCKET_PATH
  };
}

router.get('/', async (req, res) => {
  try {
    res.json(await getStatus());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Nie udalo sie odczytac statusu Roundcube.' });
  }
});

router.post('/install', async (req, res) => {
  const dbEngine = req.body?.dbEngine === 'mysql' ? 'mysql' : req.body?.dbEngine === 'sqlite' ? 'sqlite' : null;
  if (!dbEngine) {
    res.status(400).json({ error: "Nieprawidlowy silnik bazy danych (oczekiwano 'mysql' albo 'sqlite')." });
    return;
  }
  try {
    const { stdout } = await runViaSudo([INSTALL_SCRIPT, dbEngine], 300000, 'instalacji Roundcube');
    res.json({ success: true, message: stdout.trim() });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Instalacja Roundcube nie powiodla sie.' });
  }
});

router.post('/uninstall', async (req, res) => {
  try {
    const { stdout } = await runViaSudo([UNINSTALL_SCRIPT], 30000, 'usuniecia Roundcube');
    res.json({ success: true, message: stdout.trim() });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Usuniecie Roundcube nie powiodlo sie.' });
  }
});

export default router;
