import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url)) + '/../scripts';

const MAX_COMMAND_LENGTH = 2000;
const MAX_NAME_LENGTH = 100;

// Kazde zadanie zajmuje 2 linie w prawdziwym crontabie usera:
//   # cd-cron:<id>:<enabled|disabled>:<base64(nazwa)>
//   <harmonogram> <polecenie>          (zakomentowane "#..." gdy disabled)
// Wszystkie inne linie (spoza tego wzorca) sa traktowane jako "obce" i
// przechodza przez odczyt/zapis bez zmian - user teoretycznie mogl miec
// wlasny wpis w crontabie sprzed uzycia panelu (np. dodany recznie przez
// SSH), panel nie ma prawa go skasowac.
const MARKER_RE = /^# cd-cron:([a-zA-Z0-9-]{1,64}):(enabled|disabled):([A-Za-z0-9+/=]*)$/;
const JOB_LINE_RE = /^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.*)$/;

function sudoErrorMessage(scriptName, stderr) {
  if (/password is required/i.test(stderr)) {
    return `Brak uprawnien sudo bez hasla dla ${scriptName} - sprawdz /etc/sudoers.d/caddy-dashboard`;
  }
  return stderr.trim() || null;
}

function getRawCrontab(username) {
  return new Promise((resolve, reject) => {
    execFileAsync('sudo', ['-n', `${SCRIPTS_DIR}/hosting-user-crontab-get.sh`, username], { timeout: 10000 })
      .then(({ stdout }) => resolve(stdout))
      .catch((e) => {
        const stderr = (e.stderr || '').toString();
        reject(Object.assign(
          new Error(sudoErrorMessage('hosting-user-crontab-get.sh', stderr) || e.message), { status: 500 }
        ));
      });
  });
}

function setRawCrontab(username, content) {
  return new Promise((resolve, reject) => {
    const child = spawn('sudo', ['-n', `${SCRIPTS_DIR}/hosting-user-crontab-set.sh`, username]);
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => reject(Object.assign(new Error(e.message), { status: 500 })));
    child.on('close', (code) => {
      if (code === 0) { resolve(); return; }
      const message = sudoErrorMessage('hosting-user-crontab-set.sh', stderr);
      reject(Object.assign(new Error(message || `exit code ${code}`), { status: message ? 403 : 500 }));
    });
    child.stdin.write(content);
    child.stdin.end();
  });
}

function parseCrontab(raw) {
  const lines = raw.split('\n');
  const jobs = [];
  const foreignLines = [];
  for (let i = 0; i < lines.length; i++) {
    const markerMatch = lines[i].match(MARKER_RE);
    if (markerMatch && i + 1 < lines.length) {
      const [, id, state, nameB64] = markerMatch;
      const enabled = state === 'enabled';
      const rawJobLine = lines[i + 1];
      const jobLine = enabled ? rawJobLine : rawJobLine.replace(/^#/, '');
      const jobMatch = jobLine.match(JOB_LINE_RE);
      if (jobMatch) {
        jobs.push({
          id,
          name: Buffer.from(nameB64, 'base64').toString('utf8'),
          schedule: jobMatch[1],
          command: jobMatch[2],
          enabled
        });
        i += 1;
        continue;
      }
    }
    if (lines[i].trim() !== '') foreignLines.push(lines[i]);
  }
  return { jobs, foreignLines };
}

function serializeCrontab({ jobs, foreignLines }) {
  const jobLines = jobs.flatMap((j) => {
    const marker = `# cd-cron:${j.id}:${j.enabled ? 'enabled' : 'disabled'}:${Buffer.from(j.name, 'utf8').toString('base64')}`;
    const line = `${j.schedule} ${j.command}`;
    return [marker, j.enabled ? line : `#${line}`];
  });
  const blocks = [foreignLines, jobLines].filter((b) => b.length > 0);
  return blocks.map((b) => b.join('\n')).join('\n') + (blocks.length ? '\n' : '');
}

// Pola harmonogramu akceptuja cyfry, gwiazdki, przecinki, myslniki,
// ukosniki oraz litery (nazwy miesiecy/dni tygodnia typu JAN/MON) - bez
// spacji wewnatrz pola i bez znakow, ktore mogłyby zlamac format linii
// crontaba (np. '#').
function validateSchedule(schedule) {
  if (typeof schedule !== 'string') throw badRequest('Harmonogram jest wymagany.');
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) throw badRequest('Harmonogram musi miec dokladnie 5 pol (minuta godzina dzien miesiac dzien-tygodnia).');
  if (!parts.every((p) => /^[A-Za-z0-9*/,-]+$/.test(p))) {
    throw badRequest('Harmonogram zawiera niedozwolone znaki.');
  }
  return parts.join(' ');
}

