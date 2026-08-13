import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { listAccounts } from './hostingAccounts.js';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data');
const DATA_PATH = path.join(DATA_DIR, 'hosting-sites.json');
const SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/hosting-user-site.sh');

// Domena wpisywana jako "apex" (bez www.) dla dwoch trybow z przekierowaniem
// (kierunek - ktora wersja jest kanoniczna - to osobne pole redirectMode,
// patrz buildSiteBlock ponizej). Trzeci tryb, 'none' ("Bez przekierowania"),
// to WYJATEK od tej reguly - user podaje JEDNA, kompletna domene (moze byc
// z "www." - to wtedy zwykla, samodzielna etykieta hosta, nie "wersja"
// apeksu), Caddy serwuje TYLKO ja, druga wersja po prostu nie istnieje
// (brak matchera/redir w bloku, patrz buildSiteBlock). Regex sam w sobie
// (dopasowanie etykiet) jest identyczny w obu przypadkach - to
// validateDomain wymusza/luzuje zakaz prefiksu "www." zaleznie od trybu.
// Ta sama regula co w hosting-user-site.sh (musi zostac zsynchronizowana
// recznie - jeden string, dwa jezyki).
const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const REDIRECT_MODES = ['www-to-apex', 'apex-to-www', 'none'];
// 'php' i 'wordpress' sa na razie SZKIELETEM - wybieralne w UI/API, ale
// buildSiteBlock ponizej generuje dla nich dokladnie ten sam statyczny
// blok co dla 'html' (brak jeszcze php_fastcgi/puli PHP-FPM per konto ani
// instalatora WordPressa - to osobna, wieksza praca). 'reverseproxy' NIE
// jest szkieletem - w pelni dziala (patrz buildSiteBlock) - to jeden,
// generyczny szablon zamiast osobnych "Next"/"Ghost"/etc: panel tylko
// robi `reverse_proxy 127.0.0.1:<port>`, wlasny proces (Python/venv,
// Node, cokolwiek) user uruchamia i utrzymuje sam przez SSH.
const TEMPLATES = ['html', 'php', 'wordpress', 'reverseproxy'];
// Dwucyfrowy identyfikator wersji PHP (np. "83") - ten sam format co
// server/runtime-manager/routes/php.js. Tylko zapisywane przy tworzeniu
// (dla PHP/WordPress) - jeszcze NIC z tego nie czyta (buildSiteBlock go
// nie uzywa, patrz wyzej), to tez czesc szkieletu na przyszlosc. Zle
// sformatowana/brakujaca wartosc NIE blokuje tworzenia strony - po prostu
// zapisujemy null, bo pole i tak jeszcze niczego nie steruje.
const PHP_VERSION_RE = /^[0-9]{2}$/;

function validateProxyPort(proxyPort) {
  const port = parseInt(proxyPort, 10);
  if (!Number.isInteger(port) || String(proxyPort).trim() !== String(port) || port < 1 || port > 65535) {
    throw badRequest('Nieprawidlowy port dla reverse proxy (1-65535).');
  }
  return port;
}

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function loadData() {
  try {
    const parsed = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
    return Array.isArray(parsed.sites) ? parsed.sites : [];
  } catch {
    return [];
  }
}

function saveData(sites) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_PATH, JSON.stringify({ sites }, null, 2), { mode: 0o600 });
}

function getAccount(username) {
  return listAccounts().find((a) => a.username === username) || null;
}

function toPublic(record) {
  return {
    id: record.id,
    domain: record.domain,
    redirectMode: record.redirectMode,
    template: record.template,
    phpVersion: record.phpVersion ?? null,
    proxyPort: record.proxyPort ?? null,
    enabled: record.enabled,
    createdAt: record.createdAt
  };
}

async function listOwnSites(username) {
  const account = getAccount(username);
  const all = loadData();
  return {
    maxDomains: account?.maxDomains ?? null,
    items: all.filter((s) => s.accountUsername === username).map(toPublic)
  };
}

