import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url)) + '/../scripts';

// Instalacja samego pakietu `quota` (narzedzia repquota/edquota/setquota) -
// uzywa juz istniejacej ogolnej regoly sudoers CDDASH_DNF (dnf install -y *),
// bez potrzeby nowego wpisu w sudoers. Wlaczenie egzekwowania limitow na
// realnym filesystemie (usrquota/prjquota w fstab + remount) to osobny krok,
// zalezny od ukladu dyskow na danym VPS - NIE robimy go tutaj automatycznie.
async function getQuotaStatus() {
  try {
    await execFileAsync('rpm', ['-q', 'quota']);
    return { installed: true };
  } catch {
    return { installed: false };
  }
}

async function installQuotaPackage() {
  try {
    await execFileAsync('sudo', ['-n', 'dnf', 'install', '-y', 'quota'], { timeout: 180000 });
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
  return getQuotaStatus();
}

async function runQuotaScript(scriptName, args) {
  try {
    const { stdout } = await execFileAsync('sudo', ['-n', `${SCRIPTS_DIR}/${scriptName}`, ...args], { timeout: 15000 });
    return { success: true, message: stdout.trim() };
  } catch (e) {
    const stderr = (e.stderr || '').toString();
    if (/password is required/i.test(stderr)) {
      throw Object.assign(
        new Error(`Brak uprawnien sudo bez hasla dla ${scriptName} - sprawdz /etc/sudoers.d/caddy-dashboard`),
        { status: 403 }
      );
    }
    throw Object.assign(new Error(stderr.trim() || e.message), { status: 500 });
  }
}

// softMb/hardMb - miekki/twardy limit w MB. Wymaga jednorazowego wczesniejszego
// setupu filesystemu (patrz karta "Zasoby systemowe") i istniejacego usera
// systemowego - skrypt sam nie tworzy ani filesystemu, ani konta.
function applyExt4Quota(username, softMb, hardMb, mountPoint) {
  return runQuotaScript('quota-ext4-set.sh', [username, String(softMb), String(hardMb), mountPoint]);
}

function applyXfsQuota(username, homeDir, softMb, hardMb, mountPoint) {
  return runQuotaScript('quota-xfs-set.sh', [username, homeDir, String(softMb), String(hardMb), mountPoint]);
}

export { getQuotaStatus, installQuotaPackage, applyExt4Quota, applyXfsQuota };