function validateCommand(command) {
  if (typeof command !== 'string' || command.trim() === '') throw badRequest('Polecenie jest wymagane.');
  const trimmed = command.trim();
  if (trimmed.length > MAX_COMMAND_LENGTH) throw badRequest(`Polecenie jest za dlugie (max ${MAX_COMMAND_LENGTH} znakow).`);
  if (/[\r\n]/.test(trimmed)) throw badRequest('Polecenie nie moze zawierac znakow nowej linii.');
  return trimmed;
}

function validateName(name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (trimmed.length > MAX_NAME_LENGTH) throw badRequest(`Nazwa jest za dluga (max ${MAX_NAME_LENGTH} znakow).`);
  if (/[\r\n]/.test(trimmed)) throw badRequest('Nazwa nie moze zawierac znakow nowej linii.');
  return trimmed;
}

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

async function listCronJobs(username) {
  const raw = await getRawCrontab(username);
  return parseCrontab(raw).jobs;
}

async function createCronJob(username, { name, schedule, command }) {
  const job = {
    id: randomUUID(),
    name: validateName(name),
    schedule: validateSchedule(schedule),
    command: validateCommand(command),
    enabled: true
  };
  const state = parseCrontab(await getRawCrontab(username));
  state.jobs.push(job);
  await setRawCrontab(username, serializeCrontab(state));
  return job;
}

async function updateCronJob(username, id, { name, schedule, command, enabled }) {
  const state = parseCrontab(await getRawCrontab(username));
  const job = state.jobs.find((j) => j.id === id);
  if (!job) throw Object.assign(new Error('Nie znaleziono zadania cron.'), { status: 404 });

  if (name !== undefined) job.name = validateName(name);
  if (schedule !== undefined) job.schedule = validateSchedule(schedule);
  if (command !== undefined) job.command = validateCommand(command);
  if (enabled !== undefined) job.enabled = !!enabled;

  await setRawCrontab(username, serializeCrontab(state));
  return job;
}

async function deleteCronJob(username, id) {
  const state = parseCrontab(await getRawCrontab(username));
  const before = state.jobs.length;
  state.jobs = state.jobs.filter((j) => j.id !== id);
  if (state.jobs.length === before) throw Object.assign(new Error('Nie znaleziono zadania cron.'), { status: 404 });
  await setRawCrontab(username, serializeCrontab(state));
}

// Prawdziwe, zainstalowane binarki PHP CLI - podpowiedz w formularzu
// dodawania zadania, zeby user nie zgadywal sciezki. NIE zgadujemy -
// czytamy rzeczywisty stan systemu (world-readable pliki, bez sudo):
// /usr/local/bin/php<XX> to wrapper tworzony przez
// server/runtime-manager/scripts/php-install.sh dla kazdej zainstalowanej
// wersji Remi, /usr/bin/php to ewentualny domyslny system-wide php-cli.
function listPhpCliPaths() {
  const paths = [];
  if (fs.existsSync('/usr/bin/php')) paths.push('/usr/bin/php');
  let wrapperNames = [];
  try {
    wrapperNames = fs.readdirSync('/usr/local/bin').filter((f) => /^php[0-9]{2}$/.test(f)).sort();
  } catch {
    wrapperNames = [];
  }
  for (const name of wrapperNames) paths.push(`/usr/local/bin/${name}`);
  return paths;
}

export { listCronJobs, createCronJob, updateCronJob, deleteCronJob, listPhpCliPaths };
