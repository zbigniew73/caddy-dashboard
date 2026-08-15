import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { listAccounts } from './hostingAccounts.js';
import { addVirtualDomain } from './mailVirtual.js';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data');
const DATA_PATH = path.join(DATA_DIR, 'hosting-sites.json');
const SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/hosting-user-site.sh');
const POOL_SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/hosting-user-php-pool-apply.sh');

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
// 'php' i 'wordpress' MAJA prawdziwy PHP-FPM za soba (dedykowany pool per
// strona, patrz computePhpPoolSizing/buildSiteBlock/createSite nizej) -
// jedyna roznica miedzy nimi to 'wordpress' MOZE dodatkowo dostac
// prawdziwy, gotowy WordPress (patrz WP_INSTALL_MODES nizej) - jesli user
// wybierze "Brak", zachowuje sie identycznie jak 'php' (user wgrywa swoje
// pliki sam przez SSH/SFTP do juz-dzialajacego PHP). 'reverseproxy' to
// jeden, generyczny szablon zamiast osobnych "Next"/"Ghost"/etc: panel
// tylko robi `reverse_proxy 127.0.0.1:<port>`, wlasny proces (Python/venv,
// Node, cokolwiek) user uruchamia i utrzymuje sam przez SSH.
const TEMPLATES = ['html', 'php', 'wordpress', 'reverseproxy'];
// Instalator WordPressa (tylko dla template 'wordpress') - 'none' zachowuje
// sie jak zwykly PHP (index.php/info.php), 'en'/'pl' pobieraja i rozpakowuja
// oficjalne archiwum wordpress.org BEZPOSREDNIO do public/ zamiast pisac
// placeholder (patrz IS_NEW w hosting-user-site.sh). URL kazdej wersji jest
// SZTYWNO zaszyty w tamtym skrypcie (nigdy nie budowany z danych usera) -
// tu tylko wybieramy ktory z dwoch trybow.
const WP_INSTALL_MODES = ['none', 'en', 'pl'];
// Dwucyfrowy identyfikator wersji PHP (np. "83") - ten sam format co
// server/runtime-manager/routes/php.js (i to, co zwraca
// runtimeManagerClient.getInstalledPhp(), skad panel bierze liste
// dostepnych wersji do wyboru - patrz GET /php-versions w userApi.js).
// Zapisywane WYLACZNIE przy tworzeniu strony - nie istnieje przeplyw
// "zmien wersje PHP pozniej" (wymagaloby przebudowy poola od zera, poza
// zakresem na razie).
const PHP_VERSION_RE = /^[0-9]{2}$/;

// Wspolny katalog na sockety PHP-FPM wszystkich stron/kont (musi byc
// IDENTYCZNY z RUN_DIR w hosting-user-php-pool-apply.sh - jeden string,
// dwa jezyki, jak DOMAIN_RE wyzej). Multi-tenant (0755 root:root,
// samo przejscie) - realny dostep do KONKRETNEGO socketu idzie przez
// listen.owner/listen.group/listen.mode per plik poola, nie przez ten
// katalog.
const PHP_POOL_RUN_DIR = '/run/cd-hosting-php';

// Pierwsze 12 hex-owych znakow UUID strony (bez myslnikow) - deterministyczny,
// unikalny per strona identyfikator socketu/poola, zero dodatkowej
// generacji (randomUUID() juz i tak jest jedynym zrodlem id kazdego
// rekordu w tym projekcie). Przyklad: id "d59c0274-..." -> slug
// "d59c0274dcb6".
function sitePhpSlug(siteId) {
  return siteId.replace(/-/g, '').slice(0, 12);
}

function sitePhpSocketPath(siteId, phpVersion) {
  return `${PHP_POOL_RUN_DIR}/php-${sitePhpSlug(siteId)}-v${phpVersion}.sock`;
}

