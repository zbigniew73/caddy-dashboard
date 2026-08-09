import { Router } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const SCRIPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts');
const SETUP_REPOS_SCRIPT = path.join(SCRIPTS_DIR, 'remi-setup-repos.sh');
const LIST_SCRIPT = path.join(SCRIPTS_DIR, 'remi-list-available.sh');
const INSTALL_SCRIPT = path.join(SCRIPTS_DIR, 'php-install.sh');

const router = Router();

function versionLabel(id) {
  return `${id[0]}.${id.slice(1)}`;
}

// Runtime Manager dziala jako SVC_USER (cdadmin), tak samo jak glowny
// panel - nie root. Skrypty ktore realnie dotykaja dnf/systemctl/
// /usr/local/bin ida wiec przez `sudo -n`, dokladnie ten sam wzorzec co
// server/services/mariadb.js i reszta (patrz Cmnd_Alias CDDASH_PHP_* w
// server/scripts/write-sudoers.sh).
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

async function listRemiVersions() {
  const { stdout } = await runViaSudo(LIST_SCRIPT, [], 30000, 'listy wersji PHP z Remi');
  return stdout.trim().split('\n').filter(Boolean).map((line) => {
    const [id, status] = line.trim().split(/\s+/);
    return { id, version: versionLabel(id), package: `php${id}`, installed: status === 'installed' };
  });
}

router.get('/available', async (req, res) => {
  try {
    res.json({ versions: await listRemiVersions() });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Nie udalo sie odczytac dostepnych wersji PHP z repozytorium Remi.' });
  }
});

router.get('/', async (req, res) => {
  try {
    const versions = await listRemiVersions();
    res.json({ installed: versions.filter((v) => v.installed) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Nie udalo sie odczytac listy zainstalowanych wersji PHP.' });
  }
});

router.post('/:id/install', async (req, res) => {
  const { id } = req.params;
  if (!/^[0-9]{2}$/.test(id)) {
    return res.status(400).json({ error: `Nieprawidlowy identyfikator wersji: '${id}'.` });
  }

  try {
    await runViaSudo(SETUP_REPOS_SCRIPT, [], 60000, 'wlaczenia repozytoriow EPEL/Remi');
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'Wlaczenie repozytoriow EPEL/Remi nie powiodlo sie.' });
  }

  let available;
  try {
    available = await listRemiVersions();
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'Nie udalo sie odczytac dostepnych wersji PHP z repozytorium Remi.' });
  }
  if (!available.some((v) => v.id === id)) {
    return res.status(400).json({ error: `PHP ${versionLabel(id)} (pakiet php${id}) nie jest dostepny w repozytorium Remi.` });
  }

  try {
    const { stdout } = await runViaSudo(INSTALL_SCRIPT, [id], 300000, `instalacji PHP ${versionLabel(id)}`);
    res.json({ success: true, message: stdout.trim() });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || `Instalacja PHP ${versionLabel(id)} nie powiodla sie.` });
  }
});

export default router;
