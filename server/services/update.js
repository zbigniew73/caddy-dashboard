import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { APP_VERSION } from '../version.js';

const execFileAsync = promisify(execFile);
const REPO_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

function parseVersion(v) {
  return String(v).trim().split('.').map((n) => parseInt(n, 10) || 0);
}

function isNewer(remote, local) {
  const r = parseVersion(remote);
  const l = parseVersion(local);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rv = r[i] || 0;
    const lv = l[i] || 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
}

async function currentBranch() {
  const { stdout } = await execFileAsync('git', ['-C', REPO_DIR, 'branch', '--show-current']);
  return stdout.trim() || 'main';
}

async function checkForUpdate() {
  const branch = await currentBranch();
  await execFileAsync('git', ['-C', REPO_DIR, 'fetch', 'origin', branch, '--quiet']);
  const { stdout } = await execFileAsync('git', ['-C', REPO_DIR, 'show', `origin/${branch}:package.json`]);
  const remoteVersion = JSON.parse(stdout).version;
  return {
    currentVersion: APP_VERSION,
    remoteVersion,
    updateAvailable: isNewer(remoteVersion, APP_VERSION)
  };
}

async function applyUpdate() {
  const branch = await currentBranch();
  await execFileAsync('git', ['-C', REPO_DIR, 'pull', '--ff-only', 'origin', branch]);
  await execFileAsync('npm', ['install', '--omit=dev'], { cwd: REPO_DIR });
  const newVersion = JSON.parse(readFileSync(path.join(REPO_DIR, 'package.json'), 'utf-8')).version;
  return { success: true, newVersion };
}

export { checkForUpdate, applyUpdate };
