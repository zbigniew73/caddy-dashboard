import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/caddy-set-performance.sh');
const MARK_START = '# BEGIN caddy-dashboard-performance';
const MARK_END = '# END caddy-dashboard-performance';
const MAX_EXPERT_LENGTH = 20000;

const PROFILES = {
  balanced: { read_body: '30s', read_header: '10s', write: '30s', idle: '120s', max_header_size: 16384 },
  low_ram: { read_body: '15s', read_header: '5s', write: '15s', idle: '30s', max_header_size: 8192 },
  high_throughput: { read_body: '60s', read_header: '15s', write: '60s', idle: '300s', max_header_size: 65536 }
};

// Wspolny budowniczy bloku - uzywany zarowno przez statyczne profile
// (profileBlock) jak i przez wyliczony profil "recommended"
// (computeRecommendedProfile nizej), zeby obie sciezki produkowaly
// dokladnie ten sam ksztalt configu z jednego miejsca.
function buildBlockFromValues(p) {
  return `{
	admin localhost:2019
	grace_period 20s
	log {
		output file /var/log/caddy/caddy.log {
			roll_size 10MiB
			roll_keep 5
			roll_keep_for 168h
		}
		format json
		level WARN
	}
	servers {
		timeouts {
			read_body   ${p.read_body}
			read_header ${p.read_header}
			write       ${p.write}
			idle        ${p.idle}
		}
		max_header_size ${p.max_header_size}
	}
}`;
}

function profileBlock(key) {
  const p = PROFILES[key];
  if (!p) return null;
  return buildBlockFromValues(p);
}

// 4. profil, "obliczony" - punktem startowym sa te same TRZY statyczne
// profile wyzej (nie wymyslamy nowych liczb od zera), tylko wybor miedzy
// nimi jest CIAGLY: ile RAM/CPU wypada na KAZDA planowana strone decyduje
// ktory z trzech profili jest najblizszy, a wynik jest dodatkowo skalowany
// W DOL procentem ruchu przez Cloudflare - Cloudflare terminuje
// polaczenie z realnym (czasem wolnym) klientem i samo ma wlasny bufor
// czasowy do origin, wiec im wiecej ruchu idzie przez CF, tym mniej sensu
// ma trzymac dlugie timeouty "na wszelki wypadek" bezposredniego, wolnego
// klienta.
//
// To HEURYSTYKA (moja wlasna, rozsadna estymacja), NIE oficjalne
// zalecenie z dokumentacji Caddy - punkt startowy do dalszego strojenia
// (user zawsze moze przelaczyc sie na tryb eksperta i skorygowac
// recznie), nie objawiona prawda.
const CF_MAX_SHRINK = 0.3; // przy 100% ruchu przez CF, skracamy timeouty o max 30%

function computeRecommendedProfile({ plannedSites, cfPercent }) {
  const cpus = os.cpus().length;
  const ramMb = Math.round(os.totalmem() / (1024 * 1024));
  const sites = Math.max(1, parseInt(plannedSites, 10) || 1);
  const cf = Math.min(100, Math.max(0, parseInt(cfPercent, 10) || 0));

  const ramPerSiteMb = ramMb / sites;
  const cpuPerTenSites = (cpus / sites) * 10;

  let tier;
  if (ramPerSiteMb < 150 || cpuPerTenSites < 1) {
    tier = 'low_ram';
  } else if (ramPerSiteMb > 800 && cpuPerTenSites >= 4) {
    tier = 'high_throughput';
  } else {
    tier = 'balanced';
  }

  const base = PROFILES[tier];
  const cfFactor = 1 - (cf / 100) * CF_MAX_SHRINK;
  const scaleSeconds = (s) => `${Math.max(5, Math.round(parseInt(s, 10) * cfFactor))}s`;

  const values = {
    read_body: scaleSeconds(base.read_body),
    read_header: scaleSeconds(base.read_header),
    write: scaleSeconds(base.write),
    idle: scaleSeconds(base.idle),
    max_header_size: base.max_header_size
  };

  return { cpus, ramMb, sites, cfPercent: cf, tier, values };
}

// Podglad dla panelu (przed kliknieciem "Zastosuj") - dokleja tez
// wykryta REALNA liczbe stron z aktualnego Caddyfile (getSiteCount
// nizej), zeby pole "planowana liczba stron" mialo sensowna wartosc
// domyslna zamiast pustego pola.
async function getRecommendedPreview({ plannedSites, cfPercent }) {
  const detectedSites = await getSiteCount().catch(() => null);
  const effectivePlannedSites = plannedSites !== undefined && plannedSites !== null && plannedSites !== ''
    ? plannedSites
    : detectedSites;
  const recommendation = computeRecommendedProfile({ plannedSites: effectivePlannedSites, cfPercent });
  return { ...recommendation, detectedSites, block: buildBlockFromValues(recommendation.values) };
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

function countSiteBlocks(content) {
  let depth = 0;
  let siteCount = 0;
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const openCount = (line.match(/{/g) || []).length;
    const closeCount = (line.match(/}/g) || []).length;
    if (depth === 0 && openCount > 0) {
      const beforeBrace = line.split('{')[0].trim();
      if (beforeBrace) siteCount++;
    }
    depth += openCount - closeCount;
  }
  return siteCount;
}

async function getSiteCount() {
  const content = await readCaddyfile();
  return countSiteBlocks(content);
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

function applyPerformanceConfig({ profile, expertBlock, plannedSites, cfPercent }) {
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
    } else if (profile === 'recommended') {
      // Wartosci sa PRZELICZANE TU, servera-side, z tych samych
      // plannedSites/cfPercent co user widzial w podgladzie - nigdy nie
      // ufamy gotowemu blokowi przyslanemu z przegladarki (ten sam wzorzec
      // co reszta projektu - klient dostarcza tylko surowe wejscia, serwer
      // wylicza wynik).
      const { values } = computeRecommendedProfile({ plannedSites, cfPercent });
      blockContent = buildBlockFromValues(values);
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

export {
  PROFILES, profileBlock, getStatus, applyPerformanceConfig, readCaddyfile, getSiteCount,
  computeRecommendedProfile, getRecommendedPreview
};
