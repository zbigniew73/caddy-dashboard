import { execFile } from 'child_process';
import { promisify } from 'util';
import { getCurrentSshPort } from './sshConfig.js';
import { getNote, setNote, deleteNote } from './firewallNotes.js';

const execFileAsync = promisify(execFile);

async function firewallCmd(args) {
  try {
    return await execFileAsync('sudo', ['-n', 'firewall-cmd', ...args], { timeout: 10000 });
  } catch (e) {
    const stderr = (e.stderr || '').toString().trim();
    if (/password is required/i.test(stderr)) {
      throw Object.assign(
        new Error('Brak uprawnien sudo bez hasla dla firewall-cmd - sprawdz /etc/sudoers.d/caddy-dashboard'),
        { status: 403 }
      );
    }
    throw Object.assign(new Error(stderr || e.message), { status: 500 });
  }
}

async function getDefaultZone() {
  const { stdout } = await firewallCmd(['--get-default-zone']);
  return stdout.trim();
}

async function listFirewallEntries() {
  const zone = await getDefaultZone();
  const [{ stdout: portsOut }, { stdout: servicesOut }] = await Promise.all([
    firewallCmd(['--zone', zone, '--list-ports']),
    firewallCmd(['--zone', zone, '--list-services'])
  ]);

  const services = servicesOut.trim().split(/\s+/).filter(Boolean).map((name) => ({ type: 'service', name }));
  const ports = portsOut.trim().split(/\s+/).filter(Boolean).map((entry) => {
    const [port, protocol] = entry.split('/');
    return { type: 'port', port, protocol, description: getNote(port, protocol) };
  });

  return { zone, entries: [...services, ...ports] };
}

async function addFirewallPort(port, protocol, description) {
  const portNum = parseInt(port, 10);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    throw Object.assign(new Error('Nieprawidlowy numer portu (1-65535)'), { status: 400 });
  }
  if (!['tcp', 'udp'].includes(protocol)) {
    throw Object.assign(new Error("Protokol musi byc 'tcp' albo 'udp'"), { status: 400 });
  }

  await firewallCmd(['--permanent', '--add-port', `${portNum}/${protocol}`]);
  await firewallCmd(['--reload']);
  setNote(portNum, protocol, (description || '').toString().trim());
  return listFirewallEntries();
}

async function updateFirewallPortDescription(port, protocol, description) {
  const portNum = parseInt(port, 10);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    throw Object.assign(new Error('Nieprawidlowy numer portu (1-65535)'), { status: 400 });
  }
  if (!['tcp', 'udp'].includes(protocol)) {
    throw Object.assign(new Error("Protokol musi byc 'tcp' albo 'udp'"), { status: 400 });
  }

  setNote(portNum, protocol, (description || '').toString().trim());
  return listFirewallEntries();
}

async function removeFirewallEntry(type, value) {
  const sshPort = String(await getCurrentSshPort());

  if (type === 'service') {
    if (value === 'ssh') {
      throw Object.assign(
        new Error('Usuniecie uslugi ssh z firewalla moze odciac dostep do serwera - uzyj zamiany portu SSH w zakladce SSH, jesli chcesz to zmienic'),
        { status: 400 }
      );
    }
    await firewallCmd(['--permanent', '--remove-service', value]);
  } else if (type === 'port') {
    const [port] = String(value).split('/');
    if (port === sshPort) {
      throw Object.assign(
        new Error('Ten port jest uzywany przez SSH - uzyj zamiany portu SSH w zakladce SSH, jesli chcesz to zmienic'),
        { status: 400 }
      );
    }
    await firewallCmd(['--permanent', '--remove-port', value]);
    deleteNote(port, String(value).split('/')[1]);
  } else {
    throw Object.assign(new Error('Nieznany typ wpisu'), { status: 400 });
  }

  await firewallCmd(['--reload']);
  return listFirewallEntries();
}

export { listFirewallEntries, addFirewallPort, updateFirewallPortDescription, removeFirewallEntry };
