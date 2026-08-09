import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const SERVICE_REGISTRY = [
  { key: 'ssh', unitCandidates: ['sshd.service'] },
  { key: 'firewall', unitCandidates: ['firewalld.service'] },
  { key: 'cron', unitCandidates: ['crond.service'] },
  { key: 'runtime-manager', unitCandidates: ['caddy-dashboard-runtime.service'] },
  { key: 'caddy', unitCandidates: ['caddy.service'] },
  { key: 'fail2ban', unitCandidates: ['fail2ban.service'], installable: { packageName: 'fail2ban' } },
  { key: 'mariadb', unitCandidates: ['mariadb.service', 'mysql.service'], installable: { custom: true } },
  {
    key: 'postgresql',
    unitCandidates: [
      'postgresql-17.service', 'postgresql-16.service', 'postgresql-15.service',
      'postgresql-14.service', 'postgresql-13.service', 'postgresql.service'
    ],
    installable: { custom: true }
  },
  { key: 'mongodb', unitCandidates: ['mongod.service'], installable: { custom: true } },
  { key: 'redis', unitCandidates: ['redis.service', 'valkey.service'], installable: { custom: true } }
];

const ALLOWED_ACTIONS = ['start', 'stop', 'restart'];

function parseProps(stdout) {
  const props = {};
  for (const line of stdout.split('\n')) {
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    props[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return props;
}

// PHP-FPM (server/runtime-manager/) instaluje sie per-wersja, dynamicznie
// (php82/php83/php84/php85...), wiec nie ma stalych wpisow w
// SERVICE_REGISTRY - klucz "phpXX" rozpoznajemy wzorcem i budujemy def "w
// locie". Start/stop/restart samej juz zainstalowanej uslugi idzie zwyklym
// systemctl (istniejaca regula sudoers CDDASH_SYSTEMCTL obejmuje kazdy
// *.service) - nie potrzeba tu Runtime Managera ani nowych uprawnien.
const PHP_FPM_KEY_PATTERN = /^php(\d{2})$/;

function getServiceDef(key) {
  const staticDef = SERVICE_REGISTRY.find((s) => s.key === key);
  if (staticDef) return staticDef;
  const match = PHP_FPM_KEY_PATTERN.exec(key);
  if (match) return { key, unitCandidates: [`php${match[1]}-php-fpm.service`] };
  return null;
}

async function resolveUnit(candidates) {
  for (const unit of candidates) {
    const { stdout } = await execFileAsync('systemctl', ['show', unit, '--no-page', '-p', 'LoadState,Id']);
    const props = parseProps(stdout);
    if (props.LoadState && props.LoadState !== 'not-found') return props.Id || unit;
  }
  return null;
}

async function getServiceStatus(def) {
  const installable = !!def.installable;
  const unit = await resolveUnit(def.unitCandidates);
  if (!unit) return { key: def.key, found: false, installable };

  const { stdout } = await execFileAsync('systemctl', [
    'show', unit, '--no-page', '-p',
    'ActiveState,SubState,UnitFileState,MainPID,ExecMainStartTimestamp,Description'
  ]);
  const props = parseProps(stdout);

  return {
    key: def.key,
    found: true,
    installable,
    unit,
    description: props.Description || '',
    activeState: props.ActiveState || 'unknown',
    subState: props.SubState || '',
    enabled: props.UnitFileState || 'unknown',
    mainPid: props.MainPID && props.MainPID !== '0' ? Number(props.MainPID) : null,
    since: props.ExecMainStartTimestamp || null
  };
}

async function listServices() {
  return Promise.all(SERVICE_REGISTRY.map((def) => getServiceStatus(def)));
}

async function runServiceAction(key, action) {
  if (!ALLOWED_ACTIONS.includes(action)) {
    throw Object.assign(new Error('Nieprawidlowa akcja'), { status: 400 });
  }

  const def = getServiceDef(key);
  if (!def) throw Object.assign(new Error('Nieznana usluga'), { status: 404 });

  const unit = await resolveUnit(def.unitCandidates);
  if (!unit) throw Object.assign(new Error('Usluga nie jest zainstalowana w systemie'), { status: 404 });

  try {
    await execFileAsync('sudo', ['-n', 'systemctl', action, unit], { timeout: 8000 });
  } catch (e) {
    const stderr = (e.stderr || '').toString();
    if (/password is required/i.test(stderr)) {
      throw Object.assign(
        new Error('Brak uprawnien sudo bez hasla dla systemctl - skonfiguruj NOPASSWD w sudoers dla tej komendy'),
        { status: 403 }
      );
    }
    throw Object.assign(new Error(stderr.trim() || e.message), { status: 500 });
  }

  return getServiceStatus(def);
}

async function installService(key) {
  const def = getServiceDef(key);
  if (!def || !def.installable || !def.installable.packageName) {
    throw Object.assign(new Error('Ten wpis nie jest instalowalny tym mechanizmem'), { status: 400 });
  }

  try {
    await execFileAsync('sudo', ['-n', 'dnf', 'install', '-y', def.installable.packageName], { timeout: 180000 });
  } catch (e) {
    const stderr = (e.stderr || '').toString();
    if (/password is required/i.test(stderr)) {
      throw Object.assign(
        new Error('Brak uprawnien sudo bez hasla dla dnf - sprawdz /etc/sudoers.d/caddy-dashboard'),
        { status: 403 }
      );
    }
    throw Object.assign(new Error(stderr.trim() || e.message), { status: 500 });
  }

  const unit = await resolveUnit(def.unitCandidates);
  if (unit) {
    try {
      await execFileAsync('sudo', ['-n', 'systemctl', 'enable', '--now', unit], { timeout: 15000 });
    } catch {
      // pakiet zainstalowany, ale enable/start moze wymagac recznej interwencji - nie blokujemy odpowiedzi
    }
  }

  return getServiceStatus(def);
}

function rebootSystem() {
  setTimeout(() => {
    execFile('sudo', ['-n', 'systemctl', 'reboot'], () => {});
  }, 500);
}

export { getServiceDef, getServiceStatus, listServices, runServiceAction, installService, rebootSystem, SERVICE_REGISTRY };