// Rozmiar poola PHP-FPM wyliczany Z LIMITU RAM PAKIETU konta (miekki,
// konfiguracyjny sufit - pm.max_children (liczba rownoleglych procesow
// roboczych) ORAZ php_admin_value[memory_limit] - NIE twardy limit
// cgroup/systemd-slice). Prawdziwy twardy limit per-konto (jak przy
// Redis - Slice=user-<uid>.slice) jest tu NIEOSIAGALNY bez zlamania juz
// istniejacego wzorca: wszystkie poole danej wersji PHP dziela JEDEN,
// wspolny proces systemd (phpXX-php-fpm.service, patrz php-install.sh) -
// przypisanie cgroup/slice dziala na poziomie CALEJ uslugi, nie
// pojedynczego poola, wiec nie da sie przypisac wspoldzielonej uslugi do
// slice'a JEDNEGO konta bez odejscia od modelu "jeden proces per wersja
// PHP" juz uzywanego przez phpMyAdmin/Adminer.
//
// memory_limit W POOLU = dokladnie limit RAM pakietu konta (nie jakas
// arbitralna, mniejsza stala) - user ma to widziec jako "Local Value" w
// phpinfo() (info.php), rozne od "Master Value" (globalny php.ini/php.d,
// ustawiany przez admina - php-set-settings.sh ->
// /etc/opt/remi/phpXX/php.d/99-caddy-dashboard.ini). Wczesniejsza wersja
// tego kodu w ogole NIE ustawiala tej dyrektywy w poolu (celowo, po
// znalezieniu realnego bledu - `php_admin_value` zawsze wygrywa z
// php.ini/php.d, wiec sztywna wartosc estymacji per-worker (64M)
// nadpisywala globalne ustawienie admina) - to nadal prawda dla SAMEJ
// mechaniki nadpisywania, ale user chce, zeby ta nadpisujaca wartosc
// bylabyla SENSOWNA (limit pakietu), nie generyczna stala. Jesli admin
// ustawi Master Value NIZSZY niz limit pakietu konta, PHP i tak uzyje
// mniejszej z obu wartosci (standardowe zachowanie memory_limit) - user
// nigdy nie dostaje WIECEJ niz admin globalnie dopuszcza.
// PHP_WORKER_MB_ESTIMATE ponizej sluzy WYLACZNIE do oszacowania, ile
// procesow roboczych zmiesci sie w budzecie RAM konta przy liczeniu
// pm.max_children - nie ma zwiazku z memory_limit.
const PHP_POOL_RAM_FRACTION = 0.4;
const PHP_WORKER_MB_ESTIMATE = 64;
const PHP_POOL_MAX_CHILDREN_MIN = 2;
const PHP_POOL_MAX_CHILDREN_MAX = 20;

function computePhpPoolSizing(ramLimitMb) {
  const effectiveRamLimitMb = ramLimitMb || 512;
  const budgetMb = Math.round(effectiveRamLimitMb * PHP_POOL_RAM_FRACTION);
  const maxChildren = Math.min(
    PHP_POOL_MAX_CHILDREN_MAX,
    Math.max(PHP_POOL_MAX_CHILDREN_MIN, Math.floor(budgetMb / PHP_WORKER_MB_ESTIMATE))
  );
  return { maxChildren, memoryLimitMb: effectiveRamLimitMb };
}

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
    mailEnabled: Boolean(record.mailEnabled),
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

// Dla funkcji Backup (hostingUserBackup.js) - rzeczywista sciezka
// webroota strony na dysku, ten sam wzorzec co buildSiteBlock() nizej
// (publicRoot). Zwraca null dla 'reverseproxy' - ten szablon proxuje do
// lokalnego portu i NIE MA wlasnego katalogu public/ (patrz
// buildSiteBlock: dostaje `reverse_proxy`, nie `root/file_server`), wiec
// nie ma czego backupowac po sciezce - wywolujacy musi to przefiltrowac.
function getSitePublicPath(username, id) {
  const account = getAccount(username);
  if (!account) throw badRequest('Nie znaleziono konta hostingowego.');
  const record = findOwnRecord(loadData(), username, id);
  if (record.template === 'reverseproxy') return null;
  return `${account.homeDir}/domains/${record.domain}/public`;
}