// Dla naprawy uprawnien (caddy-ensure-logs.sh) - kto jest wlascicielem
// ktorej domeny, zeby przywrocic chown <username>:caddy na pliku
// /etc/caddy/sites/<domena>.caddy(.disabled), gdyby ktos recznie
// (np. jako root przez SSH) zepsul wlasciciela pliku.
function listSiteOwners() {
  return loadData().map((s) => ({ username: s.accountUsername, domain: s.domain }));
}

// Obie wersje domeny (apex i www) w JEDNYM site-blocku (adres to lista
// hostow rozdzielona przecinkiem) - matcher named (@apex/@www) lapie
// TYLKO niekanoniczna wersje i przekierowuje ja na kanoniczna, reszta
// dyrektyw (root/file_server/log) obsluguje juz oba hosty naraz. Caddy
// nadal automatycznie wystawia certyfikaty ACME dla OBU nazw wypisanych
// w adresie site-blocku, wiec przekierowanie dziala tez po HTTPS bez
// dodatkowej konfiguracji. Tryb 'none' ("Bez przekierowania") NIE dostaje
// tego traktowania - adres to TYLKO to, co user wpisal (moze byc z "www.",
// patrz validateDomain), bez matchera/redir - druga wersja domeny po
// prostu nie ma wlasnego certyfikatu ani site-blocku, wiec nie dziala.
// Log NIE idzie do ~/domains/<domena>/logs - Caddy (caddy:caddy) nie ma
// prawa zapisu do katalogu domowego usera bez dodatkowych sztuczek z
// uprawnieniami grupy. Zamiast tego wspolny, systemowy /var/log/caddy/
// (wlasciciel caddy:caddy - Caddy pisze tam bez przeszkod), jeden plik na
// domene (nazwa domeny jest globalnie unikalna, wiec bez kolizji) - dla
// trybow z przekierowaniem zawsze nazwany po APEKSIE (bez www),
// niezaleznie od kierunku; dla 'none' po prostu po tym, co user wpisal
// (moze wiec byc "www.<domena>.log", jesli tak brzmiala domena).
//
// Jedyna czesc bloku zalezna od template: 'reverseproxy' dostaje
// `reverse_proxy 127.0.0.1:<port>` zamiast `root/file_server` - zawsze
// loopback-only (user NIE podaje calego hosta, tylko port), zeby nie dalo
// sie przypadkiem wskazac na cos poza ta sama maszyna. PHP/WordPress sa
// wciaz szkieletem (patrz TEMPLATES) - dostaja ten sam statyczny blok co
// 'html'.
function buildSiteBlock(homeDir, domain, redirectMode, template, proxyPort) {
  const publicRoot = `${homeDir}/domains/${domain}/public`;
  const logFile = `/var/log/caddy/${domain}.log`;

  const bodyDirectives = template === 'reverseproxy'
    ? `\treverse_proxy 127.0.0.1:${proxyPort}`
    : `\troot * ${publicRoot}\n\tfile_server`;

  if (redirectMode === 'none') {
    return `${domain} {
	header -X-Powered-By
${bodyDirectives}
	log {
		output file ${logFile}
		format json
	}
}
`;
  }

  const wwwDomain = `www.${domain}`;
  const [addresses, matcherName, matchedHost, canonical] = redirectMode === 'apex-to-www'
    ? [`${wwwDomain}, ${domain}`, '@apex', domain, wwwDomain]
    : [`${domain}, ${wwwDomain}`, '@www', wwwDomain, domain];

  return `${addresses} {
	${matcherName} host ${matchedHost}
	redir ${matcherName} https://${canonical}{uri} 301
	header -X-Powered-By
${bodyDirectives}
	log {
		output file ${logFile}
		format json
	}
}
`;
}

function sudoErrorMessage(stderr) {
  if (/password is required/i.test(stderr)) {
    return 'Brak uprawnien sudo bez hasla dla hosting-user-site.sh - sprawdz /etc/sudoers.d/caddy-dashboard';
  }
  return stderr.trim() || null;
}

