import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

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

export { getQuotaStatus, installQuotaPackage };
