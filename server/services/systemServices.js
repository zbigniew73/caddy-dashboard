import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Rejestr uslug widocznych w panelu. Docelowy system to AlmaLinux/Rocky,
// stad kolejnosc kandydatow (crond.service, firewalld.service) - cron.service
// jako fallback dla dystrybucji Debianopodobnych (dev/test box).
// Caddy/MySQL/PHP doloza sie tu gdy user bedzie mogl je instalowac z panelu.
const SERVICE_REGISTRY = [
  { key: 'ssh', unitCandidates: ['sshd.service', 'ssh.service'] },
  { key: 'firewall', unitCandidates: ['firewalld.service'] },
  { key: 'cron', unitCandidates: ['crond.service', 'cron.service'] }
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

function getServiceDef(key) {
  return SERVICE_REGISTRY.find((s) => s.key === key) || null;
}

// Nazwa jednostki systemd rozni sie miedzy dystrybucjami (np. sshd.service
// na AlmaLinux vs ssh.service na Debianie) - sprawdzamy kandydatow po kolei.
async function resolveUnit(candidates) {
  for (const unit of candidates) {
    const { stdout } = await execFileAsync('systemctl', ['show', unit, '--no-page', '-p', 'LoadState,Id']);
    const props = parseProps(stdout);
    if (props.LoadState && props.LoadState !== 'not-found') return props.Id || unit;
  }
  return null;
}

async function getServiceStatus(def) {
  const unit = await resolveUnit(def.unitCandidates);
  if (!unit) return { key: def.key, found: false };

  const { stdout } = await execFileAsync('systemctl', [
    'show', unit, '--no-page', '-p',
    'ActiveState,SubState,UnitFileState,MainPID,ExecMainStartTimestamp,Description'
  ]);
  const props = parseProps(stdout);

  return {
    key: def.key,
    found: true,
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
    // "-n" (non-interactive): jesli sudoers nie ma NOPASSWD dla tej komendy,
    // ma sie to skonczyc od razu bledem zamiast wisiec czekajac na haslo.
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

export { getServiceDef, getServiceStatus, listServices, runServiceAction, SERVICE_REGISTRY };
