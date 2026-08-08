import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/caddy-set-performance.sh');
const MARK_START = '# BEGIN caddy-dashboard-performance';
const MARK_END = '# END caddy-dashboard-performance';
const MAX_EXPERT_LENGTH = 20000;

const PROFILES = {
  balanced: { read_body: '30s', read_header: '10s', write: '30s', idle: '120s', max_header_bytes: 1048576 },
  low_ram: { read_body: '15s', read_header: '5s', write: '15s', idle: '30s', max_header_bytes: 262144 },
  high_throughput: { read_body: '60s', read_header: '15s', write: '60s', idle: '300s', max_header_bytes: 2097152 }
};

function profileBlock(key) {
  const p = PROFILES[key];
  if (!p) return null;
  return `{
	admin localhost:2019
	grace_period 20s
	# Default to error-only logging in production to minimize I/O overhead.
	log {
		level ERROR
	}
	servers {
		timeouts {
			read_body   ${p.read_body}
			read_header ${p.read_header}
			write       ${p.write}
			idle        ${p.idle}
		}
		max_header_bytes ${p.max_header_bytes}
	}
}`;
}

async function sudoScript(args) {
  try {
    const { stdout } = await execFileAsync('sudo', ['-n', SCRIPT_PATH, ...args], { timeout: 10000 });
    return stdout;
  } catch (e) {
    const stderr = (e.stderr || '').toString().trim();
    if (/password is required/i.test(stderr)) {
      throw Object.assign(
        new Error('Brak uprawnien sudo bez hasla dla skryptu ustawien wydajnosci Caddy - sprawdz /etc/sudoers.d/caddy-dashboard'),
        { status: 403 }
      );
    }
    throw Object.assign(new Error(stderr || e.message), { status: 500 });
  }
}

function readCaddyfile() {
  return sudoScript(['get']);
}

function extractBlock(content) {
  const startIdx = content.indexOf(MARK_START);
  const endIdx = content.indexOf(MARK_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return null;
  return content.slice(startIdx + MARK_START.length, endIdx).trim();
}

async function getStatus() {
  const profileBlocks = Object.fromEntries(Object.keys(PROFILES).map((key) => [key, profileBlock(key)]));
  const content = await readCaddyfile();
  const block = extractBlock(content);
  if (!block) return { active: false, profile: null, block: null, profileBlocks };
  for (const key of Object.keys(PROFILES)) {
    if (profileBlocks[key].trim() === block) {
      return { active: true, profile: key, block, profileBlocks };
    }
  }
  return { active: true, profile: 'expert', block, profileBlocks };
}

function applyPerformanceConfig({ profile, expertBlock }) {
  return new Promise((resolve, reject) => {
    let blockContent;
    if (profile === 'expert') {
      blockContent = typeof expertBlock === 'string' ? expertBlock.trim() : '';
      if (!blockContent) {
        reject(Object.assign(new Error('Tryb eksperta: brak tresci bloku'), { status: 400 }));
        return;
      }
      if (blockContent.length > MAX_EXPERT_LENGTH) {
        reject(Object.assign(new Error('Tryb eksperta: tresc zbyt dluga'), { status: 400 }));
        return;
      }
      if (!blockContent.startsWith('{') || !blockContent.endsWith('}')) {
        reject(Object.assign(new Error('Tryb eksperta: tresc musi byc pelnym blokiem nawiasow klamrowych { ... }'), { status: 400 }));
        return;
      }
    } else {
      blockContent = profileBlock(profile);
      if (!blockContent) {
        reject(Object.assign(new Error('Nieznany profil'), { status: 400 }));
        return;
      }
    }

    const payload = `${MARK_START}\n${blockContent}\n${MARK_END}\n`;

    const child = spawn('sudo', ['-n', SCRIPT_PATH]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => reject(Object.assign(new Error(e.message), { status: 500 })));
    child.on('close', (code) => {
      if (code === 0) {
        getStatus()
          .then((status) => resolve({ success: true, message: stdout.trim(), ...status }))
          .catch(() => resolve({ success: true, message: stdout.trim() }));
        return;
      }
      if (/password is required/i.test(stderr)) {
        reject(Object.assign(
          new Error('Brak uprawnien sudo bez hasla dla skryptu ustawien wydajnosci Caddy - sprawdz /etc/sudoers.d/caddy-dashboard'),
          { status: 403 }
        ));
        return;
      }
      reject(Object.assign(new Error(stderr.trim() || `exit code ${code}`), { status: 500 }));
    });
    child.stdin.write(payload);
    child.stdin.end();
  });
}

export { PROFILES, profileBlock, getStatus, applyPerformanceConfig, readCaddyfile };
