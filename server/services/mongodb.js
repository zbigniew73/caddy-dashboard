import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/mongodb-install.sh');
const VERSIONS = ['7.0', '8.0'];

async function installMongodb({ version }) {
  if (!VERSIONS.includes(version)) {
    throw Object.assign(new Error('Nieprawidlowa wersja MongoDB (dozwolone: 7.0, 8.0)'), { status: 400 });
  }

  try {
    const { stdout } = await execFileAsync('sudo', ['-n', SCRIPT_PATH, version], { timeout: 300000 });
    return { success: true, message: stdout.trim() };
  } catch (e) {
    const stderr = (e.stderr || '').toString().trim();
    if (/password is required/i.test(stderr)) {
      throw Object.assign(
        new Error('Brak uprawnien sudo bez hasla dla instalacji MongoDB - sprawdz /etc/sudoers.d/caddy-dashboard'),
        { status: 403 }
      );
    }
    throw Object.assign(new Error(stderr || e.message), { status: 500 });
  }
}

async function checkAuthStatus() {
  try {
    await execFileAsync(
      'mongosh',
      ['--quiet', '--eval', 'JSON.stringify(db.adminCommand({listDatabases:1}))'],
      { timeout: 5000 }
    );
    // Polaczenie bez poswiadczen powiodlo sie -> autoryzacja NIE jest wymuszona -> konfiguracja niedokonczona.
    return { reachable: true, authConfigured: false };
  } catch (e) {
    const stderr = (e.stderr || '').toString();
    if (/ECONNREFUSED|MongoNetworkError|ENOENT/i.test(stderr) || e.code === 'ENOENT') {
      return { reachable: false, authConfigured: false };
    }
    if (/requires authentication|not authorized|Unauthorized/i.test(stderr)) {
      return { reachable: true, authConfigured: true };
    }
    return { reachable: true, authConfigured: false };
  }
}

export { VERSIONS, installMongodb, checkAuthStatus };