// Dla naprawy uprawnien (caddy-ensure-logs.sh) - kto jest wlascicielem
// ktorej domeny, zeby przywrocic chown <username>:caddy na pliku
// /etc/caddy/sites/<domena>.caddy(.disabled), gdyby ktos recznie
// (np. jako root przez SSH) zepsul wlasciciela pliku.
function listSiteOwners() {
  return loadData().map((s) => ({ username: s.accountUsername, domain: s.domain }));
}

// Dla sprawdzania "wolnego portu" w zakladce Python (hostingUserPython.js)
// - porty juz PRZYPISANE do jakiejkolwiek strony reverseproxy, DOWOLNEGO
// konta - to jedyny rejestr portow w tym projekcie (jeden port na
// strone, patrz validateProxyPort/buildSiteBlock wyzej), wiec ta funkcja
// jest jedynym miejscem, ktore musi go czytac dla innych funkcji.
function listUsedProxyPorts() {
  return loadData()
    .filter((s) => s.template === 'reverseproxy' && Number.isInteger(s.proxyPort))
    .map((s) => s.proxyPort);
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
// Czesc bloku zalezna od template: 'reverseproxy' dostaje
// `reverse_proxy 127.0.0.1:<port>` zamiast `root/file_server` - zawsze
// loopback-only (user NIE podaje calego hosta, tylko port), zeby nie dalo
// sie przypadkiem wskazac na cos poza ta sama maszyna. 'php'/'wordpress'
// dostaja `php_fastcgi unix/<socket>` MIEDZY `root` a `file_server` -
// standardowa receptura Caddy (php_fastcgi samo dopasowuje *.php/index),
// `file_server` ponizej wciaz obsluguje statyczne pliki (CSS/JS/obrazki)
// bezposrednio, bez przechodzenia przez PHP. `phpSocketPath` musi byc
// podany (non-null) dla tych dwoch szablonow - wywolujacy (createSite)
// zaklada pool PRZED wywolaniem tej funkcji, zeby socket juz istnial, gdy
// Caddy dostanie ten config.
// Stub "mail.<domena>" - ZAWSZE ten sam plaski `respond`, niezaleznie od
// template/wpInstall (HTML/PHP/WORDPRESS - w tym KAZDA wersja instalatora
// WordPressa - none/en/pl - i REVERSE PROXY generuja go identycznie, bo
// dotyczy WYLACZNIE osobnej domeny "mail.", nie tej ktora serwuje strone).
// Cel NIE jest kosmetyczny: to osobny blok Caddy w TYM SAMYM pliku
// per-site, wiec Caddy sam wystawia dla niego certyfikat Let's Encrypt
// (ten sam mechanizm, ktory mail-tls-swap.sh pozniej kopiuje do
// Postfixa/Dovecota - patrz komentarz przy LE_CERT_PATH w mail.js) -
// bez tego bloku Caddy nigdy by nie wiedzial, ze "mail.<domena>" ma byc
// obslugiwana i nie zadalby dla niej certyfikatu.
function buildMailStubBlock(domain) {
  return `mail.${domain} {
	respond "Serwer pocztowy - ten adres nie serwuje strony WWW." 200
}
`;
}

function buildSiteBlock(homeDir, domain, redirectMode, template, proxyPort, phpSocketPath, mailEnabled) {
  const publicRoot = `${homeDir}/domains/${domain}/public`;
  const logFile = `/var/log/caddy/${domain}.log`;

  const bodyDirectives = template === 'reverseproxy'
    ? `\treverse_proxy 127.0.0.1:${proxyPort}`
    : (template === 'php' || template === 'wordpress')
      ? `\troot * ${publicRoot}\n\tphp_fastcgi unix/${phpSocketPath}\n\tfile_server`
      : `\troot * ${publicRoot}\n\tfile_server`;

  const mailBlock = mailEnabled ? `\n${buildMailStubBlock(domain)}` : '';

  if (redirectMode === 'none') {
    return `${domain} {
	header -X-Powered-By
${bodyDirectives}
	log {
		output file ${logFile}
		format json
	}
}
${mailBlock}`;
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
${mailBlock}`;
}

function sudoErrorMessage(stderr) {
  if (/password is required/i.test(stderr)) {
    return 'Brak uprawnien sudo bez hasla dla hosting-user-site.sh - sprawdz /etc/sudoers.d/caddy-dashboard';
  }
  return stderr.trim() || null;
}

// `template`/`wpInstall` ida na argv TYLKO dla akcji 'apply' (jedyna,
// ktora je czyta - IS_NEW placeholder w hosting-user-site.sh) - inne akcje
// (check/get/enable/disable/delete) maja niezmieniony, 2-argumentowy
// ksztalt, zgodny z sudoers.
function runSiteScript(action, username, domain, stdinContent, template, wpInstall) {
  return new Promise((resolve, reject) => {
    const args = action === 'apply'
      ? [SCRIPT_PATH, action, username, domain, template || 'html', wpInstall || 'none']
      : [SCRIPT_PATH, action, username, domain];
    const child = spawn('sudo', ['-n', ...args]);
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

// hosting-user-php-pool-apply.sh - zaklada/usuwa/przeladowuje dedykowany
// pool PHP-FPM jednej strony (patrz komentarz przy PHP_POOL_RAM_FRACTION
// wyzej). Zero stdin - wszystkie wartosci (w tym rozmiar poola) sa juz
// policzone przez wywolujacego i ida na argv, nic tu nie jest sekretem.
function runPoolScript(action, ...args) {
  return new Promise((resolve, reject) => {
    const child = spawn('sudo', ['-n', POOL_SCRIPT_PATH, action, ...args.map(String)]);
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

async function createSite(username, { domain, redirectMode, template, phpVersion, proxyPort, wpInstall, mailEnabled }) {
  const redirectValue = validateRedirectMode(redirectMode);
  const domainValue = validateDomain(domain, redirectValue === 'none');
  const templateValue = TEMPLATES.includes(template) ? template : 'html';
  const phpVersionValue = (templateValue !== 'html' && PHP_VERSION_RE.test(phpVersion)) ? phpVersion : null;
  // wpInstall ma sens WYLACZNIE dla template 'wordpress' - dla kazdego
  // innego szablonu wymuszamy 'none', niezaleznie co przyszlo z klienta.
  const wpInstallValue = templateValue === 'wordpress' && WP_INSTALL_MODES.includes(wpInstall) ? wpInstall : 'none';
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

  // id musi istniec PRZED buildSiteBlock - dla php/wordpress jest
  // podstawa slugu socketu (sitePhpSlug), a pool (i socket) musi zostac
  // zalozony ZANIM Caddy dostanie config, ktory sie do niego odwoluje.
  const id = randomUUID();
  let phpSocketPath = null;
  if ((templateValue === 'php' || templateValue === 'wordpress') && phpVersionValue) {
    const { maxChildren, memoryLimitMb } = computePhpPoolSizing(account.ramLimitMb);
    const slug = sitePhpSlug(id);
    await runPoolScript('apply', username, domainValue, phpVersionValue, slug, maxChildren, memoryLimitMb);
    phpSocketPath = sitePhpSocketPath(id, phpVersionValue);
  }

  const content = buildSiteBlock(account.homeDir, domainValue, redirectValue, templateValue, proxyPortValue, phpSocketPath, !!mailEnabled);
  await runSiteScript('apply', username, domainValue, content, templateValue, wpInstallValue);

  const record = {
    id,
    accountUsername: username,
    domain: domainValue,
    redirectMode: redirectValue,
    template: templateValue,
    phpVersion: phpVersionValue,
    proxyPort: proxyPortValue,
    mailEnabled: false,
    enabled: true,
    createdAt: new Date().toISOString()
  };
  all.push(record);
  saveData(all);

  // "Obsluga poczty" = zarejestrowanie tej domeny jako wirtualnej domeny
  // pocztowej (mailVirtual.js, NIEZALEZNej od systemowego konta/SSH -
  // patrz [[project_caddy_dashboard_virtual_mail_plan]]) - najlepszy
  // wysilek, NIE blokuje utworzenia samej strony. Typowe powody
  // niepowodzenia (Poczta nigdy nie zainstalowana/zainicjalizowana przez
  // admina, albo domena jest juz domena panelu) trafiaja do
  // odpowiedzi jako mailWarning, zeby user wiedzial co zrobic dalej -
  // strona i tak juz istnieje, wiec nie ma sensu cofac calej operacji.
  let mailWarning = null;
  if (mailEnabled) {
    try {
      await addVirtualDomain(domainValue, username);
      record.mailEnabled = true;
      saveData(all);
    } catch (e) {
      mailWarning = e.message;
      // Rejestracja sie nie powiodla - zdejmujemy stub "mail.<domena>" z
      // powrotem z configu Caddy, zeby PLIK i record.mailEnabled (false)
      // byly spojne. Jesli TA proba tez zawiedzie (rzadkie), stub zostaje
      // w configu jako nieszkodliwy, samotny "respond 200" - naprawi sie
      // sam przy najblizszej edycji przekierowania (updateSiteRedirect
      // zawsze generuje config na nowo z record.mailEnabled).
      try {
        const rollbackContent = buildSiteBlock(account.homeDir, domainValue, redirectValue, templateValue, proxyPortValue, phpSocketPath, false);
        await runSiteScript('apply', username, domainValue, rollbackContent, templateValue, wpInstallValue);
      } catch {
        // best effort, patrz komentarz wyzej
      }
    }
  }

  return { ...toPublic(record), mailWarning };
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

  const phpSocketPath = (record.template === 'php' || record.template === 'wordpress') && record.phpVersion
    ? sitePhpSocketPath(record.id, record.phpVersion)
    : null;
  const content = buildSiteBlock(account.homeDir, record.domain, redirectValue, record.template, record.proxyPort, phpSocketPath, record.mailEnabled);
  await runSiteScript('apply', username, record.domain, content, record.template, 'none');

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
  await runSiteScript('apply', username, record.domain, content, record.template, 'none');
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

  // Kolejnosc odwrotna do createSite: Caddy MUSI przestac kierowac na
  // pool ZANIM ten pool zniknie (patrz komentarz przy buildSiteBlock).
  await runSiteScript('delete', username, record.domain);

  if ((record.template === 'php' || record.template === 'wordpress') && record.phpVersion) {
    await runPoolScript('remove', username, record.phpVersion, sitePhpSlug(record.id));
  }

  saveData(all.filter((s) => s.id !== id));
}

// Przycisk "Restart PHP" w panelu klienta (tylko strony php/wordpress).
// UCZCIWIE: to `systemctl reload phpXX-php-fpm` (patrz runPoolScript
// 'reload' -> hosting-user-php-pool-apply.sh) - miekki, bezprzestojowy
// restart procesow roboczych CALEJ wspoldzielonej uslugi tej wersji PHP
// (patrz komentarz przy PHP_POOL_RAM_FRACTION), NIE izolowany restart
// tylko tej jednej strony (stock PHP-FPM nie ma takiego sygnalu per
// pool) - UI musi to jasno komunikowac, nie sugerowac izolacji.
async function restartSitePhp(username, id) {
  const all = loadData();
  const record = findOwnRecord(all, username, id);
  if (record.template !== 'php' && record.template !== 'wordpress') {
    throw badRequest('Ta strona nie uzywa PHP.');
  }
  if (!record.phpVersion) throw badRequest('Ta strona nie ma przypisanej wersji PHP.');

  await runPoolScript('reload', username, record.phpVersion);
  return { success: true };
}

export {
  listOwnSites, createSite, updateSiteRedirect, toggleSite, deleteSite, listSiteOwners, restartSitePhp,
  getSiteConfig, checkSiteConfig, updateSiteConfig, getSitePublicPath, listUsedProxyPorts
};
