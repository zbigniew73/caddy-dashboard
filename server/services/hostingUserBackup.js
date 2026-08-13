import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { listAccounts } from './hostingAccounts.js';
import { listOwnSites, getSitePublicPath } from './hostingUserSites.js';
import { listOwnDatabases } from './hostingUserDatabases.js';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data');
const DATA_PATH = path.join(DATA_DIR, 'hosting-backups.json');
const SCRIPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts');

const REPO_TYPES = ['local', 's3', 'b2', 'sftp'];

// Kazde zadanie backupu zajmuje 2 linie w prawdziwym crontabie usera,
// TEN SAM wzorzec co hostingUserCron.js, ale z WLASNYM prefiksem markera
// (# cd-backup: zamiast # cd-cron:) - celowo NIE importujemy nic z
// hostingUserCron.js (te funkcje i tak nie sa tam eksportowane).
// hostingUserCron.js-owy parser traktuje kazda linie spoza "# cd-cron:"
// jako obca i zostawia ja bez zmian - i odwrotnie, ten parser traktuje
// "# cd-cron:"-owe linie jako obce - dzieki temu obie zakladki
// (Cron i Backup) moga bezpiecznie wspoldzielic ten sam plik crontaba,
// bez wzajemnego nadpisywania swoich wpisow.
const MARKER_RE = /^# cd-backup:([a-zA-Z0-9-]{1,64}):(enabled|disabled):([A-Za-z0-9+/=]*)$/;
const JOB_LINE_RE = /^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.*)$/;

// Katalogi/pliki uzywane przez skrypty zadan - wszystkie juz istnieja na
// kazdym koncie (patrz hosting-account-create.sh): ~/tmp na tymczasowe
// dumpy baz, ~/logs na wyjscie zadania, ~/backup/.scripts na same skrypty
// i wspolny .env z danymi repozytorium.
function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function notFound(message) {
  return Object.assign(new Error(message), { status: 404 });
}

function loadData() {
  try {
    const parsed = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
    return {
      repos: Array.isArray(parsed.repos) ? parsed.repos : [],
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : []
    };
  } catch {
    return { repos: [], jobs: [] };
  }
}

function saveData(data) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function getAccount(username) {
  return listAccounts().find((a) => a.username === username) || null;
}

function sudoErrorMessage(scriptName, stderr) {
  if (/password is required/i.test(stderr)) {
    return `Brak uprawnien sudo bez hasla dla ${scriptName} - sprawdz /etc/sudoers.d/caddy-dashboard`;
  }
  return stderr.trim() || null;
}

// Jeden wspolny helper do wywolywania KAZDEGO skryptu sudo tego modulu
// (w tym hosting-user-crontab-get.sh/-set.sh, ktore sa wspolne z
// hostingUserCron.js - format-agnostyczne, "surowa tresc in/out", wiec
// bezpiecznie reuzywalne bez zadnych zmian). Zawsze zwraca stdout - dla
// akcji ktorym nie jest potrzebny (np. job-write) wywolujacy po prostu go
// ignoruje.
function execBackupScript(scriptName, args, stdinContent) {
  return new Promise((resolve, reject) => {
    const child = spawn('sudo', ['-n', `${SCRIPTS_DIR}/${scriptName}`, ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => reject(Object.assign(new Error(e.message), { status: 500 })));
    child.on('close', (code) => {
      if (code === 0) { resolve(stdout); return; }
      const message = sudoErrorMessage(scriptName, stderr);
      reject(Object.assign(new Error(message || stdout.trim() || `exit code ${code}`), { status: message ? 403 : 500 }));
    });
    if (stdinContent !== undefined) child.stdin.write(stdinContent);
    child.stdin.end();
  });
}

function getRawCrontab(username) {
  return execBackupScript('hosting-user-crontab-get.sh', [username]);
}

function setRawCrontab(username, content) {
  return execBackupScript('hosting-user-crontab-set.sh', [username], content).then(() => {});
}

function parseBackupCrontab(raw) {
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

function serializeBackupCrontab({ jobs, foreignLines }) {
  const jobLines = jobs.flatMap((j) => {
    const marker = `# cd-backup:${j.id}:${j.enabled ? 'enabled' : 'disabled'}:${Buffer.from(j.name, 'utf8').toString('base64')}`;
    const line = `${j.schedule} ${j.command}`;
    return [marker, j.enabled ? line : `#${line}`];
  });
  const blocks = [foreignLines, jobLines].filter((b) => b.length > 0);
  return blocks.map((b) => b.join('\n')).join('\n') + (blocks.length ? '\n' : '');
}

function validateSchedule(schedule) {
  if (typeof schedule !== 'string') throw badRequest('Harmonogram jest wymagany.');
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) throw badRequest('Harmonogram musi miec dokladnie 5 pol (minuta godzina dzien miesiac dzien-tygodnia).');
  if (!parts.every((p) => /^[A-Za-z0-9*/,-]+$/.test(p))) {
    throw badRequest('Harmonogram zawiera niedozwolone znaki.');
  }
  return parts.join(' ');
}

function validateName(name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) throw badRequest('Nazwa zadania jest wymagana.');
  if (trimmed.length > 100) throw badRequest('Nazwa jest za dluga (max 100 znakow).');
  if (/[\r\n]/.test(trimmed)) throw badRequest('Nazwa nie moze zawierac znakow nowej linii.');
  return trimmed;
}

