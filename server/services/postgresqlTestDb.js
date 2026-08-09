import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/postgresql-test-db.sh');

async function runAction(action, sudoErrorLabel) {
  try {
    const { stdout } = await execFileAsync('sudo', ['-n', SCRIPT_PATH, action], { timeout: 30000 });
    return { success: true, message: stdout.trim() };
  } catch (e) {
    const stderr = (e.stderr || '').toString().trim();
    if (/password is required/i.test(stderr)) {
      throw Object.assign(
        new Error(`Brak uprawnien sudo bez hasla dla ${sudoErrorLabel} - sprawdz /etc/sudoers.d/caddy-dashboard`),
        { status: 403 }
      );
    }
    throw Object.assign(new Error(stderr || e.message), { status: 500 });
  }
}

async function getTestDbStatus() {
  const { message } = await runAction('status', 'testowej bazy PostgreSQL');
  return { exists: message.trim() === 'exists' };
}

async function createTestDb() {
  return runAction('create', 'testowej bazy PostgreSQL');
}

async function dropTestDb() {
  return runAction('drop', 'testowej bazy PostgreSQL');
}

export { getTestDbStatus, createTestDb, dropTestDb };
