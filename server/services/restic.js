import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

async function getInstalledStatus() {
  try {
    const { stdout } = await execFileAsync('restic', ['version'], { timeout: 5000 });
    const match = stdout.match(/restic\s+([\d.]+)/i);
    return { installed: true, version: match ? match[1] : null };
  } catch {
    return { installed: false, version: null };
  }
}

export { getInstalledStatus };
