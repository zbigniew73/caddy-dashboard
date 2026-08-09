import { Router } from 'express';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const SCRIPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts');
const SETUP_REPOS_SCRIPT = path.join(SCRIPTS_DIR, 'remi-setup-repos.sh');
const LIST_SCRIPT = path.join(SCRIPTS_DIR, 'remi-list-available.sh');
const INSTALL_SCRIPT = path.join(SCRIPTS_DIR, 'php-install.sh');
const SETTINGS_SCRIPT = path.join(SCRIPTS_DIR, 'php-set-settings.sh');

// Bezpieczny zestaw znakow dla nazwy strefy czasowej IANA (litery, cyfry,
// _ - / +) - trafia do php.ini wewnatrz cudzyslowu, wiec musi wykluczac
// cudzyslowy/nowe linie zeby nie dalo sie wstrzyknac dodatkowych dyrektyw.
const TIMEZONE_PATTERN = /^[A-Za-z0-9_\-/+]+$/;

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

// Wlaczenie repo (idempotentne - patrz remi-setup-repos.sh) musi sie dziac
// TU, nie tylko przy instalacji - inaczej pierwsze otwarcie kafelka (przed
// jakakolwiek instalacja) pyta dnf o pakiety phpXX zanim Remi w ogole jest
// wlaczone i dostaje pusta liste ("brak dostepnych wersji"), mimo ze Remi
// realnie ma te pakiety.
async function listRemiVersions() {
  await runViaSudo(SETUP_REPOS_SCRIPT, [], 60000, 'wlaczenia repozytoriow EPEL/Remi');
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

// Zapis ustawien uzywa `spawn` (nie execFile) zeby przekazac tresc ini
// przez stdin, tak samo jak server/services/mariadbPerformance.js robi to
// dla /etc/my.cnf.d/caddy-dashboard-tuning.cnf.
function writeSettingsViaSudo(id, iniContent) {
  return new Promise((resolve, reject) => {
    const child = spawn('sudo', ['-n', SETTINGS_SCRIPT, id]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => reject(Object.assign(new Error(e.message), { status: 500 })));
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, message: stdout.trim() });
        return;
      }
      if (/password is required/i.test(stderr)) {
        reject(Object.assign(
          new Error('Brak uprawnien sudo bez hasla dla ustawien PHP - sprawdz /etc/sudoers.d/caddy-dashboard'),
          { status: 403 }
        ));
        return;
      }
      reject(Object.assign(new Error(stderr.trim() || `exit code ${code}`), { status: 500 }));
    });
    child.stdin.write(iniContent);
    child.stdin.end();
  });
}

// Zwraca liczbe calkowita w podanym zakresie albo rzuca blad 400 z jasnym
// komunikatem - uzywane dla kazdego z pol liczbowych ponizej, zeby nie
// powtarzac tej samej walidacji siedem razy.
function requireIntInRange(value, min, max, label) {
  const parsed = parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw Object.assign(new Error(`Nieprawidlowa wartosc: ${label} (${min}-${max}).`), { status: 400 });
  }
  return parsed;
}

router.post('/:id/settings', async (req, res) => {
  const { id } = req.params;
  if (!/^[0-9]{2}$/.test(id)) {
    return res.status(400).json({ error: `Nieprawidlowy identyfikator wersji: '${id}'.` });
  }

  const body = req.body || {};
  let timezone, memoryLimit, uploadMax, maxExecutionTime, maxInputTime, maxInputVars, maxFileUploads;
  try {
    timezone = body.timezone;
    if (typeof timezone !== 'string' || !TIMEZONE_PATTERN.test(timezone)) {
      throw Object.assign(new Error('Nieprawidlowa strefa czasowa.'), { status: 400 });
    }
    memoryLimit = requireIntInRange(body.memoryLimitMb, 16, 16384, 'memory_limit (MB)');
    uploadMax = requireIntInRange(body.uploadMaxMb, 1, 16384, 'rozmiar uploadu (MB)');
    maxExecutionTime = requireIntInRange(body.maxExecutionTime, 1, 3600, 'max_execution_time (s)');
    maxInputTime = requireIntInRange(body.maxInputTime, 1, 3600, 'max_input_time (s)');
    maxInputVars = requireIntInRange(body.maxInputVars, 100, 100000, 'max_input_vars');
    maxFileUploads = requireIntInRange(body.maxFileUploads, 1, 1000, 'max_file_uploads');
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }

  // expose_php/default_charset/realpath_cache_* to swiadome, stale
  // wartosci (bezpieczenstwo + wydajnosc) - nie sa polami w formularzu,
  // zawsze dopisywane razem z ustawieniami, ktore admin faktycznie
  // wybiera. Zestaw pol i wartosci zgodny z przykladem "Globalne PHP
  // 8.5" z pierwotnego planu Runtime Managera.
  const iniContent = `[PHP]
expose_php = Off
default_charset = "UTF-8"
date.timezone = "${timezone}"
memory_limit = ${memoryLimit}M
max_execution_time = ${maxExecutionTime}
max_input_time = ${maxInputTime}
max_input_vars = ${maxInputVars}
upload_max_filesize = ${uploadMax}M
post_max_size = ${uploadMax}M
max_file_uploads = ${maxFileUploads}
realpath_cache_size = 4096K
realpath_cache_ttl = 600
`;

  try {
    const result = await writeSettingsViaSudo(id, iniContent);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || `Zapisanie ustawien PHP ${versionLabel(id)} nie powiodlo sie.` });
  }
});

export default router;
