import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url)) + '/../scripts';

// Podsumowanie zadan cron na CALYM serwerze (wszyscy systemowi userzy z
// wlasnym crontabem, /var/spool/cron/*) - patrz komentarz w
// cron-jobs-count.sh. Kafelek "Ilosc wszystkich zadan cron" w karcie
// uslugi CRON w panelu admina pokazuje sume ORAZ rozbicie na
// konta (posortowane malejaco), zeby latwo bylo wylapac konto z
// podejrzanie duza liczba zadan.
async function getCronJobsSummary() {
  try {
    const { stdout } = await execFileAsync('sudo', ['-n', `${SCRIPTS_DIR}/cron-jobs-count.sh`], { timeout: 10000 });
    const byUser = stdout.trim().split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [username, countStr] = line.split(/\s+/);
        return { username, count: parseInt(countStr, 10) || 0 };
      })
      .sort((a, b) => b.count - a.count);
    const total = byUser.reduce((sum, u) => sum + u.count, 0);
    return { total, byUser };
  } catch (e) {
    const stderr = (e.stderr || '').toString();
    if (/password is required/i.test(stderr)) {
      throw Object.assign(
        new Error('Brak uprawnien sudo bez hasla dla cron-jobs-count.sh - sprawdz /etc/sudoers.d/caddy-dashboard'),
        { status: 500 }
      );
    }
    throw Object.assign(new Error(stderr.trim() || e.message), { status: 500 });
  }
}

export { getCronJobsSummary };