function validateKeepLast(value) {
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || String(value).trim() !== String(n) || n < 1 || n > 365) {
    throw badRequest('Liczba przechowywanych snapshotow musi byc liczba calkowita 1-365.');
  }
  return n;
}

// Zwykle pola formularza repozytorium (host/bucket/sciezka/klucze) -
// bialoznaczna lista bez znakow specjalnych powloki ($ ` " \ spacja) - .env
// jest pozniej SOURCE'OWANY przez bash (patrz hosting-user-backup-repo-
// init.sh), wiec kazda wartosc trafia bezposrednio do interpretera
// powloki. Ograniczenie znakow to obrona w glab: user i tak moze wpisac
// dowolna komende przez SSH we wlasnym koncie (zero nowej granicy
// zaufania), ale przypadkowe zlamanie .env przez np. spacje w nazwie
// bucketu ma byc czytelnym bledem walidacji, nie cichym zepsuciem pliku.
const SAFE_FIELD_RE = /^[A-Za-z0-9._\-/:@]{1,255}$/;
// Klucz prywatny SSH (PEM) - wielolinijkowy, zestaw znakow base64 +
// naglowki BEGIN/END + biale znaki (w tym nowe linie).
const PRIVATE_KEY_RE = /^[A-Za-z0-9+/=\s-]{50,8192}$/;

function validateField(label, value, { required = true } = {}) {
  const v = String(value ?? '').trim();
  if (!v) {
    if (required) throw badRequest(`Pole "${label}" jest wymagane.`);
    return '';
  }
  if (!SAFE_FIELD_RE.test(v)) throw badRequest(`Pole "${label}" zawiera niedozwolone znaki.`);
  return v;
}

function validatePort(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw badRequest('Nieprawidlowy port.');
  return n;
}

