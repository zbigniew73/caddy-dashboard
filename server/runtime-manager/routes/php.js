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

function errorMessage(e, fallback) {
  return (e.stderr || e.message || '').toString().trim() || fallback;
}

async function listRemiVersions() {
  const { stdout } = await execFileAsync(LIST_SCRIPT, [], { timeout: 30000 });
  return stdout.trim().split('\n').filter(Boolean).map((line) => {
    const [id, status] = line.trim().split(/\s+/);
    return { id, version: versionLabel(id), package: `php${id}`, installed: status === 'installed' };
  });
}

router.get('/available', async (req, res) => {
  try {
    res.json({ versions: await listRemiVersions() });
  } catch (e) {
    res.status(500).json({ error: errorMessage(e, 'Nie udalo sie odczytac dostepnych wersji PHP z repozytorium Remi.') });
  }
});

router.get('/', async (req, res) => {
  try {
    const versions = await listRemiVersions();
    res.json({ installed: versions.filter((v) => v.installed) });
  } catch (e) {
    res.status(500).json({ error: errorMessage(e, 'Nie udalo sie odczytac listy zainstalowanych wersji PHP.') });
  }
});

router.post('/:id/install', async (req, res) => {
  const { id } = req.params;
  if (!/^[0-9]{2}$/.test(id)) {
    return res.status(400).json({ error: `Nieprawidlowy identyfikator wersji: '${id}'.` });
  }

  try {
    await execFileAsync(SETUP_REPOS_SCRIPT, [], { timeout: 60000 });
  } catch (e) {
    return res.status(500).json({ error: errorMessage(e, 'Wlaczenie repozytoriow EPEL/Remi nie powiodlo sie.') });
  }

  let available;
  try {
    available = await listRemiVersions();
  } catch (e) {
    return res.status(500).json({ error: errorMessage(e, 'Nie udalo sie odczytac dostepnych wersji PHP z repozytorium Remi.') });
  }
  if (!available.some((v) => v.id === id)) {
    return res.status(400).json({ error: `PHP ${versionLabel(id)} (pakiet php${id}) nie jest dostepny w repozytorium Remi.` });
  }

  try {
    const { stdout } = await execFileAsync(INSTALL_SCRIPT, [id], { timeout: 300000 });
    res.json({ success: true, message: stdout.trim() });
  } catch (e) {
    res.status(500).json({ error: errorMessage(e, `Instalacja PHP ${versionLabel(id)} nie powiodla sie.`) });
  }
});

export default router;
