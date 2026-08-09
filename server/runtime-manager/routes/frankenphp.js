import { Router } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const SCRIPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts');
const SETUP_REPO_SCRIPT = path.join(SCRIPTS_DIR, 'frankenphp-setup-repo.sh');
const LIST_SCRIPT = path.join(SCRIPTS_DIR, 'frankenphp-list-versions.sh');
const INSTALL_SCRIPT = path.join(SCRIPTS_DIR, 'frankenphp-install.sh');

const VERSION_PATTERN = /^[0-9]\.[0-9]$/;

const router = Router();

// Runtime Manager dziala jako SVC_USER (cdadmin), nie root - skrypty ktore
// realnie dotykaja dnf/systemctl ida wiec przez `sudo -n`, dokladnie ten
// sam wzorzec co server/runtime-manager/routes/php.js (patrz Cmnd_Alias
// CDDASH_FRANKENPHP_* w server/scripts/write-sudoers.sh).
async function runViaSudo(scriptPath, args, timeout, sudoErrorLabel) {
  try {
    return await execFileAsync('sudo', ['-n', scriptPath, ...args], { timeout });
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

// Repo static-php musi byc wlaczone PRZED odpytaniem o dostepne strumienie
// php-zts - inaczej pierwsze otwarcie kafelka (przed jakakolwiek
// instalacja) dostaje pusta liste, tak samo jak przy PHP-FPM/Remi
// (listRemiVersions() w routes/php.js). Cache w pamieci procesu - patrz
// analogiczny komentarz przy listRemiVersions() (routes/php.js) - repo
// bootstrap raz na cykl zycia demona, nie przy kazdym requescie.
let repoReady = false;
async function listFrankenphpVersions() {
  if (!repoReady) {
    await runViaSudo(SETUP_REPO_SCRIPT, [], 60000, 'wlaczenia repozytorium static-php');
    repoReady = true;
  }
  const { stdout } = await runViaSudo(LIST_SCRIPT, [], 30000, 'listy wersji PHP ZTS');
  return stdout.trim().split('\n').filter(Boolean).map((line) => {
    const [version, status] = line.trim().split(/\s+/);
    return { version, stream: `static-${version}`, enabled: status === 'enabled' };
  });
}

router.get('/available', async (req, res) => {
  try {
    res.json({ versions: await listFrankenphpVersions() });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Nie udalo sie odczytac dostepnych wersji PHP ZTS z repozytorium static-php.' });
  }
});

// Sprawdzenie czy FrankenPHP jest zainstalowany NIE wymaga sudo - samo
// uruchomienie zainstalowanej binarki (odczyt wersji) to nie zmiana stanu
// systemu, tak samo jak odczyt ustawien PHP przez /usr/local/bin/phpXX w
// routes/php.js.
router.get('/', async (req, res) => {
  try {
    const { stdout } = await execFileAsync('frankenphp', ['version'], { timeout: 10000 });
    res.json({ installed: true, version: stdout.trim() });
  } catch {
    res.json({ installed: false, version: null });
  }
});

router.post('/:version/install', async (req, res) => {
  const { version } = req.params;
  if (!VERSION_PATTERN.test(version)) {
    return res.status(400).json({ error: `Nieprawidlowy format wersji: '${version}' (oczekiwano X.Y, np. 8.5).` });
  }

  let available;
  try {
    available = await listFrankenphpVersions();
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'Nie udalo sie odczytac dostepnych wersji PHP ZTS z repozytorium static-php.' });
  }
  if (!available.some((v) => v.version === version)) {
    return res.status(400).json({ error: `Strumien php-zts:static-${version} nie jest dostepny w repozytorium static-php.` });
  }

  try {
    const { stdout } = await runViaSudo(INSTALL_SCRIPT, [version], 300000, `instalacji FrankenPHP + PHP ${version} ZTS`);
    res.json({ success: true, message: stdout.trim() });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || `Instalacja FrankenPHP + PHP ${version} ZTS nie powiodla sie.` });
  }
});

export default router;