function runSiteScript(action, username, domain, stdinContent) {
  return new Promise((resolve, reject) => {
    const child = spawn('sudo', ['-n', SCRIPT_PATH, action, username, domain]);
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => reject(Object.assign(new Error(e.message), { status: 500 })));
    child.on('close', (code) => {
      if (code === 0) { resolve(); return; }
      const message = sudoErrorMessage(stderr);
      reject(Object.assign(new Error(message || `exit code ${code}`), { status: message ? 403 : 500 }));
    });
    if (stdinContent !== undefined) child.stdin.write(stdinContent);
    child.stdin.end();
  });
}

// Jak runSiteScript, ale zwraca stdout - dla akcji 'get'/'check', ktore
// (w odroznieniu od apply/enable/disable/delete) maja tresc do oddania
// wywolujacemu, nie tylko sukces/porazke.
function runSiteScriptCapture(action, username, domain, stdinContent) {
  return new Promise((resolve, reject) => {
    const child = spawn('sudo', ['-n', SCRIPT_PATH, action, username, domain]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => reject(Object.assign(new Error(e.message), { status: 500 })));
    child.on('close', (code) => {
      if (code === 0) { resolve(stdout); return; }
      const message = sudoErrorMessage(stderr);
      reject(Object.assign(new Error(message || `exit code ${code}`), { status: message ? 403 : 500 }));
    });
    if (stdinContent !== undefined) child.stdin.write(stdinContent);
    child.stdin.end();
  });
}

// allowWww=true TYLKO dla redirectMode 'none' - tam domena to jedyny,
// samodzielny adres (moze zaczynac sie od "www."), nie "apex" ktorego
// wersja www jest dorzucana automatycznie przez buildSiteBlock.
function validateDomain(domain, allowWww) {
  const value = String(domain || '').trim().toLowerCase();
  if (!allowWww && value.startsWith('www.')) {
    throw badRequest('Podaj domene bez "www." - kierunek przekierowania wybierz osobno.');
  }
  if (!DOMAIN_RE.test(value)) {
    throw badRequest('Nieprawidlowa domena. Podaj domene w formacie np. example.com.');
  }
  return value;
}

function validateRedirectMode(redirectMode) {
  if (!REDIRECT_MODES.includes(redirectMode)) {
    throw badRequest('Nieprawidlowy kierunek przekierowania.');
  }
  return redirectMode;
}

async function createSite(username, { domain, redirectMode, template, phpVersion, proxyPort }) {
  const redirectValue = validateRedirectMode(redirectMode);
  const domainValue = validateDomain(domain, redirectValue === 'none');
  const templateValue = TEMPLATES.includes(template) ? template : 'html';
  const phpVersionValue = (templateValue !== 'html' && PHP_VERSION_RE.test(phpVersion)) ? phpVersion : null;
  // proxyPort jest FUNKCJONALNIE wymagany dla reverseproxy (buildSiteBlock
  // nie ma sensownego fallbacku) - w odroznieniu od phpVersion (na razie
  // czyste metadane) blad walidacji tu faktycznie blokuje utworzenie
  // strony.
  const proxyPortValue = templateValue === 'reverseproxy' ? validateProxyPort(proxyPort) : null;

  const account = getAccount(username);
  if (!account) throw badRequest('Nie znaleziono konta hostingowego.');

  const all = loadData();
  const used = all.filter((s) => s.accountUsername === username).length;
  const maxDomains = account.maxDomains ?? 0;
  if (used >= maxDomains) {
    throw badRequest(`Osiagnieto limit stron z pakietu (${maxDomains}).`);
  }
  if (all.some((s) => s.domain === domainValue)) {
    throw badRequest('Ta domena jest juz zajeta.');
  }

  const content = buildSiteBlock(account.homeDir, domainValue, redirectValue, templateValue, proxyPortValue);
  await runSiteScript('apply', username, domainValue, content);

  const record = {
    id: randomUUID(),
    accountUsername: username,
    domain: domainValue,
    redirectMode: redirectValue,
    template: templateValue,
    phpVersion: phpVersionValue,
    proxyPort: proxyPortValue,
    enabled: true,
    createdAt: new Date().toISOString()
  };
  all.push(record);
  saveData(all);
  return toPublic(record);
}

