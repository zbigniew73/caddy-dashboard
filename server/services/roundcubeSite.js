import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import { readCaddyfile, readSitesFiles } from './caddyPerformance.js';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/roundcube-caddy-config.sh');
const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

// Jedyne miejsce, gdzie domena panelu w ogole istnieje, to zywa
// konfiguracja Caddy (nic w danych aplikacji jej nie przechowuje) - wiec
// wykrywanie polega na znalezieniu bloku, ktorego reverse_proxy wskazuje
// na WLASNY port panelu (ten sam PORT co w .env). Bardzo prosty parser
// linia-po-linii (glebokosc nawiasow), ten sam poziom heurystyki co
// countSiteBlocks() w caddyPerformance.js - wystarczajacy dla plikow
// zawsze przepuszczanych przez `caddy fmt` (co ten projekt zawsze robi
// przed zapisem).
function findReverseProxyDomain(content, port) {
  let depth = 0;
  let currentHost = null;
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (depth === 0 && line.includes('{')) {
      currentHost = line.split('{')[0].trim();
    }
    if (depth >= 1) {
      const m = /reverse_proxy\s+(?:127\.0\.0\.1|localhost):(\d+)/.exec(line);
      if (m && m[1] === String(port) && currentHost) return currentHost;
    }
    depth += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
  }
  return null;
}

// "suggested" to WLASNIE heurystyka, nie pewnik - obcina pierwszy czlon
// (np. "panel.20z.eu" -> "20z.eu"), co dziala dla typowych TLD, ale NIE
// dla domen z zlozonym publicznym sufiksem (np. "cos.co.uk") - dlatego
// front pokazuje to w polu EDYTOWALNYM do potwierdzenia przez admina,
// nigdy nie uzywane bezposrednio bez akceptacji.
async function detectBaseDomain() {
  const port = process.env.PORT || '4300';
  const [mainContent, sitesContent] = await Promise.all([readCaddyfile(), readSitesFiles()]);
  const detected = findReverseProxyDomain(mainContent, port) || findReverseProxyDomain(sitesContent, port);
  if (!detected) return { detected: null, suggested: null };
  const labels = detected.split('.');
  const suggested = labels.length > 2 ? labels.slice(1).join('.') : detected;
  return { detected, suggested };
}

function buildCaddyBlock(domain, gate) {
  const webmailHost = `webmail.${domain}`;
  const mailHost = `mail.${domain}`;
  const webmailBlock = gate
    ? `${webmailHost} {
	handle /rc-gate/* {
		reverse_proxy 127.0.0.1:${process.env.PORT || '4300'}
	}
	handle {
		forward_auth 127.0.0.1:${process.env.PORT || '4300'} {
			uri /rc-gate/check
		}
		header -X-Powered-By
		root * /opt/webmail/public_html
		php_fastcgi unix//opt/webmail/run/roundcube.sock
		file_server
	}
}`
    : `${webmailHost} {
	header -X-Powered-By
	root * /opt/webmail/public_html
	php_fastcgi unix//opt/webmail/run/roundcube.sock
	file_server
}`;
  const mailBlock = `${mailHost} {
	respond "Serwer pocztowy - ten adres nie serwuje strony WWW." 200
}`;
  return `${webmailBlock}\n\n${mailBlock}`;
}

async function runScript(args, { stdin } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('sudo', ['-n', SCRIPT_PATH, ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => reject(Object.assign(new Error(e.message), { status: 500 })));
    child.on('close', (code) => {
      if (code === 0) { resolve(stdout); return; }
      if (/password is required/i.test(stderr)) {
        reject(Object.assign(
          new Error('Brak uprawnien sudo bez hasla dla konfiguracji Caddy dla Roundcube - sprawdz /etc/sudoers.d/caddy-dashboard'),
          { status: 403 }
        ));
        return;
      }
      reject(Object.assign(new Error(stderr.trim() || `exit code ${code}`), { status: 500 }));
    });
    if (stdin !== undefined) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

function assertValidDomain(domain) {
  if (typeof domain !== 'string' || !DOMAIN_RE.test(domain)) {
    throw Object.assign(new Error('Nieprawidlowa domena.'), { status: 400 });
  }
}

async function applyCaddyConfig(domain, gate) {
  assertValidDomain(domain);
  const block = buildCaddyBlock(domain, !!gate);
  const stdout = await runScript(['apply'], { stdin: block });
  return { success: true, message: stdout.trim() };
}

async function removeCaddyConfig() {
  const stdout = await runScript(['remove']);
  return { success: true, message: stdout.trim() };
}

// Uzywane do wyswietlenia obecnego stanu (np. po przeladowaniu panelu) -
// wyciaga domene wprost z zapisanego bloku zamiast polegac wylacznie na
// data/roundcube.json, zeby ekran zawsze pokazywal to, co NAPRAWDE jest w
// Caddyfile, nie tylko to, co panel PAMIETA, ze tam wstawil.
async function getCaddyConfigStatus() {
  let stdout;
  try {
    ({ stdout } = await execFileAsync('sudo', ['-n', SCRIPT_PATH, 'get'], { timeout: 10000 }));
  } catch (e) {
    const stderr = (e.stderr || '').toString().trim();
    if (/password is required/i.test(stderr)) {
      throw Object.assign(
        new Error('Brak uprawnien sudo bez hasla dla konfiguracji Caddy dla Roundcube - sprawdz /etc/sudoers.d/caddy-dashboard'),
        { status: 403 }
      );
    }
    throw Object.assign(new Error(stderr || e.message), { status: 500 });
  }
  const block = stdout.trim();
  if (!block) return { present: false, domain: null, gate: false };
  const webmailMatch = /^webmail\.([^\s{]+)\s*\{/m.exec(block);
  return {
    present: true,
    domain: webmailMatch ? webmailMatch[1] : null,
    gate: block.includes('forward_auth')
  };
}

export { detectBaseDomain, applyCaddyConfig, removeCaddyConfig, getCaddyConfigStatus };
