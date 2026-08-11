import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url)) + '/../scripts';

// Liczba WSZYSTKICH zadan cron na calym serwerze (wszyscy systemowi
// userzy z wlasnym crontabem, /var/spool/cron/*) - patrz komentarz w
// cron-jobs-count.sh. Kafelek "Ilosc wszystkich zadan cron" w karcie
// uslugi CRON w panelu admina.
async function getCronJobsCount() {
  try {
    const { stdout } = await execFileAsync('sudo', ['-n', `${SCRIPTS_DIR}/cron-jobs-count.sh`], { timeout: 10000 });
    return parseInt(stdout.trim(), 10) || 0;
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

export { getCronJobsCount };