function findOwnRecord(all, username, id) {
  const record = all.find((s) => s.id === id && s.accountUsername === username);
  if (!record) throw Object.assign(new Error('Nie znaleziono strony.'), { status: 404 });
  return record;
}

async function updateSiteRedirect(username, id, redirectMode) {
  const redirectValue = validateRedirectMode(redirectMode);
  const account = getAccount(username);
  if (!account) throw badRequest('Nie znaleziono konta hostingowego.');

  const all = loadData();
  const record = findOwnRecord(all, username, id);
  // Strona zalozona w trybie 'none' z domena zaczynajaca sie od "www."
  // (dozwolone TYLKO w tym trybie, patrz validateDomain) nie moze przejsc
  // na tryb z przekierowaniem - buildSiteBlock doklejalby wtedy "www."
  // PONOWNIE (www.www.<domena>). Jedyne wyjscie w takim przypadku to
  // usunac strone i zalozyc od nowa z domena apex.
  if (redirectValue !== 'none' && record.domain.startsWith('www.')) {
    throw badRequest('Ta strona ma domene zaczynajaca sie od "www." (tryb "Bez przekierowania") - nie mozna dla niej wlaczyc przekierowania. Usun strone i zaloz ja ponownie z domena bez "www.".');
  }

  const content = buildSiteBlock(account.homeDir, record.domain, redirectValue, record.template, record.proxyPort);
  await runSiteScript('apply', username, record.domain, content);

  record.redirectMode = redirectValue;
  saveData(all);
  return toPublic(record);
}

// Trojka do edytora "caly config" w panelu usera (Strony -> Twoje strony
// -> Edytuj): get zaladowuje aktualna tresc, check ja waliduje BEZ
// zapisu/reloadu (przycisk "Sprawdz"), update faktycznie ja zapisuje
// (przycisk "Aktywuj" - to ta sama akcja `apply`, ktora tworzy/edytuje
// strone, tylko tresc pochodzi od usera, nie z buildSiteBlock). Zmiana
// redirectMode/template w rekordzie NIE jest tu przeliczana z tresci -
// zostaja jak byly (to juz tylko metadane, bez wplywu na wyswietlanie -
// patrz siteRow w panelu).
async function getSiteConfig(username, id) {
  const all = loadData();
  const record = findOwnRecord(all, username, id);
  const content = await runSiteScriptCapture('get', username, record.domain);
  return { content };
}

async function checkSiteConfig(username, id, content) {
  const all = loadData();
  const record = findOwnRecord(all, username, id);
  if (typeof content !== 'string' || !content.trim()) {
    throw badRequest('Pusta tresc konfiguracji.');
  }
  const message = (await runSiteScriptCapture('check', username, record.domain, content)).trim();
  return { ok: true, message };
}

async function updateSiteConfig(username, id, content) {
  const all = loadData();
  const record = findOwnRecord(all, username, id);
  if (typeof content !== 'string' || !content.trim()) {
    throw badRequest('Pusta tresc konfiguracji.');
  }
  await runSiteScript('apply', username, record.domain, content);
  return toPublic(record);
}

async function toggleSite(username, id, enable) {
  const all = loadData();
  const record = findOwnRecord(all, username, id);

  await runSiteScript(enable ? 'enable' : 'disable', username, record.domain);

  record.enabled = enable;
  saveData(all);
  return toPublic(record);
}

async function deleteSite(username, id) {
  const all = loadData();
  const record = findOwnRecord(all, username, id);

  await runSiteScript('delete', username, record.domain);

  saveData(all.filter((s) => s.id !== id));
}

export {
  listOwnSites, createSite, updateSiteRedirect, toggleSite, deleteSite, listSiteOwners,
  getSiteConfig, checkSiteConfig, updateSiteConfig
};