// .env jest SOURCE'OWANY przez bash - kazda wartosc musi byc w cudzyslowie
// (inaczej spacje w niej rozbilyby linie na wiele "slow" polecenia) i nie
// moze zawierac " ` $ \ (rozbiloby/wykonaloby czesc wartosci jako kod
// powloki). SAFE_FIELD_RE/PRIVATE_KEY_RE juz to wymuszaja dla pol, ktore
// przez nie przechodza - to dodatkowe sprawdzenie jest obrona w glab dla
// WSZYSTKICH wartosci trafiajacych do .env (w tym hasla repo, ktore nie
// idzie przez SAFE_FIELD_RE).
function quoteEnvValue(value) {
  const str = String(value);
  if (/["`$\\]/.test(str)) {
    throw badRequest('Wartosc zawiera niedozwolone znaki (" ` $ \\).');
  }
  return `"${str}"`;
}

function envLine(key, value) {
  return `${key}=${quoteEnvValue(value)}`;
}

// Buduje connection string restic + liste dodatkowych linii .env, per typ
// repozytorium. SFTP jest szczegolny: restic laczy sie kluczem SSH (nie
// haslem) przez lokalna komende `ssh ... -s sftp` - klucz wklejony przez
// usera jest materializowany jako prawdziwy plik dopiero w
// hosting-user-backup-repo-init.sh (tu tylko przechodzi przez .env).
function buildRepoConnection(account, type, fields) {
  if (type === 'local') {
    return { resticRepository: `${account.homeDir}/backup/repo`, credentials: {}, envExtra: [] };
  }
  if (type === 's3') {
    const bucket = validateField('Bucket', fields.bucket);
    const endpoint = validateField('Endpoint', fields.endpoint, { required: false }) || 's3.amazonaws.com';
    const accessKeyId = validateField('Access Key ID', fields.accessKeyId);
    const secretAccessKey = validateField('Secret Access Key', fields.secretAccessKey);
    const region = validateField('Region', fields.region, { required: false });
    return {
      resticRepository: `s3:${endpoint}/${bucket}`,
      credentials: { bucket, endpoint, accessKeyId, secretAccessKey, region },
      envExtra: [
        envLine('AWS_ACCESS_KEY_ID', accessKeyId),
        envLine('AWS_SECRET_ACCESS_KEY', secretAccessKey),
        ...(region ? [envLine('AWS_DEFAULT_REGION', region)] : [])
      ]
    };
  }
  if (type === 'b2') {
    const bucket = validateField('Bucket', fields.bucket);
    const bucketPath = validateField('Sciezka', fields.path, { required: false });
    const accountId = validateField('Account ID', fields.accountId);
    const accountKey = validateField('Application Key', fields.accountKey);
    return {
      resticRepository: `b2:${bucket}:${bucketPath}`,
      credentials: { bucket, path: bucketPath, accountId, accountKey },
      envExtra: [
        envLine('B2_ACCOUNT_ID', accountId),
        envLine('B2_ACCOUNT_KEY', accountKey)
      ]
    };
  }
  if (type === 'sftp') {
    const host = validateField('Host', fields.host);
    const port = validatePort(fields.port, 22);
    const sftpUser = validateField('Uzytkownik SFTP', fields.sftpUser);
    const remotePath = validateField('Sciezka', fields.path);
    const privateKey = String(fields.privateKey || '').trim();
    if (!privateKey) throw badRequest('Klucz prywatny SSH jest wymagany dla SFTP.');
    if (!PRIVATE_KEY_RE.test(privateKey)) throw badRequest('Nieprawidlowy format klucza prywatnego SSH.');
    const keyPath = `${account.homeDir}/.ssh/id_backup_restic`;
    const sftpCommand = `ssh -i ${keyPath} -o StrictHostKeyChecking=accept-new -p ${port} ${sftpUser}@${host} -s sftp`;
    return {
      resticRepository: `sftp:${sftpUser}@${host}:${remotePath}`,
      credentials: { host, port, sftpUser, path: remotePath, privateKey },
      envExtra: [
        envLine('RESTIC_SFTP_COMMAND', sftpCommand),
        envLine('RESTIC_SFTP_PRIVATE_KEY', privateKey)
      ]
    };
  }
  throw badRequest('Nieprawidlowy typ repozytorium.');
}

function getRepoSettings(username) {
  const { repos } = loadData();
  return repos.find((r) => r.accountUsername === username) || null;
}

async function saveRepoSettings(username, { type, password, ...fields }) {
  const account = getAccount(username);
  if (!account) throw badRequest('Nie znaleziono konta hostingowego.');
  if (!REPO_TYPES.includes(type)) throw badRequest('Nieprawidlowy typ repozytorium.');

  const passwordValue = String(password || '').trim();
  if (!passwordValue) throw badRequest('Haslo repozytorium jest wymagane.');

  const { resticRepository, credentials, envExtra } = buildRepoConnection(account, type, fields);

  const envContent = [
    envLine('RESTIC_REPOSITORY', resticRepository),
    envLine('RESTIC_PASSWORD', passwordValue),
    ...envExtra
  ].join('\n');
  await execBackupScript('hosting-user-backup-repo-init.sh', [username], envContent);

  const data = loadData();
  const existingIdx = data.repos.findIndex((r) => r.accountUsername === username);
  const record = {
    id: existingIdx >= 0 ? data.repos[existingIdx].id : randomUUID(),
    accountUsername: username,
    type,
    resticRepository,
    resticPassword: passwordValue,
    credentials,
    initialized: true,
    createdAt: existingIdx >= 0 ? data.repos[existingIdx].createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (existingIdx >= 0) data.repos[existingIdx] = record; else data.repos.push(record);
  saveData(data);
  return record;
}

async function validateSiteIds(username, siteIds) {
  if (siteIds === undefined || siteIds === null) return [];
  if (!Array.isArray(siteIds)) throw badRequest('Nieprawidlowa lista stron.');
  const { items } = await listOwnSites(username);
  const byId = new Map(items.map((s) => [s.id, s]));
  return siteIds.map((id) => {
    const site = byId.get(id);
    if (!site) throw badRequest('Nie znaleziono wybranej strony.');
    if (site.template === 'reverseproxy') {
      throw badRequest(`Strona "${site.domain}" (Reverse Proxy) nie ma katalogu public/ do zbackupowania.`);
    }
    return id;
  });
}

async function validateDatabaseIds(username, databaseIds) {
  if (databaseIds === undefined || databaseIds === null) return [];
  if (!Array.isArray(databaseIds)) throw badRequest('Nieprawidlowa lista baz danych.');
  const { items } = await listOwnDatabases(username);
  const byId = new Set(items.map((d) => d.id));
  return databaseIds.map((id) => {
    if (!byId.has(id)) throw badRequest('Nie znaleziono wybranej bazy danych.');
    return id;
  });
}

function shQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

// Dump jednej bazy do pliku pod $DUMP_DIR (patrz buildJobScript) - haslo
// zawsze przez zmienna srodowiskowa/URI, NIGDY jako osobny argv-widoczny
// parametr, TAM gdzie silnik na to pozwala (MYSQL_PWD/PGPASSWORD).
// mongodump NIE MA odpowiednika zmiennej srodowiskowej na haslo - trafia
// do URI na argv, widoczne przez `ps` innym lokalnym userom - DOKLADNIE
// ten sam kompromis juz zaakceptowany w hosting-db-mongodb.sh
// (`mongosh -p "$ADMIN_PASS"`), nie nowy.
function buildDumpLine(db) {
  const dumpBase = `$DUMP_DIR/${db.dbName}`;
  switch (db.engine) {
    case 'mariadb':
      return `MYSQL_PWD=${shQuote(db.password)} mysqldump -h 127.0.0.1 -u ${shQuote(db.dbUser)} ${shQuote(db.dbName)} > "${dumpBase}.sql"`;
    case 'postgresql':
      return `PGPASSWORD=${shQuote(db.password)} pg_dump -h 127.0.0.1 -U ${shQuote(db.dbUser)} ${shQuote(db.dbName)} > "${dumpBase}.sql"`;
    case 'mongodb':
      return `mongodump --uri=${shQuote(`mongodb://${db.dbUser}:${db.password}@127.0.0.1:27017/${db.dbName}?authSource=${db.dbName}`)} --archive="${dumpBase}.archive"`;
    default:
      return `: # nieznany silnik '${db.engine}', pomijam`;
  }
}

// Generuje tresc skryptu JEDNEGO zadania backupu - patrz komentarz przy
// hosting-user-backup-job-write.sh. $DUMP_DIR ląduje pod juz istniejacym,
// prywatnym ~/tmp (per-konto, nie per-strona - patrz
// hosting-account-create.sh); zrodlo repo (.env, w tym haslo restic i
// ewentualne dane logowania do S3/B2/SFTP) jest source'owane z
// ~/backup/.scripts/.env, WSPOLNEGO dla wszystkich zadan tego konta -
// zmiana Ustawien repozytorium NIE wymaga przepisywania kazdego skryptu
// zadania.
async function buildJobScript(username, job) {
  const { items: allSites } = await listOwnSites(username);
  const { items: allDbs } = await listOwnDatabases(username);

  const sitePaths = job.siteIds
    .filter((id) => allSites.some((s) => s.id === id))
    .map((id) => getSitePublicPath(username, id))
    .filter(Boolean);

  const selectedDbs = job.databaseIds
    .map((id) => allDbs.find((d) => d.id === id))
    .filter(Boolean);
  const dumpLines = selectedDbs.map(buildDumpLine);

  const backupTargets = [];
  if (dumpLines.length) backupTargets.push('"$DUMP_DIR"');
  for (const p of sitePaths) backupTargets.push(shQuote(p));
  if (!backupTargets.length) throw badRequest('Brak zrodel do zbackupowania.');

  const lines = ['#!/usr/bin/env bash', 'set -euo pipefail'];
  if (dumpLines.length) {
    lines.push(`DUMP_DIR="$HOME/tmp/backup-dump-${job.id}-$(date +%s)"`);
    lines.push('mkdir -p "$DUMP_DIR"');
    lines.push(...dumpLines);
  }
  lines.push('set -a');
  lines.push('# shellcheck disable=SC1091');
  lines.push('source "$HOME/backup/.scripts/.env"');
  lines.push('set +a');
  lines.push('RESTIC_OPTS=()');
  lines.push('if [ -n "${RESTIC_SFTP_COMMAND:-}" ]; then RESTIC_OPTS=(-o "sftp.command=${RESTIC_SFTP_COMMAND}"); fi');
  lines.push(`restic "\${RESTIC_OPTS[@]}" backup ${backupTargets.join(' ')} --tag ${shQuote(`cd-backup:${job.id}`)}`);
  if (dumpLines.length) lines.push('rm -rf "$DUMP_DIR"');
  lines.push(`restic "\${RESTIC_OPTS[@]}" forget --keep-last ${job.keepLast} --prune`);
  return `${lines.join('\n')}\n`;
}

function buildCronCommand(account, jobId) {
  return `bash "${account.homeDir}/backup/.scripts/${jobId}.sh" >> "${account.homeDir}/logs/backup-${jobId}.log" 2>&1`;
}

function toPublicJob(record, cronPart) {
  return {
    id: record.id,
    name: cronPart.name,
    schedule: cronPart.schedule,
    enabled: cronPart.enabled,
    siteIds: record.siteIds,
    databaseIds: record.databaseIds,
    keepLast: record.keepLast,
    lastRunAt: record.lastRunAt,
    lastRunStatus: record.lastRunStatus,
    createdAt: record.createdAt
  };
}

// Zadanie = JSON (co: siteIds/databaseIds/keepLast/nazwa-kopia) + wpis w
// crontabie (kiedy: harmonogram, enabled - patrz komentarz przy MARKER_RE
// wyzej). Laczymy je tu po id - wpis JSON bez odpowiadajacej linii w
// crontabie (np. ktos recznie usunal linie przez SSH) jest CICHO pomijany
// (traktowany jak osierocony), nie wywala calej listy - ten sam,
// zaakceptowany juz w projekcie brak blokady wspolbieznego zapisu
// crontaba (Cron i Backup NIE maja zadnego mechanizmu blokowania, tak
// jak nic innego w tym projekcie).
async function listJobs(username) {
  const raw = await getRawCrontab(username);
  const { jobs: cronJobs } = parseBackupCrontab(raw);
  const cronById = new Map(cronJobs.map((j) => [j.id, j]));

  const { jobs: storedJobs } = loadData();
  return storedJobs
    .filter((j) => j.accountUsername === username)
    .map((stored) => {
      const cron = cronById.get(stored.id);
      return cron ? toPublicJob(stored, cron) : null;
    })
    .filter(Boolean);
}

async function createJob(username, { name, schedule, siteIds, databaseIds, keepLast }) {
  const account = getAccount(username);
  if (!account) throw badRequest('Nie znaleziono konta hostingowego.');
  if (!getRepoSettings(username)) {
    throw badRequest('Najpierw skonfiguruj repozytorium w sekcji Ustawienia.');
  }

  const nameValue = validateName(name);
  const scheduleValue = validateSchedule(schedule);
  const siteIdsValue = await validateSiteIds(username, siteIds);
  const databaseIdsValue = await validateDatabaseIds(username, databaseIds);
  if (siteIdsValue.length === 0 && databaseIdsValue.length === 0) {
    throw badRequest('Wybierz przynajmniej jedna strone lub baze danych.');
  }
  const keepLastValue = validateKeepLast(keepLast);

  const id = randomUUID();
  const record = {
    id,
    accountUsername: username,
    siteIds: siteIdsValue,
    databaseIds: databaseIdsValue,
    keepLast: keepLastValue,
    createdAt: new Date().toISOString(),
    lastRunAt: null,
    lastRunStatus: null
  };

  const scriptContent = await buildJobScript(username, record);
  await execBackupScript('hosting-user-backup-job-write.sh', [username, id], scriptContent);

  const state = parseBackupCrontab(await getRawCrontab(username));
  state.jobs.push({ id, name: nameValue, schedule: scheduleValue, command: buildCronCommand(account, id), enabled: true });
  await setRawCrontab(username, serializeBackupCrontab(state));

  const data = loadData();
  data.jobs.push(record);
  saveData(data);

  return toPublicJob(record, { name: nameValue, schedule: scheduleValue, enabled: true });
}

async function updateJob(username, id, { name, schedule, siteIds, databaseIds, keepLast, enabled }) {
  const data = loadData();
  const record = data.jobs.find((j) => j.id === id && j.accountUsername === username);
  if (!record) throw notFound('Nie znaleziono zadania backupu.');

  const state = parseBackupCrontab(await getRawCrontab(username));
  const cronJob = state.jobs.find((j) => j.id === id);
  if (!cronJob) throw notFound('Nie znaleziono zadania backupu.');

  if (name !== undefined) cronJob.name = validateName(name);
  if (schedule !== undefined) cronJob.schedule = validateSchedule(schedule);
  if (enabled !== undefined) cronJob.enabled = !!enabled;

  let scriptNeedsRewrite = false;
  if (siteIds !== undefined) { record.siteIds = await validateSiteIds(username, siteIds); scriptNeedsRewrite = true; }
  if (databaseIds !== undefined) { record.databaseIds = await validateDatabaseIds(username, databaseIds); scriptNeedsRewrite = true; }
  if (keepLast !== undefined) { record.keepLast = validateKeepLast(keepLast); scriptNeedsRewrite = true; }
  if (record.siteIds.length === 0 && record.databaseIds.length === 0) {
    throw badRequest('Wybierz przynajmniej jedna strone lub baze danych.');
  }

  if (scriptNeedsRewrite) {
    const scriptContent = await buildJobScript(username, record);
    await execBackupScript('hosting-user-backup-job-write.sh', [username, id], scriptContent);
  }

  await setRawCrontab(username, serializeBackupCrontab(state));
  saveData(data);

  return toPublicJob(record, cronJob);
}

async function deleteJob(username, id) {
  const data = loadData();
  const before = data.jobs.length;
  data.jobs = data.jobs.filter((j) => !(j.id === id && j.accountUsername === username));
  if (data.jobs.length === before) throw notFound('Nie znaleziono zadania backupu.');

  const state = parseBackupCrontab(await getRawCrontab(username));
  state.jobs = state.jobs.filter((j) => j.id !== id);
  await setRawCrontab(username, serializeBackupCrontab(state));

  await execBackupScript('hosting-user-backup-job-delete.sh', [username, id]);
  saveData(data);
}

async function runJobNow(username, id) {
  const data = loadData();
  const record = data.jobs.find((j) => j.id === id && j.accountUsername === username);
  if (!record) throw notFound('Nie znaleziono zadania backupu.');

  let success = true;
  let output = '';
  try {
    output = await execBackupScript('hosting-user-backup-run.sh', [username, id]);
  } catch (e) {
    success = false;
    output = e.message;
  }
  record.lastRunAt = new Date().toISOString();
  record.lastRunStatus = success ? 'success' : 'error';
  saveData(data);

  if (!success) throw Object.assign(new Error(output), { status: 500 });
  return { success: true, output };
}

async function listSnapshots(username) {
  if (!getRepoSettings(username)) return [];
  const raw = await execBackupScript('hosting-user-backup-snapshots.sh', [username]);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = [];
  }
  if (!Array.isArray(parsed)) parsed = [];
  return parsed.map((s) => ({
    id: s.id,
    shortId: s.short_id,
    time: s.time,
    paths: Array.isArray(s.paths) ? s.paths : [],
    tags: Array.isArray(s.tags) ? s.tags : []
  }));
}

async function restoreSnapshot(username, snapshotId) {
  if (!getRepoSettings(username)) {
    throw badRequest('Najpierw skonfiguruj repozytorium w sekcji Ustawienia.');
  }
  const value = String(snapshotId || '');
  if (!/^([0-9a-f]{8,64}|latest)$/.test(value)) {
    throw badRequest('Nieprawidlowy identyfikator snapshotu.');
  }
  const output = await execBackupScript('hosting-user-backup-restore.sh', [username, value]);
  const match = /przywrocony do (\S+)/.exec(output);
  return { stagingPath: match ? match[1] : null, output };
}

export {
  getRepoSettings, saveRepoSettings,
  listJobs, createJob, updateJob, deleteJob, runJobNow,
  listSnapshots, restoreSnapshot
};
