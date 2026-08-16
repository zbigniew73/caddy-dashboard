const API = '/api/user';

async function api(method, url, body) {
  const res = await fetch(API + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include'
  });
  if (res.status === 401) {
    window.location.href = '/';
    throw new Error('unauthorized');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function authApi(method, url, body) {
  const res = await fetch('/api/auth' + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include'
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// Rekordy DNS (SPF/DMARC/DKIM) sa dlugie i lamia sie wizualnie
// (word-break:break-all) - reczne zaznaczanie myszka (triple-click) latwo
// lapie fragment sasiedniego elementu albo pomija znak na zlamaniu linii,
// user zglosil realny problem z kopiowaniem wartosci DKIM 2026-08-16.
// Kazdy rekord (SPF/DMARC/DKIM) ma teraz WLASNY, opisany przyciskiem
// ("Kopiuj SPF"/"Kopiuj DMARC"/"Kopiuj DKIM") element .copy-value-btn,
// poprzedzony ukrytym elementem trzymajacym dokladnie ten tekst, ktory ma
// zostac skopiowany (span.copy-src dla SPF/DMARC, span.dkim-raw-value dla
// DKIM - ten ostatni w surowym formacie BIND z cudzyslowami, patrz
// dkim-install.sh) - przycisk czyta textContent poprzedniego elementu,
// zero ryzyka rozjazdu miedzy tym co ma zostac skopiowane a tym co
// faktycznie trafia do schowka.
function wireCopyButtons(container) {
  container.querySelectorAll('.copy-value-btn').forEach((btn) => {
    if (btn.dataset.copyWired) return;
    btn.dataset.copyWired = '1';
    btn.onclick = () => {
      const span = btn.previousElementSibling;
      if (!span) return;
      navigator.clipboard.writeText(span.textContent).then(() => {
        const original = btn.textContent;
        btn.textContent = '✓ ' + t('mail.copy_value_done');
        setTimeout(() => { btn.textContent = original; }, 1200);
      }).catch(() => {});
    };
  });
}

const THEME_ORDER = ['light', 'dark', 'system'];
const THEME_ICONS = {
  light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  system: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>'
};

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('cd-theme', theme);
  renderThemeSwitches();
}

function renderThemeSwitches() {
  const current = localStorage.getItem('cd-theme') || 'system';
  document.querySelectorAll('.theme-switch').forEach((container) => {
    container.innerHTML = THEME_ORDER.map(
      (theme) => `<button type="button" class="${theme === current ? 'active' : ''}" data-theme-choice="${theme}" title="${t('theme.' + theme)}" aria-label="${t('theme.' + theme)}">${THEME_ICONS[theme]}</button>`
    ).join('');
    container.querySelectorAll('button').forEach((btn) => {
      btn.onclick = () => applyTheme(btn.dataset.themeChoice);
    });
  });
}

function onLanguageChange() {
  renderThemeSwitches();
  if (CURRENT_ACCOUNT) renderTab();
}

let CURRENT_ACCOUNT = null;
let MUST_CHANGE_PASSWORD = false;
let currentTab = 'dashboard';

function severity(percent) {
  if (percent >= 90) return 'critical';
  if (percent >= 70) return 'warning';
  return 'good';
}

// Kafelek "wykorzystano / limit z pakietu" - szkielet na teraz (patrz
// server/services/hostingUserSelf.js: CPU/RAM to realny odczyt z `ps`,
// Strony to realne liczenie plikow *.caddy, Bazy danych to na razie
// zawsze 0/limit, bo nie ma jeszcze mechanizmu przypisywania baz do
// konta - dokladniejsze metryki dojda pozniej).
function usageTileContent(label, used, limit, unit) {
  const hasLimit = typeof limit === 'number' && limit > 0;
  const percent = hasLimit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const valueText = hasLimit ? `${used}${unit} / ${limit}${unit}` : `${used}${unit}`;
  return `
    <div class="stat-label">${escapeHtml(label)}</div>
    <div class="stat-value">${valueText}</div>
    <div class="meter-track"><div class="meter-fill ${severity(percent)}" style="width:${percent}%"></div></div>
  `;
}

function usageTile(label, used, limit, unit, id) {
  return `<div class="stat-tile"${id ? ` id="${id}"` : ''}>${usageTileContent(label, used, limit, unit)}</div>`;
}

// Kafelek CPU ma dodatkowa linie z nazwa procesora serwera - patrz
// cpuModel w hostingUserSelf.js. Ta linia sie nie zmienia miedzy
// odswieżeniami, ale i tak przychodzi w kazdej odpowiedzi /me (tani
// odczyt, bez sudo), wiec prosciej jest zawsze ja renderowac tu, zamiast
// osobno cache'owac.
function cpuTileContent(used, limit, model) {
  const detailHtml = model
    ? `<div style="font-size:11px;color:var(--muted);margin:-4px 0 6px;">${escapeHtml(model)}</div>`
    : '';
  const hasLimit = typeof limit === 'number' && limit > 0;
  const percent = hasLimit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const valueText = hasLimit ? `${used}% / ${limit}%` : `${used}%`;
  return `
    <div class="stat-label">${escapeHtml(t('dashboard.tile_cpu'))}</div>
    <div class="stat-value">${valueText}</div>
    ${detailHtml}
    <div class="meter-track"><div class="meter-fill ${severity(percent)}" style="width:${percent}%"></div></div>
  `;
}

function cpuTile(used, limit, model, id) {
  return `<div class="stat-tile"${id ? ` id="${id}"` : ''}>${cpuTileContent(used, limit, model)}</div>`;
}

// Kafelek bez paska postepu - dla wartosci, ktore nie sa "wykorzystano /
// limit" (np. Uptime serwera).
function plainTileContent(label, value) {
  return `
    <div class="stat-label">${escapeHtml(label)}</div>
    <div class="stat-value">${escapeHtml(value)}</div>
  `;
}

function plainTile(label, value, id) {
  return `<div class="stat-tile"${id ? ` id="${id}"` : ''}>${plainTileContent(label, value)}</div>`;
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

// CPU/RAM/Uptime sie zmieniaja z sekundy na sekunde (biezace zuzycie
// procesow / czas dzialania serwera) - odswiezane co 5s, bez dodatkowego
// kosztu (Uptime przychodzi w tej samej odpowiedzi /me co CPU/RAM).
// Strony/Bazy danych/Dysk zmieniaja sie rzadko (trzeba recznie dodac
// domene/baze/pliki), a odczyt Dysku (`du -sm` na katalogu domowym) jest
// realnie kosztowny na kontach z duzo danymi - wiec te trzy sa
// odswiezane co 60s (co 12. tick tego samego timera - jeden fetch /me na
// tick, bez dublowania zapytan). Wszystko w miejscu (bez przeladowania
// calej zakladki), dopoki user jest na dashboardzie.
const USAGE_REFRESH_MS = 5000;
const SITES_DB_REFRESH_EVERY_N_TICKS = 12; // 12 * 5s = 60s
let usageRefreshTimer = null;
let usageRefreshTickCount = 0;

function startUsageRefresh() {
  stopUsageRefresh();
  usageRefreshTickCount = 0;
  usageRefreshTimer = setInterval(async () => {
    if (currentTab !== 'dashboard' || MUST_CHANGE_PASSWORD) return;
    try {
      const me = await api('GET', '/me');
      CURRENT_ACCOUNT = me;
      const uptimeTile = document.getElementById('tile-uptime');
      const cpuTileEl = document.getElementById('tile-cpu');
      const ramTile = document.getElementById('tile-ram');
      if (uptimeTile) uptimeTile.innerHTML = plainTileContent(t('dashboard.tile_uptime'), formatUptime(me.serverUptimeSeconds ?? 0));
      if (cpuTileEl) cpuTileEl.innerHTML = cpuTileContent(me.cpuUsedPercent ?? 0, me.cpuPercentLimit, me.cpuModel);
      if (ramTile) ramTile.innerHTML = usageTileContent(t('dashboard.tile_ram'), me.ramUsedMb ?? 0, me.ramLimitMb, ' MB');

      usageRefreshTickCount += 1;
      if (usageRefreshTickCount % SITES_DB_REFRESH_EVERY_N_TICKS === 0) {
        const diskTile = document.getElementById('tile-disk');
        const sitesTile = document.getElementById('tile-sites');
        const dbTile = document.getElementById('tile-databases');
        if (diskTile) diskTile.innerHTML = usageTileContent(t('dashboard.tile_disk'), me.diskUsedMb ?? 0, me.diskQuotaMb, ' MB');
        if (sitesTile) sitesTile.innerHTML = usageTileContent(t('dashboard.tile_sites'), me.sitesUsed ?? 0, me.maxDomains, '');
        if (dbTile) dbTile.innerHTML = usageTileContent(t('dashboard.tile_databases'), me.databasesUsed ?? 0, me.maxDatabases, '');
      }
    } catch {
      // ciche niepowodzenie odswiezenia - kolejna proba za 5s
    }
  }, USAGE_REFRESH_MS);
}

function stopUsageRefresh() {
  if (usageRefreshTimer) {
    clearInterval(usageRefreshTimer);
    usageRefreshTimer = null;
  }
}

function renderDashboard(content) {
  const a = CURRENT_ACCOUNT;
  content.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(6, minmax(0, 1fr));gap:16px;">
      ${plainTile(t('dashboard.tile_uptime'), formatUptime(a.serverUptimeSeconds ?? 0), 'tile-uptime')}
      ${cpuTile(a.cpuUsedPercent ?? 0, a.cpuPercentLimit, a.cpuModel, 'tile-cpu')}
      ${usageTile(t('dashboard.tile_ram'), a.ramUsedMb ?? 0, a.ramLimitMb, ' MB', 'tile-ram')}
      ${usageTile(t('dashboard.tile_disk'), a.diskUsedMb ?? 0, a.diskQuotaMb, ' MB', 'tile-disk')}
      ${usageTile(t('dashboard.tile_sites'), a.sitesUsed ?? 0, a.maxDomains, '', 'tile-sites')}
      ${usageTile(t('dashboard.tile_databases'), a.databasesUsed ?? 0, a.maxDatabases, '', 'tile-databases')}
    </div>
    <div style="display:grid;grid-template-columns:minmax(0, 1fr) minmax(0, 1fr);gap:16px;margin-top:16px;width:100%;">
      <div class="system-info-card" style="max-width:none;width:100%;box-sizing:border-box;">
        <h3 style="margin:0 0 4px;font-size:15px;">${t('dashboard.welcome_title', { user: escapeHtml(a.username) })}</h3>
        <p style="margin:0 0 16px;color:var(--muted);font-size:13px;">${t('dashboard.welcome_description')}</p>
        <div class="info-grid">
          <div class="info-label">${t('dashboard.field_username')}</div><div class="info-value">${escapeHtml(a.username)}</div>
          <div class="info-label">${t('dashboard.field_fullname')}</div><div class="info-value">${escapeHtml(a.fullName || '-')}</div>
          <div class="info-label">${t('dashboard.field_email')}</div><div class="info-value">${escapeHtml(a.email || '-')}</div>
          <div class="info-label">${t('dashboard.field_homedir')}</div><div class="info-value">${escapeHtml(a.homeDir || '-')}</div>
          <div class="info-label">${t('dashboard.field_package')}</div><div class="info-value">${escapeHtml(a.packageName || '-')}</div>
          <div class="info-label">${t('dashboard.field_quota')}</div><div class="info-value">${a.diskQuotaMb ? `${a.diskQuotaMb} MB` : '-'}</div>
        </div>
      </div>
      <div class="system-info-card" style="max-width:none;width:100%;box-sizing:border-box;">
        <h3 style="margin:0;font-size:15px;">${t('dashboard.info_title')}</h3>
      </div>
    </div>
  `;
}

// Szkielet zakladek "na razie tylko szkielet" - jeden rzad, dwa rowne
// klocki (ten sam wzorzec co Witaj+Info na Dashboardzie), bez tresci - do
// wypelnienia w kolejnych krokach. Pusty teraz (Backup, Python i Node
// dostaly realna funkcjonalnosc) - mechanizm zostaje na przyszlosc.
const PLACEHOLDER_TABS = {};

function renderPlaceholderTab(content, titleKey) {
  content.innerHTML = `
    <div style="display:grid;grid-template-columns:minmax(0, 1fr) minmax(0, 1fr);gap:16px;width:100%;">
      <div class="system-info-card" style="max-width:none;width:100%;box-sizing:border-box;">
        <h3 style="margin:0;font-size:15px;">${t(titleKey)}</h3>
      </div>
      <div class="system-info-card" style="max-width:none;width:100%;box-sizing:border-box;">
        <h3 style="margin:0;font-size:15px;">${t('dashboard.info_title')}</h3>
      </div>
    </div>
  `;
}

function generatePassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#$%^&*-_=+';
  const all = upper + lower + digits + special;
  const pick = (set) => set[Math.floor(Math.random() * set.length)];
  let pwd = pick(upper) + pick(lower) + pick(digits) + pick(special);
  for (let i = pwd.length; i < 16; i++) pwd += pick(all);
  return pwd.split('').sort(() => Math.random() - 0.5).join('');
}

function renderSettings(content) {
  content.innerHTML = `
    <div style="display:grid;grid-template-columns:minmax(0, 1fr) minmax(0, 1fr);gap:16px;width:100%;">
      <div class="system-info-card" style="max-width:none;width:100%;box-sizing:border-box;">
        <h3 style="margin:0 0 4px;font-size:15px;">${t('settings.password_title')}</h3>
        <p style="margin:0 0 16px;color:var(--muted);font-size:13px;">${MUST_CHANGE_PASSWORD ? t('settings.password_forced_hint') : t('settings.password_description')}</p>
        <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('settings.field_current')}</label>
        <input type="password" id="pwd-current" autocomplete="current-password" style="margin-bottom:10px;">
        <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('settings.field_new')}</label>
        <div style="display:flex;gap:8px;margin-bottom:4px;">
          <input type="password" id="pwd-new" autocomplete="new-password" style="flex:1;">
          <button type="button" class="secondary" id="pwd-generate-btn">${t('settings.generate_button')}</button>
        </div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">${t('settings.password_hint')}</div>
        <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('settings.field_confirm')}</label>
        <input type="password" id="pwd-confirm" autocomplete="new-password" style="margin-bottom:14px;">
        <button type="button" id="pwd-save-btn">${t('settings.save_button')}</button>
        <div class="action-msg" id="pwd-msg"></div>
      </div>
      <div class="system-info-card" style="max-width:none;width:100%;box-sizing:border-box;">
        <h3 style="margin:0;font-size:15px;">${t('dashboard.info_title')}</h3>
      </div>
    </div>
  `;

  document.getElementById('pwd-generate-btn').onclick = () => {
    const generated = generatePassword();
    document.getElementById('pwd-new').value = generated;
    document.getElementById('pwd-confirm').value = generated;
  };

  document.getElementById('pwd-save-btn').onclick = async () => {
    const currentPassword = document.getElementById('pwd-current').value;
    const newPassword = document.getElementById('pwd-new').value;
    const confirmPassword = document.getElementById('pwd-confirm').value;
    const msgEl = document.getElementById('pwd-msg');
    if (newPassword !== confirmPassword) {
      msgEl.textContent = t('settings.error_mismatch');
      msgEl.className = 'action-msg error';
      return;
    }
    const btn = document.getElementById('pwd-save-btn');
    btn.disabled = true;
    msgEl.textContent = t('settings.saving');
    msgEl.className = 'action-msg';
    try {
      await api('POST', '/change-password', { currentPassword, newPassword });
      MUST_CHANGE_PASSWORD = false;
      document.querySelectorAll('nav button.tab').forEach((b) => { b.disabled = false; });
      msgEl.textContent = t('settings.success');
      msgEl.className = 'action-msg success';
      document.getElementById('pwd-current').value = '';
      document.getElementById('pwd-new').value = '';
      document.getElementById('pwd-confirm').value = '';
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
    } finally {
      btn.disabled = false;
    }
  };
}

// Cron - CRUD na prawdziwym crontabie konta (server/services/hostingUserCron.js).
// Kazde zadanie to 2 linie w crontabie (komentarz-znacznik + linia
// harmonogram+polecenie) - zobacz komentarz w hostingUserCron.js. Karta
// formularza + tabela zadan, pelna szerokosc (nie wzorzec 2-kolumnowy -
// za duzo tresci na polowe szerokosci, ten sam wybor co tabela FIREWALL
// w panelu admina).
const CRON_PRESETS = [
  ['every5', '*/5 * * * *'],
  ['hourly', '0 * * * *'],
  ['daily', '0 0 * * *'],
  ['weekly', '0 0 * * 0'],
  ['monthly', '0 0 1 * *'],
  ['daily3am', '0 3 * * *']
];

// Gotowe szablony calych zadan (nazwa+harmonogram+polecenie na raz).
// WordPress/Laravel potrzebuja danych specyficznych dla konkretnej strony
// (domena / katalog aplikacji) - te pola maja "placeholder" (fragment
// polecenia zaznaczany po wstawieniu szablonu, do od razu nadpisania).
// Czyszczenie logow/plikow tymczasowych jest w pelni uniwersalne (dziala
// na WLASNYM katalogu domowym / plikach usera) - gotowe do uzycia bez
// edycji, wiec "placeholder" jest tam null.
function buildCronTemplates(phpPaths) {
  const phpPath = phpPaths[0] || '/usr/local/bin/php85';
  const homeDir = CURRENT_ACCOUNT?.homeDir || '/home/user';
  const username = CURRENT_ACCOUNT?.username || 'user';
  return {
    wordpress: {
      label: t('cron.template_wordpress'),
      name: 'WordPress Cron',
      schedule: '*/2 * * * *',
      command: `wget -q -T 60 -O /dev/null "https://example.pl/wp-cron.php?doing_wp_cron"`,
      placeholder: 'example.pl'
    },
    laravel: {
      label: t('cron.template_laravel'),
      name: t('cron.template_laravel_name'),
      schedule: '* * * * *',
      command: `${phpPath} ${homeDir}/example-app/artisan schedule:run >> /dev/null 2>&1`,
      placeholder: 'example-app'
    },
    cleanup_logs: {
      label: t('cron.template_cleanup_logs'),
      name: t('cron.template_cleanup_logs_name'),
      schedule: '0 3 * * *',
      command: `find ${homeDir} -maxdepth 4 -type f -name "*.log" -mtime +14 -delete`,
      placeholder: null
    },
    cleanup_tmp: {
      label: t('cron.template_cleanup_tmp'),
      name: t('cron.template_cleanup_tmp_name'),
      schedule: '0 4 * * *',
      command: `find /tmp -maxdepth 1 -user ${username} -type f -mtime +1 -delete`,
      placeholder: null
    },
    cleanup_home_tmp: {
      label: t('cron.template_cleanup_home_tmp'),
      name: t('cron.template_cleanup_home_tmp_name'),
      schedule: '0 4 * * *',
      command: `[ -d "${homeDir}/tmp" ] && find "${homeDir}/tmp" -maxdepth 1 -type f -mtime +1 -delete`,
      placeholder: null
    }
  };
}

let cronPhpPathsCache = null;
let cronEditingId = null;

function cronJobRow(job) {
  return `
    <tr>
      <td>${escapeHtml(job.name || '-')}</td>
      <td>${escapeHtml(job.schedule)}</td>
      <td style="white-space:normal;word-break:break-all;">${escapeHtml(job.command)}</td>
      <td><span class="status-badge ${job.enabled ? 'active' : 'inactive'}">${job.enabled ? t('cron.status_active') : t('cron.status_inactive')}</span></td>
      <td style="white-space:normal;">
        <button type="button" class="secondary" data-cron-edit="${job.id}">${t('cron.edit')}</button>
        <button type="button" class="secondary" data-cron-toggle="${job.id}" data-cron-enabled="${job.enabled}">${job.enabled ? t('cron.disable') : t('cron.enable')}</button>
        <button type="button" class="danger" data-cron-delete="${job.id}">${t('cron.delete')}</button>
      </td>
    </tr>
  `;
}

function cronFormHtml(phpPaths, editingJob) {
  const presetsHtml = CRON_PRESETS.map(([key, value]) =>
    `<button type="button" class="secondary" data-cron-preset="${escapeHtml(value)}">${t('cron.preset_' + key)}</button>`
  ).join('');
  const phpPathsHtml = phpPaths.length
    ? phpPaths.map((p) => `<button type="button" class="secondary" data-cron-php-path="${escapeHtml(p)}">${escapeHtml(p)}</button>`).join('')
    : `<span style="font-size:12px;color:var(--muted);">${t('cron.php_paths_none')}</span>`;
  const commandPlaceholder = `${phpPaths[0] || '/usr/local/bin/php85'} ${CURRENT_ACCOUNT?.homeDir || '/home/user'}/cron.php`;
  const templatesHtml = Object.entries(buildCronTemplates(phpPaths))
    .map(([key, tpl]) => `<button type="button" class="secondary" data-cron-template="${key}">${escapeHtml(tpl.label)}</button>`)
    .join('');

  return `
    <h3 style="margin:0 0 4px;font-size:15px;">${editingJob ? t('cron.edit_title') : t('cron.add_title')}</h3>
    <p style="margin:0 0 16px;color:var(--muted);font-size:13px;">${t('cron.add_description')}</p>

    <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('cron.field_templates')}</label>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;">${templatesHtml}</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:14px;">${t('cron.template_hint')}</div>

    <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('cron.field_name')}</label>
    <input type="text" id="cron-name" maxlength="100" placeholder="${t('cron.name_placeholder')}" value="${escapeHtml(editingJob?.name || '')}" style="margin-bottom:10px;">

    <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('cron.field_schedule')}</label>
    <input type="text" id="cron-schedule" placeholder="*/5 * * * *" value="${escapeHtml(editingJob?.schedule || '')}" style="font-family:var(--mono);margin-bottom:6px;">
    <div style="font-size:12px;color:var(--muted);margin-bottom:6px;">${t('cron.schedule_hint')}</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;">${presetsHtml}</div>

    <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('cron.field_command')}</label>
    <input type="text" id="cron-command" placeholder="${escapeHtml(commandPlaceholder)}" value="${escapeHtml(editingJob?.command || '')}" style="font-family:var(--mono);margin-bottom:6px;">
    <div style="font-size:12px;color:var(--muted);margin-bottom:6px;">${t('cron.command_hint')}</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;">${phpPathsHtml}</div>

    <button type="button" id="cron-submit-btn">${editingJob ? t('cron.save_button') : t('cron.add_button')}</button>
    ${editingJob ? `<button type="button" class="secondary" id="cron-cancel-btn">${t('cron.cancel_button')}</button>` : ''}
    <div class="action-msg" id="cron-msg"></div>
  `;
}

function renderCronSection(jobs, phpPaths) {
  const editingJob = cronEditingId ? jobs.find((j) => j.id === cronEditingId) : null;
  const rows = jobs.length
    ? jobs.map(cronJobRow).join('')
    : `<tr><td colspan="5" style="text-align:center;color:var(--muted);">${t('cron.empty')}</td></tr>`;

  return `
    <div class="system-info-card" style="max-width:none;width:100%;box-sizing:border-box;margin-bottom:16px;">
      ${cronFormHtml(phpPaths, editingJob)}
    </div>
    <div class="system-info-card" style="max-width:none;width:100%;box-sizing:border-box;">
      <h3 style="margin:0 0 12px;font-size:15px;">${t('cron.jobs_title')}</h3>
      <div style="overflow-x:auto;">
        <table class="firewall-table">
          <thead>
            <tr>
              <th>${t('cron.col_name')}</th>
              <th>${t('cron.col_schedule')}</th>
              <th>${t('cron.col_command')}</th>
              <th>${t('cron.col_status')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

function wireCronSection(content, phpPaths) {
  content.querySelectorAll('[data-cron-preset]').forEach((btn) => {
    btn.onclick = () => { document.getElementById('cron-schedule').value = btn.dataset.cronPreset; };
  });

  const cronTemplates = buildCronTemplates(phpPaths);
  content.querySelectorAll('[data-cron-template]').forEach((btn) => {
    btn.onclick = () => {
      const template = cronTemplates[btn.dataset.cronTemplate];
      if (!template) return;
      document.getElementById('cron-name').value = template.name;
      document.getElementById('cron-schedule').value = template.schedule;
      const cmdInput = document.getElementById('cron-command');
      cmdInput.value = template.command;
      cmdInput.focus();
      if (template.placeholder) {
        const start = template.command.indexOf(template.placeholder);
        if (start >= 0) cmdInput.setSelectionRange(start, start + template.placeholder.length);
      } else {
        cmdInput.setSelectionRange(cmdInput.value.length, cmdInput.value.length);
      }
    };
  });

  content.querySelectorAll('[data-cron-php-path]').forEach((btn) => {
    btn.onclick = () => {
      const cmdInput = document.getElementById('cron-command');
      const path = btn.dataset.cronPhpPath;
      const rest = cmdInput.value.trim();
      cmdInput.value = rest ? `${path} ${rest}` : `${path} `;
      cmdInput.focus();
    };
  });

  content.querySelectorAll('[data-cron-edit]').forEach((btn) => {
    btn.onclick = () => {
      cronEditingId = btn.dataset.cronEdit;
      refreshCronTab(content);
    };
  });

  const cancelBtn = document.getElementById('cron-cancel-btn');
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      cronEditingId = null;
      refreshCronTab(content);
    };
  }

  content.querySelectorAll('[data-cron-toggle]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.cronToggle;
      const enabled = btn.dataset.cronEnabled === 'true';
      const msgEl = document.getElementById('cron-msg');
      btn.disabled = true;
      try {
        await api('PUT', `/cron/${id}`, { enabled: !enabled });
        await refreshCronTab(content);
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
        btn.disabled = false;
      }
    };
  });

  content.querySelectorAll('[data-cron-delete]').forEach((btn) => {
    btn.onclick = async () => {
      if (!window.confirm(t('cron.confirm_delete'))) return;
      const msgEl = document.getElementById('cron-msg');
      btn.disabled = true;
      try {
        await api('DELETE', `/cron/${btn.dataset.cronDelete}`);
        await refreshCronTab(content);
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
        btn.disabled = false;
      }
    };
  });

  const submitBtn = document.getElementById('cron-submit-btn');
  submitBtn.onclick = async () => {
    const name = document.getElementById('cron-name').value;
    const schedule = document.getElementById('cron-schedule').value.trim();
    const command = document.getElementById('cron-command').value.trim();
    const msgEl = document.getElementById('cron-msg');
    msgEl.textContent = '';
    msgEl.className = 'action-msg';
    submitBtn.disabled = true;
    try {
      if (cronEditingId) {
        await api('PUT', `/cron/${cronEditingId}`, { name, schedule, command });
        cronEditingId = null;
      } else {
        await api('POST', '/cron', { name, schedule, command });
      }
      await refreshCronTab(content);
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
      submitBtn.disabled = false;
    }
  };
}

async function refreshCronTab(content) {
  content.innerHTML = `<div class="empty-state">${t('cron.loading')}</div>`;
  try {
    const [jobs, phpPaths] = await Promise.all([
      api('GET', '/cron'),
      cronPhpPathsCache ? Promise.resolve(cronPhpPathsCache) : api('GET', '/cron/php-paths')
    ]);
    cronPhpPathsCache = phpPaths;
    content.innerHTML = renderCronSection(jobs, phpPaths);
    wireCronSection(content, phpPaths);
  } catch (e) {
    content.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

// Bazy danych - dwa klocki obok siebie (1 rzad, dwie rowne kolumny, ten
// sam wzorzec co inne dwuklockowe rzedy w tym panelu):
//   1) zarzadzanie: formularz "nowa baza" (silnik - tylko jesli wiecej niz
//      jeden zainstalowany, ${username}_<sufiks>) + tabela istniejacych
//      baz z podgladem hasla (oczko - maskowanie/odslanianie CZYSTO PO
//      STRONIE KLIENTA, haslo i tak przychodzi z /api/user/databases w
//      calosci, bo to dane WLASNEGO konta).
//   2) statystyka: uzyto/limit (z pakietu, maxDatabases) + lista nazw baz
//      ktore juz istnieja.
// Baza ZAWSZE nazywa sie <username>_<sufiks> (np. srv_1001_wordpress) -
// jeden identyfikator dla bazy I jej dedykowanego usera (patrz
// hostingUserDatabases.js). Silniki widoczne to tylko te FAKTYCZNIE
// zainstalowane i aktywne na serwerze (systemServices.js) - jesli admin
// ma tylko MariaDB, user widzi/tworzy tylko MariaDB.
const DB_ENGINE_LABELS = { mariadb: 'MariaDB', postgresql: 'PostgreSQL', mongodb: 'MongoDB' };
const EYE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" style="vertical-align:middle;"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';

function dbRow(db) {
  const pwId = `db-pw-${db.id}`;
  return `
    <tr>
      <td>${escapeHtml(DB_ENGINE_LABELS[db.engine] || db.engine)}</td>
      <td>${escapeHtml(db.dbName)}</td>
      <td>${escapeHtml(db.dbUser)}</td>
      <td>
        <span id="${pwId}" data-password="${escapeHtml(db.password)}" data-masked="true" style="font-family:var(--mono);">••••••••</span>
        <button type="button" class="secondary" data-pw-toggle="${pwId}" title="${t('databases.toggle_password')}" style="padding:2px 6px;">${EYE_ICON_SVG}</button>
      </td>
      <td>${escapeHtml(db.host)}:${db.port}</td>
      <td><button type="button" class="danger" data-db-delete="${db.id}">${t('databases.delete')}</button></td>
    </tr>
  `;
}

function databasesManageCardHtml(data) {
  const { engines, items } = data;
  const engineOptions = engines.map((e) => `<option value="${e}">${escapeHtml(DB_ENGINE_LABELS[e] || e)}</option>`).join('');
  const singleEngine = engines.length === 1 ? engines[0] : '';

  const createFormHtml = engines.length ? `
    ${engines.length > 1 ? `
      <div style="margin-bottom:10px;">
        <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('databases.field_engine')}</label>
        <select id="db-new-engine">${engineOptions}</select>
      </div>
    ` : ''}
    <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px;">
      <div style="flex:1;min-width:180px;">
        <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('databases.field_name')}</label>
        <div style="display:flex;align-items:center;gap:4px;">
          <span style="color:var(--muted);font-size:13px;white-space:nowrap;font-family:var(--mono);">${escapeHtml(CURRENT_ACCOUNT?.username || '')}_</span>
          <input type="text" id="db-new-suffix" maxlength="32" placeholder="${t('databases.name_placeholder')}" style="flex:1;">
        </div>
      </div>
      <button type="button" id="db-create-btn" data-single-engine="${escapeHtml(singleEngine)}">${t('databases.create_button')}</button>
    </div>
    <div class="action-msg" id="db-msg"></div>
  ` : `<div class="empty-state">${t('databases.no_engines')}</div>`;

  const tableHtml = items.length ? `
    <div style="overflow-x:auto;margin-top:14px;">
      <table class="firewall-table">
        <thead>
          <tr>
            <th>${t('databases.col_engine')}</th>
            <th>${t('databases.col_name')}</th>
            <th>${t('databases.col_user')}</th>
            <th>${t('databases.col_password')}</th>
            <th>${t('databases.col_host')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${items.map(dbRow).join('')}</tbody>
      </table>
    </div>
  ` : (engines.length ? `<div class="empty-state">${t('databases.empty')}</div>` : '');

  return `
    <h3 style="margin:0 0 4px;font-size:15px;">${t('databases.manage_title')}</h3>
    <p style="margin:0 0 16px;color:var(--muted);font-size:13px;">${t('databases.manage_description')}</p>
    ${createFormHtml}
    ${tableHtml}
  `;
}

function databasesStatsCardHtml(data) {
  const { items, maxDatabases } = data;
  const used = items.length;
  const hasLimit = typeof maxDatabases === 'number' && maxDatabases > 0;
  const percent = hasLimit ? Math.min(100, Math.round((used / maxDatabases) * 100)) : 0;
  const valueText = hasLimit ? `${used} / ${maxDatabases}` : `${used}`;
  const listHtml = items.length
    ? `<ul style="margin:10px 0 0;padding-left:18px;font-size:13px;">${items.map((d) => `<li>${escapeHtml(d.dbName)} <span style="color:var(--muted);">(${escapeHtml(DB_ENGINE_LABELS[d.engine] || d.engine)})</span></li>`).join('')}</ul>`
    : `<div style="font-size:13px;color:var(--muted);margin-top:10px;">${t('databases.stats_empty')}</div>`;

  return `
    <h3 style="margin:0 0 4px;font-size:15px;">${t('databases.stats_title')}</h3>
    <div class="stat-value" style="margin:6px 0 6px;">${escapeHtml(valueText)}</div>
    <div class="meter-track"><div class="meter-fill ${severity(percent)}" style="width:${percent}%"></div></div>
    ${listHtml}
  `;
}

function renderDatabasesSection(data) {
  return `
    <div style="display:grid;grid-template-columns:minmax(0, 1fr) minmax(0, 1fr);gap:16px;width:100%;">
      <div class="system-info-card" style="max-width:none;width:100%;box-sizing:border-box;">
        ${databasesManageCardHtml(data)}
      </div>
      <div class="system-info-card" style="max-width:none;width:100%;box-sizing:border-box;">
        ${databasesStatsCardHtml(data)}
      </div>
    </div>
  `;
}

function wireDatabasesSection(content) {
  content.querySelectorAll('[data-pw-toggle]').forEach((btn) => {
    btn.onclick = () => {
      const span = document.getElementById(btn.dataset.pwToggle);
      if (!span) return;
      const masked = span.dataset.masked !== 'false';
      span.textContent = masked ? span.dataset.password : '••••••••';
      span.dataset.masked = masked ? 'false' : 'true';
    };
  });

  content.querySelectorAll('[data-db-delete]').forEach((btn) => {
    btn.onclick = async () => {
      if (!window.confirm(t('databases.confirm_delete'))) return;
      const msgEl = document.getElementById('db-msg');
      btn.disabled = true;
      try {
        await api('DELETE', `/databases/${btn.dataset.dbDelete}`);
        await refreshDatabasesTab(content);
      } catch (e) {
        if (msgEl) { msgEl.textContent = e.message; msgEl.className = 'action-msg error'; }
        btn.disabled = false;
      }
    };
  });

  const createBtn = document.getElementById('db-create-btn');
  if (createBtn) {
    createBtn.onclick = async () => {
      const suffixInput = document.getElementById('db-new-suffix');
      const engineSelect = document.getElementById('db-new-engine');
      const engine = engineSelect ? engineSelect.value : createBtn.dataset.singleEngine;
      const msgEl = document.getElementById('db-msg');
      msgEl.textContent = '';
      msgEl.className = 'action-msg';
      createBtn.disabled = true;
      try {
        await api('POST', '/databases', { engine, nameSuffix: suffixInput.value.trim() });
        await refreshDatabasesTab(content);
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
        createBtn.disabled = false;
      }
    };
  }
}

async function refreshDatabasesTab(content) {
  content.innerHTML = `<div class="empty-state">${t('databases.loading')}</div>`;
  try {
    const data = await api('GET', '/databases');
    content.innerHTML = renderDatabasesSection(data);
    wireDatabasesSection(content);
  } catch (e) {
    content.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

// Redis - prywatna instancja per konto (1 na usera), unix-socket-only
// (bez TCP - patrz hosting-user-redis-apply.sh, bezpieczenstwo na
// wspoldzielonym VPS), maks 256MB (stale, nie do zmiany przez usera),
// haslo NAPRAWDE opcjonalne (dostep juz jest ograniczony uprawnieniami
// systemu plikow do socketu). Dwa klocki (ten sam wzorzec co Bazy):
// lewy = start/stop + haslo, prawy = statystyka + test polaczenia.
function bytesToMb(bytes) {
  return typeof bytes === 'number' ? Math.round((bytes / 1024 / 1024) * 10) / 10 : null;
}

// Lewy kafelek Poczty - dostep (wlacza/wylacza WYLACZNIE administracja,
// patrz mail-toggle-access.sh/pam_listfile w Glowne->Poczta admina, wiec
// tu tylko odczyt statusu, bez przelacznika) + wlasny adres e-mail
// (<username>@<domena bazowa panelu> - server/services/hostingUserMail.js
// sklada go z detectBaseDomain(), tak samo jak admin-side "Adres e-mail
// administratora").
function mailAccessCardHtml(status) {
  if (!status.mailInstalled) {
    return `
      <h3 style="margin:0 0 4px;font-size:15px;">${t('mail.access_title')}</h3>
      <div class="empty-state">${t('mail.not_available')}</div>
    `;
  }
  const statusBadge = `<span class="status-badge ${status.accessEnabled ? 'active' : 'inactive'}">${status.accessEnabled ? t('mail.status_enabled') : t('mail.status_disabled')}</span>`;
  const webmailHtml = status.webmailUrl
    ? `<p style="margin:4px 0;font-size:14px;"><span style="color:var(--muted);">${t('mail.field_webmail')}:</span> <a href="${escapeHtml(status.webmailUrl)}" target="_blank" rel="noopener" style="font-family:var(--mono);color:var(--accent);">${escapeHtml(status.webmailUrl)}</a></p>`
    : '';
  const hintHtml = !status.accessEnabled
    ? `<p style="margin:10px 0 0;color:var(--muted);font-size:12px;">${t('mail.disabled_hint')}</p>`
    : '';
  return `
    <h3 style="margin:0 0 4px;font-size:15px;">${t('mail.access_title')} ${statusBadge}</h3>
    <p style="margin:10px 0 4px;font-size:14px;"><span style="color:var(--muted);">${t('mail.field_email')}:</span> <span class="info-value">${escapeHtml(status.emailAddress || '-')}</span></p>
    <p style="margin:4px 0;font-size:14px;"><span style="color:var(--muted);">${t('mail.field_password')}:</span> <span class="info-value">${t('mail.password_hint')}</span></p>
    ${webmailHtml}
    ${hintHtml}
  `;
}

// Prawy kafelek Poczty - statystyki skrzynki (~/Maildir), rozmiar +
// liczba wiadomosci z hosting-user-mailbox-stats.sh, limit rozmiaru z
// tego samego Postfixowego mailbox_size_limit, ktory admin ustawia w
// Glowne->Poczta (server/services/mail.js getPostfixLimits) - brak
// limitu (Postfix nigdy nie skonfigurowany recznie) pokazuje sama
// wartosc bez paska.
function mailStatsCardHtml(status) {
  if (!status.mailInstalled) {
    return `
      <h3 style="margin:0 0 4px;font-size:15px;">${t('mail.stats_title')}</h3>
      <div class="empty-state">${t('mail.not_available')}</div>
    `;
  }
  const hasLimit = typeof status.mailboxLimitMb === 'number' && status.mailboxLimitMb > 0;
  const percent = hasLimit ? Math.min(100, Math.round((status.sizeMb / status.mailboxLimitMb) * 100)) : 0;
  const sizeText = hasLimit ? `${status.sizeMb} MB / ${status.mailboxLimitMb} MB` : `${status.sizeMb} MB`;
  return `
    <h3 style="margin:0 0 4px;font-size:15px;">${t('mail.stats_title')}</h3>
    <div class="stat-label">${t('mail.stats_size')}</div>
    <div class="stat-value" style="margin:2px 0 6px;">${escapeHtml(sizeText)}</div>
    <div class="meter-track"><div class="meter-fill ${severity(percent)}" style="width:${percent}%"></div></div>
    <div class="info-grid" style="margin-top:14px;">
      <div class="info-label">${t('mail.stats_messages')}</div><div class="info-value">${status.messageCount}</div>
    </div>
  `;
}

// Domeny dostepne w obu ponizszych kafelkach = WSZYSTKIE domeny wirtualne
// zarejestrowane pod tym kontem (baza strony ORAZ "mail.<domena>", patrz
// hostingUserSites.js createSite -> addVirtualDomain x2) - panel nie
// zgaduje, ktorej "powinien" uzyc, user sam wybiera z listy.
let mailSelectedDomain = null;

// Lewy z nowej pary kafelkow - "Dodaj konto e-mail". Formularz + tabela
// istniejacych skrzynek DLA WYBRANEJ domeny (przelacznik domeny odswieza
// cala zakladke, patrz wireMailManageSection). Limit (2 konta/domene
// domyslnie) jest egzekwowany PO STRONIE SERWERA
// (hostingUserMailboxes.js -> mailVirtual.js -> mailLimits.js), wiec
// przekroczenie po prostu wraca jako czytelny blad w msgEl, bez
// duplikowania logiki limitu tutaj.
function mailboxManageCardHtml(domains, selectedDomain, mailboxes) {
  if (!domains.length) {
    return `
      <h3 style="margin:0 0 4px;font-size:15px;">${t('mail.mailbox_manage_title')}</h3>
      <div class="empty-state">${t('mail.mailbox_no_domains')}</div>
    `;
  }
  const domainOptionsHtml = domains.map((d) => `<option value="${escapeHtml(d)}" ${d === selectedDomain ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('');
  const rows = mailboxes.map((m) => `
    <tr>
      <td>${escapeHtml(m.localpart)}@${escapeHtml(selectedDomain)}</td>
      <td style="white-space:nowrap;">
        <button type="button" class="secondary" data-mailbox-passwd="${escapeHtml(m.localpart)}">${t('mail.mailbox_changepw_button')}</button>
        <button type="button" class="danger" data-mailbox-remove="${escapeHtml(m.localpart)}">${t('mail.mailbox_delete_button')}</button>
      </td>
    </tr>
  `).join('');
  return `
    <h3 style="margin:0 0 4px;font-size:15px;">${t('mail.mailbox_manage_title')}</h3>
    <p style="margin:0 0 16px;color:var(--muted);font-size:13px;">${t('mail.mailbox_manage_description')}</p>
    <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('mail.field_domain')}</label>
    <select id="mailbox-domain-select" style="width:100%;box-sizing:border-box;margin-bottom:10px;">${domainOptionsHtml}</select>
    <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('mail.field_localpart')}</label>
    <input type="text" id="mailbox-new-localpart" placeholder="${t('mail.localpart_placeholder')}" style="width:100%;box-sizing:border-box;margin-bottom:10px;">
    <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('mail.field_password')}</label>
    <div style="display:flex;gap:8px;margin-bottom:10px;">
      <input type="text" id="mailbox-new-password" style="flex:1;font-family:var(--mono);">
      <button type="button" class="secondary" id="mailbox-generate-btn">${t('redis.generate_button')}</button>
    </div>
    <button type="button" id="mailbox-create-btn">${t('mail.mailbox_add_button')}</button>
    <div class="action-msg" id="mailbox-msg"></div>
    ${mailboxes.length ? `
      <table class="firewall-table" style="margin-top:14px;">
        <thead><tr><th>${t('mail.mailbox_column')}</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    ` : `<div class="empty-state" style="margin-top:14px;">${t('mail.mailbox_empty')}</div>`}
  `;
}

// Prawy z nowej pary kafelkow - "Dodaj przekierowanie/alias". Ten sam
// wzorzec domena-select + formularz + tabela co lewy kafelek wyzej;
// destination MOZE byc dowolnym zewnetrznym adresem (nie tylko lokalna
// skrzynka), zgodnie z addVirtualAlias w mailVirtual.js.
function aliasManageCardHtml(domains, selectedDomain, aliases) {
  if (!domains.length) {
    return `
      <h3 style="margin:0 0 4px;font-size:15px;">${t('mail.alias_manage_title')}</h3>
      <div class="empty-state">${t('mail.mailbox_no_domains')}</div>
    `;
  }
  const domainOptionsHtml = domains.map((d) => `<option value="${escapeHtml(d)}" ${d === selectedDomain ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('');
  const rows = aliases.map((a) => `
    <tr>
      <td>${escapeHtml(a.source)}</td>
      <td>${escapeHtml(a.destination)}</td>
      <td><button type="button" class="danger" data-alias-remove="${escapeHtml(a.source)}" data-alias-dest="${escapeHtml(a.destination)}">${t('mail.mailbox_delete_button')}</button></td>
    </tr>
  `).join('');
  return `
    <h3 style="margin:0 0 4px;font-size:15px;">${t('mail.alias_manage_title')}</h3>
    <p style="margin:0 0 16px;color:var(--muted);font-size:13px;">${t('mail.alias_manage_description')}</p>
    <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('mail.field_domain')}</label>
    <select id="alias-domain-select" style="width:100%;box-sizing:border-box;margin-bottom:10px;">${domainOptionsHtml}</select>
    <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('mail.field_alias_source')}</label>
    <input type="text" id="alias-new-source" placeholder="${t('mail.localpart_placeholder')}" style="width:100%;box-sizing:border-box;margin-bottom:10px;">
    <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('mail.field_alias_destination')}</label>
    <input type="text" id="alias-new-destination" placeholder="${t('mail.alias_destination_placeholder')}" style="width:100%;box-sizing:border-box;margin-bottom:10px;">
    <button type="button" id="alias-create-btn">${t('mail.alias_add_button')}</button>
    <div class="action-msg" id="alias-msg"></div>
    ${aliases.length ? `
      <table class="firewall-table" style="margin-top:14px;">
        <thead><tr><th>${t('mail.alias_column_source')}</th><th>${t('mail.alias_column_destination')}</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    ` : `<div class="empty-state" style="margin-top:14px;">${t('mail.alias_empty')}</div>`}
  `;
}

// Trzeci, PELNOSZEROKI kafelek Poczty - DKIM (+ SPF/DMARC ponizej, czysto
// informacyjne, bez zadnej instalacji - patrz getSpfDmarcInfo w mail.js).
// DKIM podpisuje "d=<domena>" dopasowane do adresu FROM, wiec zawsze
// dotyczy domeny BAZOWEJ - ten sam selektor domen co mailbox/alias wyzej
// (dzielony stan mailSelectedDomain, przelaczenie w ktoromkolwiek z
// trzech selektorow odswieza cala zakladke tym samym mechanizmem).
function mailDkimSectionHtml(domains, selectedDomain, dkim, spfDmarc) {
  if (!domains.length) {
    return `
      <h3 style="margin:0 0 4px;font-size:15px;">${t('mail.dkim_title')}</h3>
      <div class="empty-state">${t('mail.mailbox_no_domains')}</div>
    `;
  }
  const domainOptionsHtml = domains.map((d) => `<option value="${escapeHtml(d)}" ${d === selectedDomain ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('');

  const spfDmarcHtml = spfDmarc ? `
    <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);">
      <h4 style="margin:0 0 8px;font-size:14px;">${t('mail.spf_title')}</h4>
      <p style="margin:0 0 12px;color:var(--muted);font-size:12px;">${t('mail.spf_dns_hint')}</p>
      <dl style="margin:0 0 16px;">
        <dt>${t('mail.dkim_record_type_label')}</dt><dd style="font-family:var(--mono);">TXT</dd>
        <dt>${t('mail.dkim_record_name_label')}</dt><dd style="font-family:var(--mono);word-break:break-all;">${escapeHtml(spfDmarc.spfRecordName)}</dd>
        <dt>${t('mail.dkim_record_value_label')}</dt><dd style="font-family:var(--mono);word-break:break-all;">${escapeHtml(spfDmarc.spfRecordValue)}</dd>
      </dl>
      <span class="copy-src" style="display:none;">${escapeHtml(spfDmarc.spfRecordValueRaw)}</span><button type="button" class="secondary copy-value-btn">${t('mail.spf_copy_button')}</button>
    </div>
    <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);">
      <h4 style="margin:0 0 8px;font-size:14px;">${t('mail.dmarc_title')}</h4>
      <p style="margin:0 0 12px;color:var(--muted);font-size:12px;">${t('mail.dmarc_dns_hint')}</p>
      <dl style="margin:0 0 16px;">
        <dt>${t('mail.dkim_record_type_label')}</dt><dd style="font-family:var(--mono);">TXT</dd>
        <dt>${t('mail.dkim_record_name_label')}</dt><dd style="font-family:var(--mono);word-break:break-all;">${escapeHtml(spfDmarc.dmarcRecordName)}</dd>
        <dt>${t('mail.dkim_record_value_label')}</dt><dd style="font-family:var(--mono);word-break:break-all;">${escapeHtml(spfDmarc.dmarcRecordValue)}</dd>
      </dl>
      <span class="copy-src" style="display:none;">${escapeHtml(spfDmarc.dmarcRecordValueRaw)}</span><button type="button" class="secondary copy-value-btn">${t('mail.dmarc_copy_button')}</button>
    </div>
  ` : '';

  return `
    <h3 style="margin:0 0 4px;font-size:15px;">${t('mail.dkim_title')}</h3>
    <p style="margin:0 0 16px;color:var(--muted);font-size:13px;">${t('mail.dkim_manage_description')}</p>
    <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('mail.field_domain')}</label>
    <select id="dkim-domain-select" style="width:100%;box-sizing:border-box;margin-bottom:14px;">${domainOptionsHtml}</select>
    ${dkim && dkim.installed ? `
      <p style="margin:0 0 12px;color:var(--accent);font-size:13px;">${t('mail.dkim_installed_hint')}</p>
      <p style="margin:0 0 12px;color:var(--muted);font-size:13px;">${t('mail.dkim_dns_hint')}</p>
      <dl style="margin:0 0 16px;">
        <dt>${t('mail.dkim_record_type_label')}</dt><dd style="font-family:var(--mono);">TXT</dd>
        <dt>${t('mail.dkim_record_name_label')}</dt><dd style="font-family:var(--mono);word-break:break-all;">${escapeHtml(dkim.recordName)}</dd>
        <dt>${t('mail.dkim_record_value_label')}</dt><dd style="font-family:var(--mono);word-break:break-all;">${escapeHtml(dkim.recordValue)}</dd>
      </dl>
    ` : `<p style="margin:0 0 12px;color:var(--muted);font-size:13px;">${t('mail.dkim_not_installed_hint')}</p>`}
    <button type="button" id="dkim-install-btn">${dkim && dkim.installed ? t('mail.dkim_recheck_button') : t('mail.dkim_install_button')}</button>
    ${dkim && dkim.installed ? `<span class="dkim-raw-value" style="display:none;">${escapeHtml(dkim.recordValueRaw || '')}</span><button type="button" class="secondary copy-value-btn" id="dkim-copy-btn">${t('mail.dkim_copy_button')}</button>` : ''}
    <div class="action-msg" id="dkim-msg"></div>
    ${spfDmarcHtml}
  `;
}

function renderMailSection(status, domains, selectedDomain, mailboxes, aliases, dkim, spfDmarc, sniDomains) {
  return `
    <div style="display:grid;grid-template-columns:minmax(0, 1fr) minmax(0, 1fr);gap:16px;width:100%;">
      <div class="system-info-card" style="max-width:none;width:100%;box-sizing:border-box;">
        ${mailAccessCardHtml(status)}
      </div>
      <div class="system-info-card" style="max-width:none;width:100%;box-sizing:border-box;">
        ${mailStatsCardHtml(status)}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:minmax(0, 1fr) minmax(0, 1fr);gap:16px;width:100%;margin-top:16px;">
      <div class="system-info-card" style="max-width:none;width:100%;box-sizing:border-box;">
        ${mailboxManageCardHtml(domains, selectedDomain, mailboxes)}
      </div>
      <div class="system-info-card" style="max-width:none;width:100%;box-sizing:border-box;">
        ${aliasManageCardHtml(domains, selectedDomain, aliases)}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:minmax(0, 1fr) minmax(0, 1fr);gap:16px;width:100%;margin-top:16px;">
      <div class="system-info-card" style="max-width:none;width:100%;box-sizing:border-box;">
        ${mailDkimSectionHtml(domains, selectedDomain, dkim, spfDmarc)}
      </div>
      <div class="system-info-card" style="max-width:none;width:100%;box-sizing:border-box;">
        ${mailSniSectionHtml(sniDomains)}
      </div>
    </div>
  `;
}

// Kafelek SNI (obok DKIM/SPF/DMARC, 50/50) - certyfikat TLS dla
// "mail.<domena>" (server/scripts/mail-sni-sync.sh). Niezalezny od
// selektora domeny DKIM/mailboxow (mailSelectedDomain) - klient moze miec
// WIECEJ NIZ JEDNA strone z "Obsluga poczty", wiec to zawsze tabelka
// WSZYSTKICH jego domen "mail.<domena>" naraz (user zglosil 2026-08-16,
// ze poprzednia wersja pokazujaca tylko 1 wybrana domene byla
// mylaca/niewystarczajaca). Lista+wlasnosc kazdej domeny jest liczona
// wprost po stronie serwera (listOwnSniDomains w
// hostingUserMailboxes.js), nie wyprowadzana z mailSelectedDomain.
function mailSniSectionHtml(sniDomains) {
  if (!sniDomains.length) {
    return `
      <h3 style="margin:0 0 4px;font-size:15px;">${t('mail.sni_title')}</h3>
      <p style="margin:0 0 12px;color:var(--muted);font-size:13px;">${t('mail.sni_description')}</p>
      <div class="empty-state">${t('mail.sni_not_enabled')}</div>
    `;
  }
  const rows = sniDomains.map(({ domain, synced, certIssuer, certDaysRemaining }) => `
    <tr>
      <td style="font-family:var(--mono);">${escapeHtml(domain)}</td>
      <td>${synced
        ? `<span class="status-badge active">${t('mail.sni_status_synced')}</span>`
        : `<span style="color:var(--muted);font-size:13px;">${t('mail.sni_status_not_synced')}</span>`}</td>
      <td>${certIssuer && Number.isFinite(certDaysRemaining)
        ? escapeHtml(t(certDaysRemaining >= 0 ? 'mail.sni_cert_valid' : 'mail.sni_cert_expired', { issuer: certIssuer, days: Math.abs(certDaysRemaining) }))
        : `<span style="color:var(--muted);">${t('mail.sni_cert_unknown')}</span>`}</td>
      <td>
        <button type="button" class="secondary" data-sni-sync="${escapeHtml(domain)}">${synced ? t('mail.sni_resync_button') : t('mail.sni_sync_button')}</button>
        ${synced ? `<button type="button" class="danger" data-sni-remove="${escapeHtml(domain)}">${t('mail.sni_remove_button')}</button>` : ''}
      </td>
    </tr>
  `).join('');
  return `
    <h3 style="margin:0 0 4px;font-size:15px;">${t('mail.sni_title')}</h3>
    <p style="margin:0 0 16px;color:var(--muted);font-size:13px;">${t('mail.sni_description')}</p>
    <table class="firewall-table">
      <thead><tr><th>${t('mail.sni_col_domain')}</th><th>${t('mail.sni_col_status')}</th><th>${t('mail.sni_col_cert')}</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="action-msg" id="sni-msg"></div>
  `;
}

function wireMailManageSection(content) {
  wireCopyButtons(content);
  const mailboxDomainSelect = document.getElementById('mailbox-domain-select');
  if (mailboxDomainSelect) {
    mailboxDomainSelect.onchange = async () => {
      mailSelectedDomain = mailboxDomainSelect.value;
      await refreshMailTab(content);
    };
  }
  const aliasDomainSelect = document.getElementById('alias-domain-select');
  if (aliasDomainSelect) {
    aliasDomainSelect.onchange = async () => {
      mailSelectedDomain = aliasDomainSelect.value;
      await refreshMailTab(content);
    };
  }
  const dkimDomainSelect = document.getElementById('dkim-domain-select');
  if (dkimDomainSelect) {
    dkimDomainSelect.onchange = async () => {
      mailSelectedDomain = dkimDomainSelect.value;
      await refreshMailTab(content);
    };
  }

  const dkimInstallBtn = document.getElementById('dkim-install-btn');
  if (dkimInstallBtn) {
    dkimInstallBtn.onclick = async () => {
      const msgEl = document.getElementById('dkim-msg');
      msgEl.textContent = '';
      msgEl.className = 'action-msg';
      dkimInstallBtn.disabled = true;
      try {
        await api('POST', '/mail/dkim-install', { domain: mailSelectedDomain });
        await refreshMailTab(content);
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
        dkimInstallBtn.disabled = false;
      }
    };
  }

  content.querySelectorAll('[data-sni-sync]').forEach((btn) => {
    btn.onclick = async () => {
      const domain = btn.dataset.sniSync;
      const msgEl = document.getElementById('sni-msg');
      msgEl.textContent = '';
      msgEl.className = 'action-msg';
      btn.disabled = true;
      try {
        await api('POST', '/mail/sni-sync', { domain });
        await refreshMailTab(content);
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
        btn.disabled = false;
      }
    };
  });

  content.querySelectorAll('[data-sni-remove]').forEach((btn) => {
    btn.onclick = async () => {
      const domain = btn.dataset.sniRemove;
      if (!window.confirm(t('mail.sni_confirm_remove', { domain }))) return;
      const msgEl = document.getElementById('sni-msg');
      msgEl.textContent = '';
      msgEl.className = 'action-msg';
      btn.disabled = true;
      try {
        await api('DELETE', `/mail/sni-sync/${encodeURIComponent(domain)}`);
        await refreshMailTab(content);
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
        btn.disabled = false;
      }
    };
  });

  const genBtn = document.getElementById('mailbox-generate-btn');
  if (genBtn) {
    genBtn.onclick = () => {
      document.getElementById('mailbox-new-password').value = generatePassword();
    };
  }

  const createMailboxBtn = document.getElementById('mailbox-create-btn');
  if (createMailboxBtn) {
    createMailboxBtn.onclick = async () => {
      const domain = document.getElementById('mailbox-domain-select').value;
      const localpart = document.getElementById('mailbox-new-localpart').value.trim();
      const password = document.getElementById('mailbox-new-password').value;
      const msgEl = document.getElementById('mailbox-msg');
      msgEl.textContent = '';
      msgEl.className = 'action-msg';
      createMailboxBtn.disabled = true;
      try {
        await api('POST', '/mail/mailboxes', { domain, localpart, password });
        await refreshMailTab(content);
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
        createMailboxBtn.disabled = false;
      }
    };
  }

  content.querySelectorAll('[data-mailbox-passwd]').forEach((btn) => {
    btn.onclick = async () => {
      const localpart = btn.dataset.mailboxPasswd;
      const password = window.prompt(t('mail.mailbox_prompt_password'));
      if (password === null) return;
      if (password.length < 8) { window.alert(t('mail.mailbox_password_too_short')); return; }
      btn.disabled = true;
      try {
        await api('PUT', `/mail/mailboxes/${encodeURIComponent(mailSelectedDomain)}/${encodeURIComponent(localpart)}`, { password });
        await refreshMailTab(content);
      } catch (e) {
        window.alert(e.message);
        btn.disabled = false;
      }
    };
  });

  content.querySelectorAll('[data-mailbox-remove]').forEach((btn) => {
    btn.onclick = async () => {
      const localpart = btn.dataset.mailboxRemove;
      if (!window.confirm(t('mail.mailbox_confirm_remove', { mailbox: `${localpart}@${mailSelectedDomain}` }))) return;
      btn.disabled = true;
      try {
        await api('DELETE', `/mail/mailboxes/${encodeURIComponent(mailSelectedDomain)}/${encodeURIComponent(localpart)}`);
        await refreshMailTab(content);
      } catch (e) {
        window.alert(e.message);
        btn.disabled = false;
      }
    };
  });

  const createAliasBtn = document.getElementById('alias-create-btn');
  if (createAliasBtn) {
    createAliasBtn.onclick = async () => {
      const domain = document.getElementById('alias-domain-select').value;
      const sourceLocalpart = document.getElementById('alias-new-source').value.trim();
      const destination = document.getElementById('alias-new-destination').value.trim();
      const msgEl = document.getElementById('alias-msg');
      msgEl.textContent = '';
      msgEl.className = 'action-msg';
      createAliasBtn.disabled = true;
      try {
        await api('POST', '/mail/aliases', { domain, sourceLocalpart, destination });
        await refreshMailTab(content);
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
        createAliasBtn.disabled = false;
      }
    };
  }

  content.querySelectorAll('[data-alias-remove]').forEach((btn) => {
    btn.onclick = async () => {
      const source = btn.dataset.aliasRemove;
      const destination = btn.dataset.aliasDest;
      if (!window.confirm(t('mail.alias_confirm_remove', { source, destination }))) return;
      btn.disabled = true;
      try {
        // "source" tutaj to PELNY adres (login@domena, tak jest
        // przechowywany w bazie - patrz mail-virtual-alias.sh) - backend
        // (LOCALPART_RE) oczekuje w tym miejscu SAMEGO loginu, wiec domena
        // musi zostac odciecia przed wyslaniem, inaczej usuwanie zawsze
        // konczylo sie bledem walidacji ("nieprawidlowy login zrodlowy").
        const sourceLocalpart = source.split('@')[0];
        await api('DELETE', `/mail/aliases/${encodeURIComponent(mailSelectedDomain)}/${encodeURIComponent(sourceLocalpart)}/${encodeURIComponent(destination)}`);
        await refreshMailTab(content);
      } catch (e) {
        window.alert(e.message);
        btn.disabled = false;
      }
    };
  });
}

async function refreshMailTab(content) {
  content.innerHTML = `<div class="empty-state">${t('mail.loading')}</div>`;
  try {
    const [status, { items: domains }] = await Promise.all([
      api('GET', '/mail'),
      api('GET', '/mail/domains')
    ]);
    if (!mailSelectedDomain || !domains.includes(mailSelectedDomain)) {
      mailSelectedDomain = domains[0] || null;
    }
    let mailboxes = [];
    let aliases = [];
    let dkim = null;
    let spfDmarc = null;
    // Niezalezne od mailSelectedDomain (selektor DKIM/mailboxow/aliasow) -
    // klient moze miec WIECEJ NIZ JEDNA strone z "Obsluga poczty", wiec
    // pokazujemy WSZYSTKIE jego domeny "mail.<domena>" naraz, nie tylko
    // te akurat wybrana gdzie indziej.
    const sniDomains = domains.length ? await api('GET', '/mail/sni-domains').then((r) => r.items).catch(() => []) : [];
    if (mailSelectedDomain) {
      const encoded = encodeURIComponent(mailSelectedDomain);
      const [mailboxesRes, aliasesRes, dkimRes, spfDmarcRes] = await Promise.all([
        api('GET', `/mail/mailboxes?domain=${encoded}`),
        api('GET', `/mail/aliases?domain=${encoded}`),
        api('GET', `/mail/dkim-status?domain=${encoded}`).catch(() => null),
        api('GET', `/mail/spf-dmarc?domain=${encoded}`).catch(() => null)
      ]);
      mailboxes = mailboxesRes.items;
      aliases = aliasesRes.items;
      dkim = dkimRes;
      spfDmarc = spfDmarcRes;
    }
    content.innerHTML = renderMailSection(status, domains, mailSelectedDomain, mailboxes, aliases, dkim, spfDmarc, sniDomains);
    wireMailManageSection(content);
  } catch (e) {
    content.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

function redisManageCardHtml(status) {
  if (!status.available) {
    return `
      <h3 style="margin:0 0 4px;font-size:15px;">${t('redis.manage_title')}</h3>
      <div class="empty-state">${t('redis.not_available')}</div>
    `;
  }

  const statusBadge = `<span class="status-badge ${status.running ? 'active' : 'inactive'}">${status.running ? t('redis.status_running') : t('redis.status_stopped')}</span>`;
  const toggleButtonHtml = status.running
    ? `<button type="button" class="danger" id="redis-stop-btn">${t('redis.stop_button')}</button>`
    : `<button type="button" id="redis-start-btn">${t('redis.start_button')}</button>`;

  const passwordSectionHtml = `
    <label style="display:flex;align-items:center;gap:6px;font-size:13px;margin:14px 0 8px;">
      <input type="checkbox" id="redis-pw-enable" ${status.passwordEnabled ? 'checked' : ''}>
      ${t('redis.field_enable_password')}
    </label>
    <div id="redis-pw-fields" style="display:${status.passwordEnabled ? 'block' : 'none'};margin-bottom:10px;">
      <div style="display:flex;gap:8px;">
        <input type="text" id="redis-pw-value" value="${escapeHtml(status.password || '')}" style="flex:1;font-family:var(--mono);">
        <button type="button" class="secondary" id="redis-pw-generate-btn">${t('redis.generate_button')}</button>
      </div>
    </div>
    <button type="button" id="redis-pw-save-btn">${t('redis.save_button')}</button>
    <div class="action-msg" id="redis-msg"></div>
  `;

  const connectionInfoHtml = status.running ? `
    <div class="info-grid" style="margin-top:14px;">
      <div class="info-label">${t('redis.field_socket')}</div><div class="info-value" style="font-family:var(--mono);word-break:break-all;">${escapeHtml(status.socketPath)}</div>
    </div>
  ` : '';

  return `
    <h3 style="margin:0 0 4px;font-size:15px;">${t('redis.manage_title')} ${statusBadge}</h3>
    <p style="margin:0 0 16px;color:var(--muted);font-size:13px;">${t('redis.manage_description')}</p>
    ${toggleButtonHtml}
    ${connectionInfoHtml}
    <hr style="border:none;border-top:1px solid var(--border);margin:16px 0;">
    ${passwordSectionHtml}
  `;
}

function redisStatsCardHtml(status) {
  const usedMb = bytesToMb(status.usedMemoryBytes);
  const valueText = status.running
    ? (usedMb !== null ? `${usedMb} MB / ${status.maxMemoryMb} MB` : `- / ${status.maxMemoryMb} MB`)
    : `0 MB / ${status.maxMemoryMb} MB`;
  const percent = status.running && usedMb !== null ? Math.min(100, Math.round((usedMb / status.maxMemoryMb) * 100)) : 0;

  return `
    <h3 style="margin:0 0 4px;font-size:15px;">${t('redis.stats_title')}</h3>
    <div class="stat-value" style="margin:6px 0 6px;">${escapeHtml(valueText)}</div>
    <div class="meter-track"><div class="meter-fill ${severity(percent)}" style="width:${percent}%"></div></div>
    <button type="button" class="secondary" id="redis-test-btn" style="margin-top:14px;" ${status.running ? '' : 'disabled'}>${t('redis.test_button')}</button>
    <div class="action-msg" id="redis-test-msg"></div>
    <div style="font-size:12px;color:var(--muted);margin-top:14px;">${t('redis.contact_admin_hint')}</div>
  `;
}

function renderRedisSection(status) {
  return `
    <div style="display:grid;grid-template-columns:minmax(0, 1fr) minmax(0, 1fr);gap:16px;width:100%;">
      <div class="system-info-card" style="max-width:none;width:100%;box-sizing:border-box;">
        ${redisManageCardHtml(status)}
      </div>
      <div class="system-info-card" style="max-width:none;width:100%;box-sizing:border-box;">
        ${redisStatsCardHtml(status)}
      </div>
    </div>
  `;
}

function wireRedisSection(content) {
  const pwEnableCheckbox = document.getElementById('redis-pw-enable');
  if (pwEnableCheckbox) {
    pwEnableCheckbox.onchange = () => {
      const fields = document.getElementById('redis-pw-fields');
      if (fields) fields.style.display = pwEnableCheckbox.checked ? 'block' : 'none';
    };
  }

  const pwGenerateBtn = document.getElementById('redis-pw-generate-btn');
  if (pwGenerateBtn) {
    pwGenerateBtn.onclick = () => { document.getElementById('redis-pw-value').value = generatePassword(); };
  }

  const startBtn = document.getElementById('redis-start-btn');
  const stopBtn = document.getElementById('redis-stop-btn');
  const saveBtn = document.getElementById('redis-pw-save-btn');
  const msgEl = document.getElementById('redis-msg');

  const applyStart = async () => {
    const enablePassword = document.getElementById('redis-pw-enable').checked;
    const password = document.getElementById('redis-pw-value')?.value || '';
    msgEl.textContent = t('redis.applying');
    msgEl.className = 'action-msg';
    try {
      await api('POST', '/redis/start', { enablePassword, password });
      await refreshRedisTab(content);
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
    }
  };

  if (startBtn) startBtn.onclick = applyStart;
  if (saveBtn) saveBtn.onclick = applyStart;

  if (stopBtn) {
    stopBtn.onclick = async () => {
      stopBtn.disabled = true;
      msgEl.textContent = t('redis.stopping');
      msgEl.className = 'action-msg';
      try {
        await api('POST', '/redis/stop');
        await refreshRedisTab(content);
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
        stopBtn.disabled = false;
      }
    };
  }

  const testBtn = document.getElementById('redis-test-btn');
  if (testBtn) {
    testBtn.onclick = async () => {
      const testMsgEl = document.getElementById('redis-test-msg');
      testBtn.disabled = true;
      testMsgEl.textContent = t('redis.testing');
      testMsgEl.className = 'action-msg';
      try {
        await api('POST', '/redis/test');
        testMsgEl.textContent = t('redis.test_success');
        testMsgEl.className = 'action-msg success';
      } catch (e) {
        testMsgEl.textContent = e.message;
        testMsgEl.className = 'action-msg error';
      } finally {
        testBtn.disabled = false;
      }
    };
  }
}

async function refreshRedisTab(content) {
  content.innerHTML = `<div class="empty-state">${t('redis.loading')}</div>`;
  try {
    const status = await api('GET', '/redis');
    content.innerHTML = renderRedisSection(status);
    wireRedisSection(content);
  } catch (e) {
    content.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

const PYTHON_FRAMEWORKS = ['django', 'flask', 'fastapi', 'manual'];

// Stan zakladki trzymany miedzy odswiezeniami (ten sam wzorzec co
// siteEditingId/siteEditingContent dla Stron): pythonAppsCache pozwala
// przerysowac SAMA liste (np. po otwarciu logow) bez ponownego odpytania
// /python/versions i /python/free-port - a pythonLogsSlug/pythonLogsData
// pamietaja, ktora aplikacja ma akurat rozwiniety panel logow.
let pythonAppsCache = [];
let pythonLogsSlug = null;
let pythonLogsData = null;

function pythonAppsFormCardHtml(versions, portInfo) {
  if (versions.length === 0) {
    return `
      <h3 style="margin:0 0 4px;font-size:15px;">${t('python.manage_title')}</h3>
      <div class="empty-state">${t('python.no_versions_hint')}</div>
    `;
  }

  return `
    <h3 style="margin:0 0 4px;font-size:15px;">${t('python.manage_title')}</h3>
    <p style="margin:0 0 16px;color:var(--muted);font-size:13px;">${t('python.manage_description')}</p>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div>
        <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('python.field_name')}</label>
        <input type="text" id="python-new-slug" placeholder="myapp" style="width:100%;box-sizing:border-box;">
        <p style="margin:4px 0 0;color:var(--muted);font-size:11px;">${t('python.name_hint')}</p>
      </div>
      <div>
        <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('python.field_version')}</label>
        <select id="python-new-version" style="width:100%;box-sizing:border-box;">
          ${versions.map((v) => `<option value="${escapeHtml(v.id)}">${escapeHtml(v.version)}</option>`).join('')}
        </select>
      </div>
      <div>
        <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('python.field_framework')}</label>
        <select id="python-new-framework" style="width:100%;box-sizing:border-box;">
          ${PYTHON_FRAMEWORKS.map((fw) => `<option value="${fw}">${t(`python.framework_${fw}`)}</option>`).join('')}
        </select>
      </div>
      <div>
        <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('python.field_port')}</label>
        <div style="display:flex;gap:8px;">
          <input type="number" id="python-new-port" min="1" max="65535" value="${portInfo && portInfo.free ? escapeHtml(String(portInfo.port)) : ''}" style="flex:1;">
          <button type="button" class="secondary" id="python-port-check-btn">${t('python.check_port_button')}</button>
        </div>
        <p style="margin:4px 0 0;color:var(--muted);font-size:11px;">${t('python.free_port_label')}: ${portInfo ? escapeHtml(String(portInfo.port)) : '-'}</p>
        <div class="action-msg" id="python-port-msg"></div>
      </div>
    </div>
    <button type="button" id="python-create-app-btn" style="margin-top:14px;">${t('python.create_app_button')}</button>
    <div class="action-msg" id="python-create-msg"></div>
    <p style="margin:14px 0 0;color:var(--muted);font-size:11px;">${t('python.django_dev_hint')}</p>
  `;
}

function pythonAppRow(item) {
  const isManual = item.framework === 'manual';

  // 'manual' nigdy nie ma uslugi systemd zalozonej przez panel (patrz
  // startApp() w hostingUserPython.js - wprost odrzuca ten framework), wiec
  // running/Uruchom/Zatrzymaj/Logi nie maja tu zastosowania - tylko
  // neutralna etykieta i usuwanie.
  const statusBadge = isManual
    ? `<span class="status-badge inactive">${t('python.manual_status')}</span>`
    : `<span class="status-badge ${item.running ? 'active' : 'inactive'}">${item.running ? t('python.app_status_running') : t('python.app_status_stopped')}</span>`;

  const toggleButtonHtml = item.running
    ? `<button type="button" class="secondary" data-app-stop="${escapeHtml(item.slug)}">${t('python.stop_button')}</button>`
    : `<button type="button" class="secondary" data-app-start="${escapeHtml(item.slug)}" data-app-port="${item.port}">${t('python.start_button')}</button>`;

  const actionsHtml = isManual
    ? `<button type="button" class="danger" data-app-delete="${escapeHtml(item.slug)}">${t('python.delete_button')}</button>`
    : `
      ${toggleButtonHtml}
      <button type="button" class="secondary" data-app-logs="${escapeHtml(item.slug)}">${t('python.logs_button')}</button>
      <button type="button" class="danger" data-app-delete="${escapeHtml(item.slug)}">${t('python.delete_button')}</button>
    `;

  const logsOpen = !isManual && pythonLogsSlug === item.slug;
  const logsRowHtml = logsOpen ? `
    <tr>
      <td colspan="5">
        <div style="font-size:12px;color:var(--muted);margin-bottom:4px;">${t('python.app_logs_label')}</div>
        ${pythonLogsData
          ? (pythonLogsData.logs.length > 0
              ? `<pre style="margin:0;max-height:160px;overflow:auto;font-size:11px;background:var(--bg-alt, rgba(128,128,128,0.08));padding:8px;border-radius:6px;white-space:pre-wrap;word-break:break-all;">${escapeHtml(pythonLogsData.logs.join('\n'))}</pre>`
              : `<div class="empty-state">${t('python.app_no_logs')}</div>`)
          : `<div class="empty-state">${t('python.loading')}</div>`}
      </td>
    </tr>
  ` : '';

  return `
    <tr>
      <td>${escapeHtml(item.slug)}</td>
      <td>${t(`python.framework_${item.framework}`)}</td>
      <td>${item.port}</td>
      <td>${statusBadge}</td>
      <td style="white-space:nowrap;">
        ${actionsHtml}
      </td>
    </tr>
    ${logsRowHtml}
  `;
}

function pythonAppsListCardHtml(apps) {
  const tableHtml = apps.length ? `
    <div style="overflow-x:auto;margin-top:14px;">
      <table class="firewall-table">
        <thead>
          <tr>
            <th>${t('python.col_name')}</th>
            <th>${t('python.col_framework')}</th>
            <th>${t('python.col_port')}</th>
            <th>${t('python.col_status')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${apps.map(pythonAppRow).join('')}</tbody>
      </table>
    </div>
  ` : `<div class="empty-state">${t('python.empty_apps')}</div>`;

  return `
    <h3 style="margin:0 0 4px;font-size:15px;">${t('python.apps_list_title')}</h3>
    ${tableHtml}
    <div style="font-size:12px;color:var(--muted);margin-top:14px;">${t('python.reverseproxy_hint')}</div>
  `;
}

function pythonHelpCardHtml() {
  const sections = PYTHON_FRAMEWORKS.map((fw) => `
    <div>
      <h4 style="margin:0 0 4px;font-size:14px;">${t(`python.framework_${fw}`)}</h4>
      <p style="margin:0;color:var(--muted);font-size:13px;">${t(`python.help_${fw}`)}</p>
    </div>
  `).join('');

  return `
    <h3 style="margin:0 0 4px;font-size:15px;">${t('python.help_title')}</h3>
    <div style="display:flex;flex-direction:column;gap:14px;margin-top:10px;">
      ${sections}
    </div>
  `;
}

function renderPythonSection(versions, apps, portInfo) {
  return `
    <div style="display:grid;grid-template-columns:minmax(0, 1fr) minmax(0, 1fr);gap:16px;width:100%;">
      <div class="system-info-card" style="max-width:none;width:100%;box-sizing:border-box;">
        ${pythonAppsFormCardHtml(versions, portInfo)}
      </div>
      <div class="system-info-card" id="python-apps-list-card" style="max-width:none;width:100%;box-sizing:border-box;">
        ${pythonAppsListCardHtml(apps)}
      </div>
    </div>
    <div class="system-info-card" style="margin-top:16px;width:100%;box-sizing:border-box;">
      ${pythonHelpCardHtml()}
    </div>
  `;
}

function wirePythonCreateForm(content) {
  const portCheckBtn = document.getElementById('python-port-check-btn');
  if (portCheckBtn) {
    portCheckBtn.onclick = async () => {
      const portInput = document.getElementById('python-new-port');
      const portMsgEl = document.getElementById('python-port-msg');
      const portValue = portInput.value.trim();
      portCheckBtn.disabled = true;
      portMsgEl.textContent = '';
      portMsgEl.className = 'action-msg';
      try {
        const query = portValue ? `?port=${encodeURIComponent(portValue)}` : '';
        const result = await api('GET', `/python/free-port${query}`);
        portMsgEl.textContent = `${result.port}: ${result.free ? t('python.port_free') : t('python.port_taken')}`;
        portMsgEl.className = `action-msg ${result.free ? 'success' : 'error'}`;
      } catch (e) {
        portMsgEl.textContent = e.message;
        portMsgEl.className = 'action-msg error';
      } finally {
        portCheckBtn.disabled = false;
      }
    };
  }

  const createBtn = document.getElementById('python-create-app-btn');
  if (!createBtn) return;
  createBtn.onclick = async () => {
    const slug = document.getElementById('python-new-slug').value.trim();
    const pythonId = document.getElementById('python-new-version').value;
    const framework = document.getElementById('python-new-framework').value;
    const port = document.getElementById('python-new-port').value;
    const msgEl = document.getElementById('python-create-msg');
    createBtn.disabled = true;
    msgEl.textContent = t('python.creating_app');
    msgEl.className = 'action-msg';
    try {
      await api('POST', '/python/apps', { slug, pythonId, framework, port });
      await refreshPythonTab(content);
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
      createBtn.disabled = false;
    }
  };
}

function rerenderPythonAppsList(content) {
  const card = document.getElementById('python-apps-list-card');
  if (card) card.innerHTML = pythonAppsListCardHtml(pythonAppsCache);
  wirePythonAppsList(content);
}

function wirePythonAppsList(content) {
  content.querySelectorAll('[data-app-start]').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = t('python.starting');
      try {
        await api('POST', `/python/apps/${btn.dataset.appStart}/start`, { port: btn.dataset.appPort });
        await refreshPythonTab(content);
      } catch (e) {
        window.alert(e.message);
        btn.disabled = false;
        btn.textContent = t('python.start_button');
      }
    };
  });

  content.querySelectorAll('[data-app-stop]').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = t('python.stopping');
      try {
        await api('POST', `/python/apps/${btn.dataset.appStop}/stop`);
        await refreshPythonTab(content);
      } catch (e) {
        window.alert(e.message);
        btn.disabled = false;
        btn.textContent = t('python.stop_button');
      }
    };
  });

  content.querySelectorAll('[data-app-delete]').forEach((btn) => {
    btn.onclick = async () => {
      if (!window.confirm(t('python.confirm_delete_app', { slug: btn.dataset.appDelete }))) return;
      btn.disabled = true;
      try {
        await api('DELETE', `/python/apps/${btn.dataset.appDelete}`);
        if (pythonLogsSlug === btn.dataset.appDelete) { pythonLogsSlug = null; pythonLogsData = null; }
        await refreshPythonTab(content);
      } catch (e) {
        window.alert(e.message);
        btn.disabled = false;
      }
    };
  });

  content.querySelectorAll('[data-app-logs]').forEach((btn) => {
    btn.onclick = async () => {
      const slug = btn.dataset.appLogs;
      if (pythonLogsSlug === slug) {
        pythonLogsSlug = null;
        pythonLogsData = null;
        rerenderPythonAppsList(content);
        return;
      }
      pythonLogsSlug = slug;
      pythonLogsData = null;
      rerenderPythonAppsList(content);
      try {
        pythonLogsData = await api('GET', `/python/apps/${slug}/logs`);
      } catch (e) {
        pythonLogsData = { running: false, logs: [e.message] };
      }
      rerenderPythonAppsList(content);
    };
  });
}

function wirePythonSection(content) {
  wirePythonCreateForm(content);
  wirePythonAppsList(content);
}

async function refreshPythonTab(content) {
  content.innerHTML = `<div class="empty-state">${t('python.loading')}</div>`;
  pythonLogsSlug = null;
  pythonLogsData = null;
  try {
    const [versions, apps, portInfo] = await Promise.all([
      api('GET', '/python/versions'),
      api('GET', '/python/apps'),
      api('GET', '/python/free-port').catch(() => null)
    ]);
    pythonAppsCache = apps;
    content.innerHTML = renderPythonSection(versions, apps, portInfo);
    wirePythonSection(content);
  } catch (e) {
    content.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

const NODE_FRAMEWORKS = ['express', 'fastify', 'koa', 'manual'];

// Stan zakladki trzymany miedzy odswiezeniami - ten sam wzorzec co
// pythonAppsCache/pythonLogsSlug/pythonLogsData, osobny od Pythona.
let nodeAppsCache = [];
let nodeLogsSlug = null;
let nodeLogsData = null;

function nodeAppsFormCardHtml(versions, portInfo) {
  if (versions.length === 0) {
    return `
      <h3 style="margin:0 0 4px;font-size:15px;">${t('node.manage_title')}</h3>
      <div class="empty-state">${t('node.no_versions_hint')}</div>
    `;
  }

  return `
    <h3 style="margin:0 0 4px;font-size:15px;">${t('node.manage_title')}</h3>
    <p style="margin:0 0 16px;color:var(--muted);font-size:13px;">${t('node.manage_description')}</p>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div>
        <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('node.field_name')}</label>
        <input type="text" id="node-new-slug" placeholder="myapp" style="width:100%;box-sizing:border-box;">
        <p style="margin:4px 0 0;color:var(--muted);font-size:11px;">${t('node.name_hint')}</p>
      </div>
      <div>
        <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('node.field_version')}</label>
        <select id="node-new-version" style="width:100%;box-sizing:border-box;">
          ${versions.map((v) => `<option value="${escapeHtml(v.id)}">${escapeHtml(v.version)}</option>`).join('')}
        </select>
      </div>
      <div>
        <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('node.field_framework')}</label>
        <select id="node-new-framework" style="width:100%;box-sizing:border-box;">
          ${NODE_FRAMEWORKS.map((fw) => `<option value="${fw}">${t(`node.framework_${fw}`)}</option>`).join('')}
        </select>
      </div>
      <div>
        <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('node.field_port')}</label>
        <div style="display:flex;gap:8px;">
          <input type="number" id="node-new-port" min="1" max="65535" value="${portInfo && portInfo.free ? escapeHtml(String(portInfo.port)) : ''}" style="flex:1;">
          <button type="button" class="secondary" id="node-port-check-btn">${t('node.check_port_button')}</button>
        </div>
        <p style="margin:4px 0 0;color:var(--muted);font-size:11px;">${t('node.free_port_label')}: ${portInfo ? escapeHtml(String(portInfo.port)) : '-'}</p>
        <div class="action-msg" id="node-port-msg"></div>
      </div>
    </div>
    <button type="button" id="node-create-app-btn" style="margin-top:14px;">${t('node.create_app_button')}</button>
    <div class="action-msg" id="node-create-msg"></div>
  `;
}

function nodeAppRow(item) {
  const isManual = item.framework === 'manual';

  // 'manual' nigdy nie ma uslugi systemd zalozonej przez panel (patrz
  // startApp() w hostingUserNode.js - wprost odrzuca ten framework), wiec
  // running/Uruchom/Zatrzymaj/Logi nie maja tu zastosowania - tylko
  // neutralna etykieta i usuwanie.
  const statusBadge = isManual
    ? `<span class="status-badge inactive">${t('node.manual_status')}</span>`
    : `<span class="status-badge ${item.running ? 'active' : 'inactive'}">${item.running ? t('node.app_status_running') : t('node.app_status_stopped')}</span>`;

  const toggleButtonHtml = item.running
    ? `<button type="button" class="secondary" data-app-stop="${escapeHtml(item.slug)}">${t('node.stop_button')}</button>`
    : `<button type="button" class="secondary" data-app-start="${escapeHtml(item.slug)}" data-app-port="${item.port}">${t('node.start_button')}</button>`;

  const actionsHtml = isManual
    ? `<button type="button" class="danger" data-app-delete="${escapeHtml(item.slug)}">${t('node.delete_button')}</button>`
    : `
      ${toggleButtonHtml}
      <button type="button" class="secondary" data-app-logs="${escapeHtml(item.slug)}">${t('node.logs_button')}</button>
      <button type="button" class="danger" data-app-delete="${escapeHtml(item.slug)}">${t('node.delete_button')}</button>
    `;

  const logsOpen = !isManual && nodeLogsSlug === item.slug;
  const logsRowHtml = logsOpen ? `
    <tr>
      <td colspan="5">
        <div style="font-size:12px;color:var(--muted);margin-bottom:4px;">${t('node.app_logs_label')}</div>
        ${nodeLogsData
          ? (nodeLogsData.logs.length > 0
              ? `<pre style="margin:0;max-height:160px;overflow:auto;font-size:11px;background:var(--bg-alt, rgba(128,128,128,0.08));padding:8px;border-radius:6px;white-space:pre-wrap;word-break:break-all;">${escapeHtml(nodeLogsData.logs.join('\n'))}</pre>`
              : `<div class="empty-state">${t('node.app_no_logs')}</div>`)
          : `<div class="empty-state">${t('node.loading')}</div>`}
      </td>
    </tr>
  ` : '';

  return `
    <tr>
      <td>${escapeHtml(item.slug)}</td>
      <td>${t(`node.framework_${item.framework}`)}</td>
      <td>${item.port}</td>
      <td>${statusBadge}</td>
      <td style="white-space:nowrap;">
        ${actionsHtml}
      </td>
    </tr>
    ${logsRowHtml}
  `;
}

function nodeAppsListCardHtml(apps) {
  const tableHtml = apps.length ? `
    <div style="overflow-x:auto;margin-top:14px;">
      <table class="firewall-table">
        <thead>
          <tr>
            <th>${t('node.col_name')}</th>
            <th>${t('node.col_framework')}</th>
            <th>${t('node.col_port')}</th>
            <th>${t('node.col_status')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${apps.map(nodeAppRow).join('')}</tbody>
      </table>
    </div>
  ` : `<div class="empty-state">${t('node.empty_apps')}</div>`;

  return `
    <h3 style="margin:0 0 4px;font-size:15px;">${t('node.apps_list_title')}</h3>
    ${tableHtml}
    <div style="font-size:12px;color:var(--muted);margin-top:14px;">${t('node.reverseproxy_hint')}</div>
  `;
}

function nodeHelpCardHtml() {
  const sections = NODE_FRAMEWORKS.map((fw) => `
    <div>
      <h4 style="margin:0 0 4px;font-size:14px;">${t(`node.framework_${fw}`)}</h4>
      <p style="margin:0;color:var(--muted);font-size:13px;">${t(`node.help_${fw}`)}</p>
    </div>
  `).join('');

  return `
    <h3 style="margin:0 0 4px;font-size:15px;">${t('node.help_title')}</h3>
    <div style="display:flex;flex-direction:column;gap:14px;margin-top:10px;">
      ${sections}
    </div>
  `;
}

function renderNodeSection(versions, apps, portInfo) {
  return `
    <div style="display:grid;grid-template-columns:minmax(0, 1fr) minmax(0, 1fr);gap:16px;width:100%;">
      <div class="system-info-card" style="max-width:none;width:100%;box-sizing:border-box;">
        ${nodeAppsFormCardHtml(versions, portInfo)}
      </div>
      <div class="system-info-card" id="node-apps-list-card" style="max-width:none;width:100%;box-sizing:border-box;">
        ${nodeAppsListCardHtml(apps)}
      </div>
    </div>
    <div class="system-info-card" style="margin-top:16px;width:100%;box-sizing:border-box;">
      ${nodeHelpCardHtml()}
    </div>
  `;
}

function wireNodeCreateForm(content) {
  const portCheckBtn = document.getElementById('node-port-check-btn');
  if (portCheckBtn) {
    portCheckBtn.onclick = async () => {
      const portInput = document.getElementById('node-new-port');
      const portMsgEl = document.getElementById('node-port-msg');
      const portValue = portInput.value.trim();
      portCheckBtn.disabled = true;
      portMsgEl.textContent = '';
      portMsgEl.className = 'action-msg';
      try {
        const query = portValue ? `?port=${encodeURIComponent(portValue)}` : '';
        const result = await api('GET', `/node/free-port${query}`);
        portMsgEl.textContent = `${result.port}: ${result.free ? t('node.port_free') : t('node.port_taken')}`;
        portMsgEl.className = `action-msg ${result.free ? 'success' : 'error'}`;
      } catch (e) {
        portMsgEl.textContent = e.message;
        portMsgEl.className = 'action-msg error';
      } finally {
        portCheckBtn.disabled = false;
      }
    };
  }

  const createBtn = document.getElementById('node-create-app-btn');
  if (!createBtn) return;
  createBtn.onclick = async () => {
    const slug = document.getElementById('node-new-slug').value.trim();
    const nodeId = document.getElementById('node-new-version').value;
    const framework = document.getElementById('node-new-framework').value;
    const port = document.getElementById('node-new-port').value;
    const msgEl = document.getElementById('node-create-msg');
    createBtn.disabled = true;
    msgEl.textContent = t('node.creating_app');
    msgEl.className = 'action-msg';
    try {
      await api('POST', '/node/apps', { slug, nodeId, framework, port });
      await refreshNodeTab(content);
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
      createBtn.disabled = false;
    }
  };
}

function rerenderNodeAppsList(content) {
  const card = document.getElementById('node-apps-list-card');
  if (card) card.innerHTML = nodeAppsListCardHtml(nodeAppsCache);
  wireNodeAppsList(content);
}

function wireNodeAppsList(content) {
  content.querySelectorAll('[data-app-start]').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = t('node.starting');
      try {
        await api('POST', `/node/apps/${btn.dataset.appStart}/start`, { port: btn.dataset.appPort });
        await refreshNodeTab(content);
      } catch (e) {
        window.alert(e.message);
        btn.disabled = false;
        btn.textContent = t('node.start_button');
      }
    };
  });

  content.querySelectorAll('[data-app-stop]').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = t('node.stopping');
      try {
        await api('POST', `/node/apps/${btn.dataset.appStop}/stop`);
        await refreshNodeTab(content);
      } catch (e) {
        window.alert(e.message);
        btn.disabled = false;
        btn.textContent = t('node.stop_button');
      }
    };
  });

  content.querySelectorAll('[data-app-delete]').forEach((btn) => {
    btn.onclick = async () => {
      if (!window.confirm(t('node.confirm_delete_app', { slug: btn.dataset.appDelete }))) return;
      btn.disabled = true;
      try {
        await api('DELETE', `/node/apps/${btn.dataset.appDelete}`);
        if (nodeLogsSlug === btn.dataset.appDelete) { nodeLogsSlug = null; nodeLogsData = null; }
        await refreshNodeTab(content);
      } catch (e) {
        window.alert(e.message);
        btn.disabled = false;
      }
    };
  });

  content.querySelectorAll('[data-app-logs]').forEach((btn) => {
    btn.onclick = async () => {
      const slug = btn.dataset.appLogs;
      if (nodeLogsSlug === slug) {
        nodeLogsSlug = null;
        nodeLogsData = null;
        rerenderNodeAppsList(content);
        return;
      }
      nodeLogsSlug = slug;
      nodeLogsData = null;
      rerenderNodeAppsList(content);
      try {
        nodeLogsData = await api('GET', `/node/apps/${slug}/logs`);
      } catch (e) {
        nodeLogsData = { running: false, logs: [e.message] };
      }
      rerenderNodeAppsList(content);
    };
  });
}

function wireNodeSection(content) {
  wireNodeCreateForm(content);
  wireNodeAppsList(content);
}

async function refreshNodeTab(content) {
  content.innerHTML = `<div class="empty-state">${t('node.loading')}</div>`;
  nodeLogsSlug = null;
  nodeLogsData = null;
  try {
    const [versions, apps, portInfo] = await Promise.all([
      api('GET', '/node/versions'),
      api('GET', '/node/apps'),
      api('GET', '/node/free-port').catch(() => null)
    ]);
    nodeAppsCache = apps;
    content.innerHTML = renderNodeSection(versions, apps, portInfo);
    wireNodeSection(content);
  } catch (e) {
    content.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

// SSH - lewy kafelek: dane polaczenia (host/port/user, realne - host to
// publiczny IP serwera, port to AKTUALNY port SSH z panelu admina, patrz
// getConnectionInfo w hostingUserSsh.js) + rozwijana pomoc z gotowymi
// komendami. Prawy kafelek: zarzadzanie kluczami publicznymi -
// standardowy ~/.ssh/authorized_keys, "Nazwa" klucza to natywny
// komentarz OpenSSH na koncu linii, bez osobnego magazynu metadanych.
function sshConnectionCardHtml(connection) {
  const sshCmd = `ssh -p ${connection.port} ${connection.username}@${connection.host}`;
  const sftpCmd = `sftp -P ${connection.port} ${connection.username}@${connection.host}`;

  return `
    <h3 style="margin:0 0 4px;font-size:15px;">${t('ssh.connection_title')}</h3>
    <p style="margin:0 0 16px;color:var(--muted);font-size:13px;">${t('ssh.connection_description')}</p>
    <div class="info-grid">
      <div class="info-label">${t('ssh.field_host')}</div><div class="info-value" style="font-family:var(--mono);">${escapeHtml(connection.host)}</div>
      <div class="info-label">${t('ssh.field_port')}</div><div class="info-value" style="font-family:var(--mono);">${connection.port}</div>
      <div class="info-label">${t('ssh.field_username')}</div><div class="info-value" style="font-family:var(--mono);">${escapeHtml(connection.username)}</div>
    </div>
    <button type="button" class="secondary" id="ssh-help-toggle" style="margin-top:14px;">${t('ssh.help_toggle')}</button>
    <div id="ssh-help-content" style="display:none;margin-top:12px;font-size:13px;">
      <div style="color:var(--muted);margin-bottom:4px;">SSH:</div>
      <div style="font-family:var(--mono);background:var(--bg);padding:8px;border-radius:6px;word-break:break-all;">${escapeHtml(sshCmd)}</div>
      <div style="color:var(--muted);margin:10px 0 4px;">SFTP:</div>
      <div style="font-family:var(--mono);background:var(--bg);padding:8px;border-radius:6px;word-break:break-all;">${escapeHtml(sftpCmd)}</div>
    </div>
  `;
}

function sshKeyRow(key) {
  const preview = key.keyData.length > 28 ? `${key.keyData.slice(0, 16)}...${key.keyData.slice(-8)}` : key.keyData;
  return `
    <tr>
      <td>${escapeHtml(key.comment || '-')}</td>
      <td>${escapeHtml(key.type)}</td>
      <td style="font-family:var(--mono);">${escapeHtml(preview)}</td>
      <td><button type="button" class="danger" data-ssh-key-delete="${escapeHtml(key.keyData)}">${t('ssh.delete')}</button></td>
    </tr>
  `;
}

function sshKeysCardHtml(keys) {
  const rows = keys.length
    ? keys.map(sshKeyRow).join('')
    : `<tr><td colspan="4" style="text-align:center;color:var(--muted);">${t('ssh.keys_empty')}</td></tr>`;

  return `
    <h3 style="margin:0 0 4px;font-size:15px;">${t('ssh.keys_title')}</h3>
    <p style="margin:0 0 16px;color:var(--muted);font-size:13px;">${t('ssh.keys_description')}</p>

    <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('ssh.field_name')}</label>
    <input type="text" id="ssh-key-name" maxlength="100" placeholder="${t('ssh.name_placeholder')}" style="margin-bottom:10px;">

    <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('ssh.field_public_key')}</label>
    <textarea id="ssh-key-value" rows="3" placeholder="ssh-rsa AAAA... ${t('ssh.key_placeholder_or')} ssh-ed25519 AAAA..." style="width:100%;font-family:var(--mono);font-size:12px;resize:vertical;margin-bottom:6px;"></textarea>
    <div style="font-size:12px;color:var(--muted);margin-bottom:14px;">${t('ssh.key_hint')}</div>

    <button type="button" id="ssh-key-add-btn">${t('ssh.add_button')}</button>
    <div class="action-msg" id="ssh-msg"></div>

    <div style="overflow-x:auto;margin-top:16px;">
      <table class="firewall-table">
        <thead>
          <tr>
            <th>${t('ssh.col_name')}</th>
            <th>${t('ssh.col_type')}</th>
            <th>${t('ssh.col_key')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderSshSection(data) {
  return `
    <div style="display:grid;grid-template-columns:minmax(0, 1fr) minmax(0, 1fr);gap:16px;width:100%;">
      <div class="system-info-card" style="max-width:none;width:100%;box-sizing:border-box;">
        ${sshConnectionCardHtml(data.connection)}
      </div>
      <div class="system-info-card" style="max-width:none;width:100%;box-sizing:border-box;">
        ${sshKeysCardHtml(data.keys)}
      </div>
    </div>
  `;
}

function wireSshSection(content) {
  const helpToggle = document.getElementById('ssh-help-toggle');
  if (helpToggle) {
    helpToggle.onclick = () => {
      const helpContent = document.getElementById('ssh-help-content');
      helpContent.style.display = helpContent.style.display === 'none' ? 'block' : 'none';
    };
  }

  content.querySelectorAll('[data-ssh-key-delete]').forEach((btn) => {
    btn.onclick = async () => {
      if (!window.confirm(t('ssh.confirm_delete'))) return;
      const msgEl = document.getElementById('ssh-msg');
      btn.disabled = true;
      try {
        await api('POST', '/ssh/keys/delete', { keyData: btn.dataset.sshKeyDelete });
        await refreshSshTab(content);
      } catch (e) {
        if (msgEl) { msgEl.textContent = e.message; msgEl.className = 'action-msg error'; }
        btn.disabled = false;
      }
    };
  });

  const addBtn = document.getElementById('ssh-key-add-btn');
  if (addBtn) {
    addBtn.onclick = async () => {
      const name = document.getElementById('ssh-key-name').value;
      const publicKey = document.getElementById('ssh-key-value').value;
      const msgEl = document.getElementById('ssh-msg');
      msgEl.textContent = '';
      msgEl.className = 'action-msg';
      addBtn.disabled = true;
      try {
        await api('POST', '/ssh/keys', { name, publicKey });
        await refreshSshTab(content);
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
        addBtn.disabled = false;
      }
    };
  }
}

async function refreshSshTab(content) {
  content.innerHTML = `<div class="empty-state">${t('ssh.loading')}</div>`;
  try {
    const data = await api('GET', '/ssh');
    content.innerHTML = renderSshSection(data);
    wireSshSection(content);
  } catch (e) {
    content.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

// Strony - dwa klocki obok siebie (ten sam wzorzec co Bazy/Redis/SSH) +
// TRZECI, pelnoszerokosciowy klocek POD nimi, ktory pojawia sie tylko
// podczas edycji (patrz renderSitesSection/siteConfigEditorHtml):
//   1) lewy: formularz "dodaj strone" - domena bez www. (kierunek
//      przekierowania www<->apex to osobne pole, wybor klikany - radio,
//      NIE rozwijalna lista - patrz siteRedirectRadios/siteTemplateRadios;
//      hostingUserSites.js: buildSiteBlock), Z WYJATKIEM trzeciej opcji
//      "Bez przekierowania" (redirectMode 'none') - tam domena to jeden,
//      samodzielny adres i MOZE zaczynac sie od "www." (serwowana jest
//      TYLKO ta jedna wersja, bez matchera/redir w bloku).
//      Szablony PHP/WordPress sa na
//      razie SZKIELETEM - wybieralne, ale generuja ten sam statyczny blok
//      co HTML (patrz komentarz przy TEMPLATES w hostingUserSites.js).
//      REVERSE PROXY jest jedynym poza HTML, ktory realnie dziala - pole
//      na port (zawsze 127.0.0.1:<port>, user nie podaje calego hosta) +
//      podpowiedz tekstowa (venv/gunicorn/uvicorn/systemd --user dla
//      Pythona, `npm start` dla Node) - jeden generyczny szablon zamiast
//      osobnych wpisow per framework/jezyk (Django/Next/Ghost/...).
//   2) prawy: lista istniejacych stron z akcjami (Start/Stop, Usun -
//      NIEODWRACALNIE kasuje tez pliki w ~/domains, patrz
//      hosting-user-site.sh) + licznik uzyto/limit z pakietu (maxDomains)
//      na gorze, jak w Bazach.
//   3) dolny (pelna szerokosc, NIE w prawym kafelku, NIE wiersz tabeli) -
//      pokazuje sie po kliknieciu "Edytuj" na ktorejs stronie: pelny
//      edytor surowego configu Caddy (get/check/apply w
//      hosting-user-site.sh) - sekcja kompresji na gorze tylko
//      wstrzykuje/usuwa linie `encode` (przed `file_server`) w tresci
//      edytora, reszte tresci user edytuje recznie.
const SITE_TEMPLATE_LABELS = {
  html: () => t('sites.template_html'),
  php: () => t('sites.template_php'),
  wordpress: () => t('sites.template_wordpress'),
  reverseproxy: () => t('sites.template_reverseproxy')
};
let siteEditingId = null;
let siteEditingContent = null;

function siteRedirectRadios(name, selected) {
  return `
    <label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:normal;">
      <input type="radio" name="${name}" value="www-to-apex" ${selected === 'www-to-apex' ? 'checked' : ''}>
      ${t('sites.redirect_www_to_apex')}
    </label>
    <label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:normal;">
      <input type="radio" name="${name}" value="apex-to-www" ${selected === 'apex-to-www' ? 'checked' : ''}>
      ${t('sites.redirect_apex_to_www')}
    </label>
    <label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:normal;">
      <input type="radio" name="${name}" value="none" ${selected === 'none' ? 'checked' : ''}>
      ${t('sites.redirect_none')}
    </label>
  `;
}

// "Brak poczty" domyslnie zaznaczony - dodanie strony NIE rejestruje
// domeny jako wirtualnej domeny pocztowej, dopoki user wyraznie tego nie
// zazada (mailVirtual.js addVirtualDomain, patrz createSite w
// hostingUserSites.js - najlepszy wysilek, nie blokuje utworzenia
// strony jesli sie nie powiedzie, np. Poczta nigdy nie zainstalowana).
function siteMailRadios(name, selected) {
  return `
    <label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:normal;">
      <input type="radio" name="${name}" value="none" ${selected === 'none' ? 'checked' : ''}>
      ${t('sites.mail_none')}
    </label>
    <label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:normal;">
      <input type="radio" name="${name}" value="enabled" ${selected === 'enabled' ? 'checked' : ''}>
      ${t('sites.mail_enabled')}
    </label>
  `;
}

// PHP/WORDPRESS/REVERSE PROXY pod HTML (jedna pod druga, nie obok siebie
// w rzedzie) - przy PHP i WORDPRESS rozwijalna lista z wersjami PHP
// faktycznie zainstalowanymi w systemie (ten sam mechanizm co selektor
// PHP dla zadan cron - /cron/php-paths - patrz refreshSitesTab), przy
// REVERSE PROXY pole na port + podpowiedz pod spodem (jedyny szablon poza
// HTML, ktory realnie dziala - patrz buildSiteBlock w
// hostingUserSites.js: PHP/WORDPRESS sa nadal szkieletem).
function siteTemplateRadios(name, selected, phpVersions) {
  const versionOptions = phpVersions.length
    ? phpVersions.map((v) => `<option value="${escapeHtml(v.id)}">${escapeHtml(v.version)}</option>`).join('')
    : `<option value="">-</option>`;

  return ['html', 'php', 'wordpress', 'reverseproxy'].map((key) => {
    let extra = '';
    if (key === 'php' || key === 'wordpress') {
      extra = `<select name="${name}-phpversion-${key}" ${phpVersions.length ? '' : 'disabled'}>${versionOptions}</select>`;
      if (key === 'wordpress') {
        extra += `
          <select name="${name}-wpinstall" style="margin-left:8px;">
            <option value="none">${t('sites.wp_install_none')}</option>
            <option value="en">${t('sites.wp_install_en')}</option>
            <option value="pl">${t('sites.wp_install_pl')}</option>
          </select>
        `;
      }
    } else if (key === 'reverseproxy') {
      extra = `<input type="number" name="${name}-proxyport-${key}" min="1" max="65535" placeholder="${t('sites.template_reverseproxy_port_placeholder')}" style="width:110px;">`;
    }
    return `
      <label style="display:flex;align-items:center;gap:10px;font-size:13px;font-weight:normal;">
        <span style="display:flex;align-items:center;gap:6px;">
          <input type="radio" name="${name}" value="${key}" ${selected === key ? 'checked' : ''}>
          ${SITE_TEMPLATE_LABELS[key]()}
        </span>
        ${extra}
      </label>
      ${key === 'reverseproxy' ? `<p style="margin:0 0 0 24px;color:var(--muted);font-size:11px;">${t('sites.template_reverseproxy_hint')}</p>` : ''}
      ${(key === 'php' || key === 'wordpress') ? `<p style="margin:0 0 0 24px;color:var(--muted);font-size:11px;">${t('sites.template_php_pool_hint')}</p>` : ''}
      ${key === 'wordpress' ? `<p style="margin:0 0 0 24px;color:var(--muted);font-size:11px;">${t('sites.wp_install_hint')}</p>` : ''}
    `;
  }).join('');
}

// Encode dyrektywa Caddy idzie PRZED file_server (np. root / encode /
// file_server) - nie na samej gorze bloku, bo tam sa jeszcze
// matcher/redir/header - gzip zawsze przed zstd, gdy oba wybrane (wymog:
// "gzip zawsze pierwszy jak wystepuja 2"). Brak linii file_server (user
// recznie usunal/przebudowal config) - awaryjnie wstawiamy zaraz po
// otwierajacym "{" pierwszej linii tresci.
function detectCompression(text) {
  const m = /^[ \t]*encode\s+(.+)$/m.exec(text || '');
  if (!m) return { gzip: false, zstd: false };
  const tokens = m[1].trim().split(/\s+/);
  return { gzip: tokens.includes('gzip'), zstd: tokens.includes('zstd') };
}

function applyCompressionToText(text, { gzip, zstd }) {
  const stripped = String(text || '').replace(/^[ \t]*encode\b.*\n?/gm, '');
  const parts = [];
  if (gzip) parts.push('gzip');
  if (zstd) parts.push('zstd');
  if (!parts.length) return stripped;

  const lines = stripped.split('\n');
  const encodeLine = `\tencode ${parts.join(' ')}`;
  const fileServerIdx = lines.findIndex((l) => /^[ \t]*file_server\b/.test(l));
  if (fileServerIdx !== -1) {
    lines.splice(fileServerIdx, 0, encodeLine);
    return lines.join('\n');
  }
  const openIdx = lines.findIndex((l) => l.includes('{'));
  if (openIdx === -1) return `${encodeLine}\n${stripped}`;
  lines.splice(openIdx + 1, 0, encodeLine);
  return lines.join('\n');
}

// Blok naglowkow bezpieczenstwa - ZAWSZE ostatnia sekcja w configu (PO
// log{...}, tuz przed zamykajacym "}" calego site-blocku). Textualna
// pozycja w pliku nie ma znaczenia dla Caddy (adapter caddyfile i tak
// sortuje dyrektywy wg wlasnej, kanonicznej kolejnosci wykonania,
// niezaleznie od kolejnosci w zrodle), wiec to czysto kosmetyczne -
// "ostatnia sekcja" ulatwia czytanie configu userowi. Dwie oddzielne
// dyrektywy `header` w jednym bloku (ta ponizej + istniejace juz
// `header -X-Powered-By` blizej gory z buildSiteBlock) sa poprawna
// skladnia - Caddy wykonuje obie.
// Znaczniki BEGIN/END (jak w caddy-set-performance.sh) - nie samo
// dopasowanie tresci `header {...}` - bo user moze miec WLASNY,
// niezwiazany blok header w configu; markery pozwalaja jednoznacznie
// wlaczyc/wylaczyc/wykryc TYLKO nasz wstrzykniety fragment.
const SECURITY_MARK_START = '# BEGIN caddy-dashboard-security';
const SECURITY_MARK_END = '# END caddy-dashboard-security';

function securityBlockLines() {
  return [
    `\t${SECURITY_MARK_START}`,
    '\theader {',
    '\t\tStrict-Transport-Security "max-age=63072000; includeSubDomains; preload"',
    '\t\tContent-Security-Policy "upgrade-insecure-requests"',
    '\t\tPermissions-Policy "geolocation=(self), microphone=(), camera=(), payment=()"',
    '\t\tReferrer-Policy "strict-origin-when-cross-origin"',
    '\t\tX-Content-Type-Options "nosniff"',
    '\t\tX-Frame-Options "SAMEORIGIN"',
    '\t\tCross-Origin-Opener-Policy "same-origin-allow-popups"',
    '\t\tCross-Origin-Embedder-Policy "unsafe-none"',
    '\t\tX-XSS-Protection "1; mode=block"',
    '\t\tContent-Language "pl-PL"',
    '\t}',
    `\t${SECURITY_MARK_END}`
  ];
}

function detectSecurity(text) {
  return String(text || '').includes(SECURITY_MARK_START);
}

function applySecurityToText(text, enabled) {
  const lines = String(text || '').split('\n');
  const startIdx = lines.findIndex((l) => l.includes(SECURITY_MARK_START));
  const endIdx = lines.findIndex((l) => l.includes(SECURITY_MARK_END));
  const stripped = (startIdx !== -1 && endIdx !== -1 && endIdx >= startIdx)
    ? lines.slice(0, startIdx).concat(lines.slice(endIdx + 1))
    : lines;

  if (!enabled) return stripped.join('\n');

  let closeIdx = -1;
  for (let i = stripped.length - 1; i >= 0; i--) {
    if (stripped[i].trim() === '}') { closeIdx = i; break; }
  }
  const blockLines = securityBlockLines();
  if (closeIdx === -1) return stripped.concat(blockLines).join('\n');
  const withBlock = stripped.slice();
  withBlock.splice(closeIdx, 0, ...blockLines);
  return withBlock.join('\n');
}

// Pelnoszerokosciowa karta POD dwukolumnowa siatka (nie w prawym kafelku
// "Twoje strony" i nie jako wiersz tabeli) - patrz renderSitesSection.
function siteConfigEditorHtml(item) {
  const loading = siteEditingContent === null;
  const compression = loading ? { gzip: false, zstd: false } : detectCompression(siteEditingContent);
  const security = loading ? false : detectSecurity(siteEditingContent);
  const textareaValue = loading ? '' : siteEditingContent;

  return `
    <h3 style="margin:0 0 10px;font-size:15px;">${t('sites.config_title', { domain: escapeHtml(item.domain) })}</h3>
    ${loading ? `<div class="empty-state">${t('sites.config_loading')}</div>` : `
      <div style="margin-bottom:10px;">
        <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('sites.compression_title')}</label>
        <div style="display:flex;gap:16px;flex-wrap:wrap;">
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:normal;">
            <input type="checkbox" id="site-edit-gzip-${item.id}" ${compression.gzip ? 'checked' : ''}>
            ${t('sites.compression_gzip')}
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:normal;">
            <input type="checkbox" id="site-edit-zstd-${item.id}" ${compression.zstd ? 'checked' : ''}>
            ${t('sites.compression_zstd')}
          </label>
        </div>
      </div>
      <div style="margin-bottom:10px;">
        <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('sites.security_title')}</label>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:normal;">
          <input type="checkbox" id="site-edit-security-${item.id}" ${security ? 'checked' : ''}>
          ${t('sites.security_checkbox')}
        </label>
      </div>
      <div style="margin-bottom:6px;">
        <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('sites.config_edit_title')}</label>
        <p style="margin:0 0 6px;font-size:12px;color:var(--muted);">${t('sites.config_edit_hint')}</p>
      </div>
      <textarea id="site-edit-config-${item.id}" rows="16" style="width:100%;font-family:var(--mono);font-size:12px;background:var(--input-bg);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px;box-sizing:border-box;resize:vertical;">${escapeHtml(textareaValue)}</textarea>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
        <button type="button" data-site-check="${item.id}">${t('sites.check_button')}</button>
        <button type="button" data-site-activate="${item.id}">${t('sites.activate_button')}</button>
        <button type="button" class="secondary" data-site-cancel-edit="1">${t('sites.cancel_button')}</button>
      </div>
      <div class="action-msg" id="site-edit-msg-${item.id}"></div>
    `}
  `;
}

function siteRow(item) {
  const statusBadge = `<span class="status-badge ${item.enabled ? 'active' : 'inactive'}">${item.enabled ? t('sites.status_running') : t('sites.status_stopped')}</span>`;
  const templateLabel = (SITE_TEMPLATE_LABELS[item.template] || (() => item.template))();

  return `
    <tr>
      <td>${escapeHtml(item.domain)}</td>
      <td>${escapeHtml(templateLabel)}</td>
      <td>${statusBadge}</td>
      <td style="white-space:nowrap;">
        <button type="button" class="secondary" data-site-edit="${item.id}">${t('sites.edit')}</button>
        ${item.enabled
          ? `<button type="button" class="secondary" data-site-stop="${item.id}">${t('sites.stop')}</button>`
          : `<button type="button" class="secondary" data-site-start="${item.id}">${t('sites.start')}</button>`}
        ${(item.template === 'php' || item.template === 'wordpress')
          ? `<button type="button" class="secondary" data-site-php-restart="${item.id}">${t('sites.php_restart')}</button>`
          : ''}
        <button type="button" class="danger" data-site-delete="${item.id}" data-site-domain="${escapeHtml(item.domain)}">${t('sites.delete')}</button>
      </td>
    </tr>
  `;
}

function sitesManageCardHtml(data, phpVersions) {
  const { items, maxDomains } = data;
  const used = items.length;
  const hasLimit = typeof maxDomains === 'number' && maxDomains > 0;
  const limitReached = hasLimit && used >= maxDomains;

  const formHtml = limitReached ? `
    <div class="empty-state">${t('sites.limit_reached', { limit: maxDomains })}</div>
  ` : `
    <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:10px;">
      <div>
        <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('sites.field_domain')}</label>
        <input type="text" id="site-new-domain" placeholder="${t('sites.domain_placeholder')}" style="width:100%;box-sizing:border-box;">
        <p style="margin:4px 0 0;color:var(--muted);font-size:11px;">${t('sites.domain_hint')}</p>
      </div>
      <div>
        <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('sites.field_redirect')}</label>
        <div style="display:flex;gap:16px;flex-wrap:wrap;">${siteRedirectRadios('site-new-redirect', 'www-to-apex')}</div>
      </div>
      <div>
        <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('sites.field_mail')}</label>
        <div style="display:flex;gap:16px;flex-wrap:wrap;">${siteMailRadios('site-new-mail', 'none')}</div>
        <p style="margin:4px 0 0;color:var(--danger);font-size:11px;">${t('sites.mail_dns_warning')}</p>
        <p style="margin:6px 0 4px;color:var(--muted);font-size:11px;">${t('sites.mail_dns_example_caption')}</p>
        <div style="background:#ffffff;border:1px solid var(--border);border-radius:6px;padding:10px 12px;overflow-x:auto;">
          <table style="border-collapse:collapse;font-family:var(--mono);font-size:12px;color:#1c1d1f;white-space:nowrap;">
            <thead>
              <tr style="color:#6b7078;text-align:left;">
                <th style="padding:0 16px 4px 0;font-weight:normal;">Type</th>
                <th style="padding:0 16px 4px 0;font-weight:normal;">Name</th>
                <th style="padding:0 16px 4px 0;font-weight:normal;">Content</th>
                <th style="padding:0 16px 4px 0;font-weight:normal;">Proxy status</th>
                <th style="padding:0 0 4px;font-weight:normal;">TTL</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="padding:2px 16px 0 0;">A</td>
                <td style="padding:2px 16px 0 0;">mail</td>
                <td style="padding:2px 16px 0 0;">203.0.113.10</td>
                <td style="padding:2px 16px 0 0;">DNS only</td>
                <td style="padding:2px 0 0;">Auto</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('sites.field_template')}</label>
        <div style="display:flex;flex-direction:column;gap:8px;">${siteTemplateRadios('site-new-template', 'html', phpVersions)}</div>
      </div>
      <div><button type="button" id="site-create-btn">${t('sites.add_button')}</button></div>
    </div>
    <div class="action-msg" id="site-msg"></div>
  `;

  return `
    <h3 style="margin:0 0 4px;font-size:15px;">${t('sites.manage_title')}</h3>
    <p style="margin:0 0 16px;color:var(--muted);font-size:13px;">${t('sites.manage_description')}</p>
    ${formHtml}
  `;
}

function sitesListCardHtml(data) {
  const { items, maxDomains } = data;
  const used = items.length;
  const hasLimit = typeof maxDomains === 'number' && maxDomains > 0;
  const percent = hasLimit ? Math.min(100, Math.round((used / maxDomains) * 100)) : 0;
  const valueText = hasLimit ? `${used} / ${maxDomains}` : `${used}`;

  const tableHtml = items.length ? `
    <div style="overflow-x:auto;margin-top:14px;">
      <table class="firewall-table">
        <thead>
          <tr>
            <th>${t('sites.col_domain')}</th>
            <th>${t('sites.col_template')}</th>
            <th>${t('sites.col_status')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${items.map(siteRow).join('')}</tbody>
      </table>
    </div>
  ` : `<div class="empty-state">${t('sites.empty')}</div>`;

  return `
    <h3 style="margin:0 0 4px;font-size:15px;">${t('sites.list_title')}</h3>
    <div class="stat-value" style="margin:6px 0 6px;">${escapeHtml(valueText)}</div>
    <div class="meter-track"><div class="meter-fill ${severity(percent)}" style="width:${percent}%"></div></div>
    ${tableHtml}
  `;
}

function renderSitesSection(data, phpVersions) {
  const editingItem = siteEditingId ? data.items.find((i) => i.id === siteEditingId) : null;
  return `
    <div style="display:grid;grid-template-columns:minmax(0, 1fr) minmax(0, 1fr);gap:16px;width:100%;">
      <div class="system-info-card" style="max-width:none;width:100%;box-sizing:border-box;">
        ${sitesManageCardHtml(data, phpVersions)}
      </div>
      <div class="system-info-card" style="max-width:none;width:100%;box-sizing:border-box;">
        ${sitesListCardHtml(data)}
      </div>
    </div>
    ${editingItem ? `
      <div class="system-info-card" style="margin-top:16px;width:100%;box-sizing:border-box;">
        ${siteConfigEditorHtml(editingItem)}
      </div>
    ` : ''}
  `;
}

function wireSitesSection(content) {
  content.querySelectorAll('[data-site-edit]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.siteEdit;
      btn.disabled = true;
      try {
        const { content: cfg } = await api('GET', `/sites/${id}/config`);
        siteEditingId = id;
        siteEditingContent = cfg;
        await refreshSitesTab(content);
      } catch (e) {
        window.alert(e.message);
        btn.disabled = false;
      }
    };
  });

  content.querySelectorAll('[data-site-cancel-edit]').forEach((btn) => {
    btn.onclick = () => { siteEditingId = null; siteEditingContent = null; refreshSitesTab(content); };
  });

  content.querySelectorAll('[data-site-check]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.siteCheck;
      const textarea = document.getElementById(`site-edit-config-${id}`);
      const msgEl = document.getElementById(`site-edit-msg-${id}`);
      btn.disabled = true;
      msgEl.textContent = t('sites.checking');
      msgEl.className = 'action-msg';
      try {
        const result = await api('POST', `/sites/${id}/config/check`, { content: textarea.value });
        msgEl.textContent = result.message;
        msgEl.className = 'action-msg success';
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
      } finally {
        btn.disabled = false;
      }
    };
  });

  content.querySelectorAll('[data-site-activate]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.siteActivate;
      const textarea = document.getElementById(`site-edit-config-${id}`);
      const msgEl = document.getElementById(`site-edit-msg-${id}`);
      btn.disabled = true;
      msgEl.textContent = t('sites.activating');
      msgEl.className = 'action-msg';
      try {
        await api('PUT', `/sites/${id}/config`, { content: textarea.value });
        siteEditingId = null;
        siteEditingContent = null;
        await refreshSitesTab(content);
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
        btn.disabled = false;
      }
    };
  });

  content.querySelectorAll('[id^="site-edit-gzip-"], [id^="site-edit-zstd-"]').forEach((cb) => {
    cb.onchange = () => {
      const id = cb.id.replace(/^site-edit-(gzip|zstd)-/, '');
      const gzipCb = document.getElementById(`site-edit-gzip-${id}`);
      const zstdCb = document.getElementById(`site-edit-zstd-${id}`);
      const textarea = document.getElementById(`site-edit-config-${id}`);
      textarea.value = applyCompressionToText(textarea.value, { gzip: gzipCb.checked, zstd: zstdCb.checked });
    };
  });

  content.querySelectorAll('[id^="site-edit-security-"]').forEach((cb) => {
    cb.onchange = () => {
      const id = cb.id.replace(/^site-edit-security-/, '');
      const textarea = document.getElementById(`site-edit-config-${id}`);
      textarea.value = applySecurityToText(textarea.value, cb.checked);
    };
  });

  content.querySelectorAll('[data-site-start]').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await api('POST', `/sites/${btn.dataset.siteStart}/start`);
        await refreshSitesTab(content);
      } catch (e) {
        window.alert(e.message);
        btn.disabled = false;
      }
    };
  });

  content.querySelectorAll('[data-site-stop]').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await api('POST', `/sites/${btn.dataset.siteStop}/stop`);
        await refreshSitesTab(content);
      } catch (e) {
        window.alert(e.message);
        btn.disabled = false;
      }
    };
  });

  content.querySelectorAll('[data-site-delete]').forEach((btn) => {
    btn.onclick = async () => {
      if (!window.confirm(t('sites.confirm_delete', { domain: btn.dataset.siteDomain }))) return;
      btn.disabled = true;
      try {
        await api('DELETE', `/sites/${btn.dataset.siteDelete}`);
        await refreshSitesTab(content);
      } catch (e) {
        window.alert(e.message);
        btn.disabled = false;
      }
    };
  });

  content.querySelectorAll('[data-site-php-restart]').forEach((btn) => {
    btn.onclick = async () => {
      if (!window.confirm(t('sites.php_restart_confirm'))) return;
      btn.disabled = true;
      try {
        await api('POST', `/sites/${btn.dataset.sitePhpRestart}/php/restart`);
        window.alert(t('sites.php_restart_success'));
      } catch (e) {
        window.alert(e.message);
      } finally {
        btn.disabled = false;
      }
    };
  });

  const createBtn = document.getElementById('site-create-btn');
  if (createBtn) {
    createBtn.onclick = async () => {
      const domainInput = document.getElementById('site-new-domain');
      const templateSelected = content.querySelector('input[name="site-new-template"]:checked');
      const templateValue = templateSelected ? templateSelected.value : 'html';
      const phpVersionSelect = (templateValue === 'php' || templateValue === 'wordpress')
        ? content.querySelector(`select[name="site-new-template-phpversion-${templateValue}"]`)
        : null;
      const wpInstallSelect = templateValue === 'wordpress'
        ? content.querySelector('select[name="site-new-template-wpinstall"]')
        : null;
      const proxyPortInput = templateValue === 'reverseproxy'
        ? content.querySelector('input[name="site-new-template-proxyport-reverseproxy"]')
        : null;
      const selected = content.querySelector('input[name="site-new-redirect"]:checked');
      const mailSelected = content.querySelector('input[name="site-new-mail"]:checked');
      const msgEl = document.getElementById('site-msg');
      msgEl.textContent = '';
      msgEl.className = 'action-msg';
      createBtn.disabled = true;
      try {
        const result = await api('POST', '/sites', {
          domain: domainInput.value.trim(),
          redirectMode: selected ? selected.value : 'www-to-apex',
          template: templateValue,
          phpVersion: phpVersionSelect ? phpVersionSelect.value : undefined,
          wpInstall: wpInstallSelect ? wpInstallSelect.value : undefined,
          proxyPort: proxyPortInput ? proxyPortInput.value : undefined,
          mailEnabled: !!mailSelected && mailSelected.value === 'enabled'
        });
        if (result && result.mailWarning) window.alert(result.mailWarning);
        await refreshSitesTab(content);
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
        createBtn.disabled = false;
      }
    };
  }
}

async function refreshSitesTab(content) {
  content.innerHTML = `<div class="empty-state">${t('sites.loading')}</div>`;
  try {
    // Wersje PHP dla selektora "Dodaj strone" - Runtime Manager
    // (/php-versions, juz {id, version}), NIE /cron/php-paths (to inny,
    // niezalezny mechanizm dla zakladki Cron - zostaje bez zmian, wlasny
    // cronPhpPathsCache).
    const [data, phpVersions] = await Promise.all([
      api('GET', '/sites'),
      api('GET', '/php-versions')
    ]);
    content.innerHTML = renderSitesSection(data, phpVersions);
    wireSitesSection(content);
  } catch (e) {
    content.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

// Backup (restic) - ostatni z 5 pierwotnych szkieletow, trzy PELNOSZEROKO-
// SCIOWE klocki jedne pod drugim (nie 2-kolumnowy rzad - kazda sekcja jest
// zbyt bogata w tresc na 50/50): Snapshoty i przywracanie, Ustawienia
// (repozytorium), Zadania (co+kiedy+retencja). Kluczowa decyzja z planu:
// harmonogram/enabled zadania zyje w PRAWDZIWYM crontabie usera (wlasny
// marker "# cd-backup:", zupelnie niezalezny od "# cd-cron:" zakladki
// Cron - patrz hostingUserBackup.js), a nazwa/zrodla/retencja w JSON,
// polaczone po id przez backend - front dostaje juz gotowy, scalony
// obiekt (GET /backup/jobs) i o tym rozdziale nie musi wiedziec.
//
// Strony z template 'reverseproxy' NIE MAJA katalogu public/ (proxuja do
// lokalnego portu) - odfiltrowane z listy checkboxow w formularzu zadania
// (backend i tak by je odrzucil, ale user nie powinien nawet widziec
// niepasujacej opcji).
let backupJobEditingId = null;

function backupSnapshotRow(snap) {
  return `
    <tr>
      <td style="font-family:var(--mono);">${escapeHtml(snap.shortId || snap.id || '-')}</td>
      <td>${escapeHtml(snap.time ? new Date(snap.time).toLocaleString() : '-')}</td>
      <td style="white-space:normal;word-break:break-all;">${escapeHtml((snap.paths || []).join(', '))}</td>
      <td><button type="button" class="secondary" data-backup-restore="${escapeHtml(snap.id)}">${t('backup.restore_button')}</button></td>
    </tr>
  `;
}

function backupSnapshotsCardHtml(repo, snapshots) {
  if (!repo) {
    return `
      <h3 style="margin:0 0 4px;font-size:15px;">${t('backup.snapshots_title')}</h3>
      <div class="empty-state">${t('backup.snapshots_need_repo')}</div>
    `;
  }
  const rows = snapshots.length
    ? snapshots.map(backupSnapshotRow).join('')
    : `<tr><td colspan="4" style="text-align:center;color:var(--muted);">${t('backup.snapshots_empty')}</td></tr>`;

  return `
    <h3 style="margin:0 0 4px;font-size:15px;">${t('backup.snapshots_title')}</h3>
    <p style="margin:0 0 16px;color:var(--muted);font-size:13px;">${t('backup.snapshots_description')}</p>
    <button type="button" class="secondary" id="backup-snapshots-refresh-btn">${t('backup.refresh_button')}</button>
    <div class="action-msg" id="backup-restore-msg"></div>
    <div style="overflow-x:auto;margin-top:14px;">
      <table class="firewall-table">
        <thead>
          <tr>
            <th>${t('backup.col_snapshot_id')}</th>
            <th>${t('backup.col_time')}</th>
            <th>${t('backup.col_paths')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// Cztery typy repozytorium, jedno pole `<select>`, WSZYSTKIE grupy pol
// zawsze w DOM (tylko show/hide przez JS przy zmianie selecta, ten sam
// wzorzec co checkbox hasla w Redis) - prostsze niz przebudowywanie DOM
// przy kazdej zmianie typu, i pozwala userowi wpisac dane dla kilku
// typow na zapas bez ich utraty przy przelaczaniu (zapisywany jest tylko
// AKTUALNIE wybrany typ).
function backupSettingsCardHtml(repo) {
  const type = repo?.type || 'local';
  const creds = repo?.credentials || {};
  const statusBadge = repo
    ? `<span class="status-badge active">${t('backup.status_initialized')}</span>`
    : `<span class="status-badge inactive">${t('backup.status_not_initialized')}</span>`;

  const typeOptions = ['local', 's3', 'b2', 'sftp']
    .map((v) => `<option value="${v}" ${type === v ? 'selected' : ''}>${t('backup.repo_type_' + v)}</option>`)
    .join('');

  const fieldStyle = (v) => `display:${type === v ? 'block' : 'none'};margin-bottom:10px;`;

  return `
    <h3 style="margin:0 0 4px;font-size:15px;">${t('backup.settings_title')} ${statusBadge}</h3>
    <p style="margin:0 0 16px;color:var(--muted);font-size:13px;">${t('backup.settings_description')}</p>

    <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('backup.field_repo_type')}</label>
    <select id="backup-repo-type" style="margin-bottom:14px;">${typeOptions}</select>

    <div data-backup-fields="local" style="${fieldStyle('local')}">
      <p style="margin:0;font-size:12px;color:var(--muted);">${t('backup.repo_type_local_hint')}</p>
    </div>

    <div data-backup-fields="s3" style="${fieldStyle('s3')}">
      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('backup.field_bucket')}</label>
      <input type="text" id="backup-s3-bucket" value="${escapeHtml(creds.bucket || '')}" style="margin-bottom:8px;width:100%;box-sizing:border-box;">
      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('backup.field_endpoint')}</label>
      <input type="text" id="backup-s3-endpoint" placeholder="s3.amazonaws.com" value="${escapeHtml(creds.endpoint || '')}" style="margin-bottom:8px;width:100%;box-sizing:border-box;">
      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('backup.field_region')}</label>
      <input type="text" id="backup-s3-region" value="${escapeHtml(creds.region || '')}" style="margin-bottom:8px;width:100%;box-sizing:border-box;">
      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('backup.field_access_key')}</label>
      <input type="text" id="backup-s3-access-key" value="${escapeHtml(creds.accessKeyId || '')}" style="margin-bottom:8px;width:100%;box-sizing:border-box;font-family:var(--mono);">
      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('backup.field_secret_key')}</label>
      <input type="text" id="backup-s3-secret-key" value="${escapeHtml(creds.secretAccessKey || '')}" style="width:100%;box-sizing:border-box;font-family:var(--mono);">
    </div>

    <div data-backup-fields="b2" style="${fieldStyle('b2')}">
      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('backup.field_b2_bucket')}</label>
      <input type="text" id="backup-b2-bucket" value="${escapeHtml(creds.bucket || '')}" style="margin-bottom:8px;width:100%;box-sizing:border-box;">
      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('backup.field_b2_account_id')}</label>
      <input type="text" id="backup-b2-account-id" value="${escapeHtml(creds.accountId || '')}" style="margin-bottom:8px;width:100%;box-sizing:border-box;font-family:var(--mono);">
      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('backup.field_b2_account_key')}</label>
      <input type="text" id="backup-b2-account-key" value="${escapeHtml(creds.accountKey || '')}" style="width:100%;box-sizing:border-box;font-family:var(--mono);">
    </div>

    <div data-backup-fields="sftp" style="${fieldStyle('sftp')}">
      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('backup.field_sftp_host')}</label>
      <input type="text" id="backup-sftp-host" value="${escapeHtml(creds.host || '')}" style="margin-bottom:8px;width:100%;box-sizing:border-box;">
      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('backup.field_sftp_port')}</label>
      <input type="number" id="backup-sftp-port" min="1" max="65535" value="${escapeHtml(creds.port || 22)}" style="margin-bottom:8px;width:120px;">
      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('backup.field_sftp_username')}</label>
      <input type="text" id="backup-sftp-username" value="${escapeHtml(creds.sftpUser || '')}" style="margin-bottom:8px;width:100%;box-sizing:border-box;">
      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('backup.field_sftp_path')}</label>
      <input type="text" id="backup-sftp-path" value="${escapeHtml(creds.path || '')}" style="margin-bottom:8px;width:100%;box-sizing:border-box;font-family:var(--mono);">
      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('backup.field_sftp_private_key')}</label>
      <textarea id="backup-sftp-private-key" rows="4" style="width:100%;box-sizing:border-box;font-family:var(--mono);font-size:12px;">${escapeHtml(creds.privateKey || '')}</textarea>
    </div>

    <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('backup.field_password')}</label>
    <div style="display:flex;gap:8px;margin-bottom:14px;">
      <input type="password" id="backup-repo-password" value="${escapeHtml(repo?.resticPassword || '')}" style="flex:1;font-family:var(--mono);">
      <button type="button" class="secondary" id="backup-repo-password-toggle-btn" title="${t('backup.toggle_password')}">${EYE_ICON_SVG}</button>
      <button type="button" class="secondary" id="backup-repo-password-generate-btn">${t('backup.generate_button')}</button>
    </div>

    <button type="button" id="backup-repo-save-btn">${t('backup.save_button')}</button>
    <div class="action-msg" id="backup-repo-msg"></div>
  `;
}

function backupJobRow(job, sitesById, dbsById) {
  const siteNames = (job.siteIds || []).map((id) => sitesById.get(id)?.domain || id);
  const dbNames = (job.databaseIds || []).map((id) => dbsById.get(id)?.dbName || id);
  const sourcesText = [...siteNames, ...dbNames].join(', ') || '-';
  const lastRunText = job.lastRunAt
    ? `${new Date(job.lastRunAt).toLocaleString()} - ${job.lastRunStatus === 'success' ? t('backup.run_status_success') : t('backup.run_status_error')}`
    : t('backup.run_status_never');

  return `
    <tr>
      <td>${escapeHtml(job.name || '-')}</td>
      <td style="font-family:var(--mono);">${escapeHtml(job.schedule)}</td>
      <td style="white-space:normal;">${escapeHtml(sourcesText)}</td>
      <td>${job.keepLast}</td>
      <td><span class="status-badge ${job.enabled ? 'active' : 'inactive'}">${job.enabled ? t('backup.status_active') : t('backup.status_inactive')}</span></td>
      <td style="white-space:normal;">${escapeHtml(lastRunText)}</td>
      <td style="white-space:normal;">
        <button type="button" class="secondary" data-backup-job-run="${job.id}">${t('backup.run_now')}</button>
        <button type="button" class="secondary" data-backup-job-edit="${job.id}">${t('backup.edit')}</button>
        <button type="button" class="secondary" data-backup-job-toggle="${job.id}" data-backup-job-enabled="${job.enabled}">${job.enabled ? t('backup.disable') : t('backup.enable')}</button>
        <button type="button" class="danger" data-backup-job-delete="${job.id}">${t('backup.delete')}</button>
      </td>
    </tr>
  `;
}

function backupJobFormHtml(sites, databases, editingJob) {
  const eligibleSites = sites.filter((s) => s.template !== 'reverseproxy');
  const siteCheckboxes = eligibleSites.length
    ? eligibleSites.map((s) => `
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:normal;">
          <input type="checkbox" name="backup-job-site" value="${s.id}" ${editingJob?.siteIds?.includes(s.id) ? 'checked' : ''}>
          ${escapeHtml(s.domain)}
        </label>
      `).join('')
    : `<span style="font-size:12px;color:var(--muted);">${t('backup.no_sites_hint')}</span>`;

  const dbCheckboxes = databases.length
    ? databases.map((d) => `
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:normal;">
          <input type="checkbox" name="backup-job-db" value="${d.id}" ${editingJob?.databaseIds?.includes(d.id) ? 'checked' : ''}>
          ${escapeHtml(d.dbName)}
        </label>
      `).join('')
    : `<span style="font-size:12px;color:var(--muted);">${t('backup.no_databases_hint')}</span>`;

  const presetsHtml = CRON_PRESETS.map(([key, value]) =>
    `<button type="button" class="secondary" data-backup-preset="${escapeHtml(value)}">${t('cron.preset_' + key)}</button>`
  ).join('');

  return `
    <h3 style="margin:0 0 4px;font-size:15px;">${editingJob ? t('backup.edit_title') : t('backup.add_title')}</h3>
    <p style="margin:0 0 16px;color:var(--muted);font-size:13px;">${t('backup.jobs_description')}</p>

    <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('backup.field_name')}</label>
    <input type="text" id="backup-job-name" maxlength="100" value="${escapeHtml(editingJob?.name || '')}" style="margin-bottom:10px;width:100%;box-sizing:border-box;">

    <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('backup.field_schedule')}</label>
    <input type="text" id="backup-job-schedule" placeholder="0 3 * * *" value="${escapeHtml(editingJob?.schedule || '0 3 * * *')}" style="font-family:var(--mono);margin-bottom:6px;">
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;">${presetsHtml}</div>

    <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('backup.field_sites')}</label>
    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px;">${siteCheckboxes}</div>

    <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('backup.field_databases')}</label>
    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px;">${dbCheckboxes}</div>

    <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('backup.field_keep_last')}</label>
    <input type="number" id="backup-job-keep-last" min="1" max="365" value="${editingJob?.keepLast ?? 7}" style="width:120px;margin-bottom:6px;">
    <div style="font-size:12px;color:var(--muted);margin-bottom:14px;">${t('backup.keep_last_hint')}</div>

    <button type="button" id="backup-job-submit-btn">${editingJob ? t('backup.save_button_job') : t('backup.add_button')}</button>
    ${editingJob ? `<button type="button" class="secondary" id="backup-job-cancel-btn">${t('backup.cancel_button')}</button>` : ''}
    <div class="action-msg" id="backup-job-msg"></div>
  `;
}

function backupJobsCardHtml(jobs, sites, databases, editingJob) {
  const sitesById = new Map(sites.map((s) => [s.id, s]));
  const dbsById = new Map(databases.map((d) => [d.id, d]));
  const rows = jobs.length
    ? jobs.map((j) => backupJobRow(j, sitesById, dbsById)).join('')
    : `<tr><td colspan="7" style="text-align:center;color:var(--muted);">${t('backup.empty')}</td></tr>`;

  return `
    <div class="system-info-card" style="max-width:none;width:100%;box-sizing:border-box;margin-bottom:16px;">
      ${backupJobFormHtml(sites, databases, editingJob)}
    </div>
    <div class="system-info-card" style="max-width:none;width:100%;box-sizing:border-box;">
      <h3 style="margin:0 0 12px;font-size:15px;">${t('backup.jobs_title')}</h3>
      <div style="overflow-x:auto;">
        <table class="firewall-table">
          <thead>
            <tr>
              <th>${t('backup.col_name')}</th>
              <th>${t('backup.col_schedule')}</th>
              <th>${t('backup.col_sources')}</th>
              <th>${t('backup.col_keep_last')}</th>
              <th>${t('backup.col_status')}</th>
              <th>${t('backup.col_last_run')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderBackupSection(repo, jobs, snapshots, sites, databases) {
  const editingJob = backupJobEditingId ? jobs.find((j) => j.id === backupJobEditingId) : null;
  return `
    <div class="system-info-card" style="max-width:none;width:100%;box-sizing:border-box;margin-bottom:16px;">
      ${backupSnapshotsCardHtml(repo, snapshots)}
    </div>
    <div class="system-info-card" style="max-width:none;width:100%;box-sizing:border-box;margin-bottom:16px;">
      ${backupSettingsCardHtml(repo)}
    </div>
    ${backupJobsCardHtml(jobs, sites, databases, editingJob)}
  `;
}

function wireBackupSection(content) {
  const typeSelect = document.getElementById('backup-repo-type');
  if (typeSelect) {
    typeSelect.onchange = () => {
      content.querySelectorAll('[data-backup-fields]').forEach((el) => {
        el.style.display = el.dataset.backupFields === typeSelect.value ? 'block' : 'none';
      });
    };
  }

  const pwInput = document.getElementById('backup-repo-password');
  const pwToggleBtn = document.getElementById('backup-repo-password-toggle-btn');
  if (pwToggleBtn) {
    pwToggleBtn.onclick = () => { pwInput.type = pwInput.type === 'password' ? 'text' : 'password'; };
  }
  const pwGenBtn = document.getElementById('backup-repo-password-generate-btn');
  if (pwGenBtn) pwGenBtn.onclick = () => { pwInput.value = generatePassword(); };

  const repoSaveBtn = document.getElementById('backup-repo-save-btn');
  if (repoSaveBtn) {
    repoSaveBtn.onclick = async () => {
      const type = typeSelect.value;
      const msgEl = document.getElementById('backup-repo-msg');
      msgEl.textContent = t('backup.saving');
      msgEl.className = 'action-msg';
      repoSaveBtn.disabled = true;
      const payload = { type, password: pwInput.value };
      if (type === 's3') {
        payload.bucket = document.getElementById('backup-s3-bucket').value.trim();
        payload.endpoint = document.getElementById('backup-s3-endpoint').value.trim();
        payload.region = document.getElementById('backup-s3-region').value.trim();
        payload.accessKeyId = document.getElementById('backup-s3-access-key').value.trim();
        payload.secretAccessKey = document.getElementById('backup-s3-secret-key').value.trim();
      } else if (type === 'b2') {
        payload.bucket = document.getElementById('backup-b2-bucket').value.trim();
        payload.accountId = document.getElementById('backup-b2-account-id').value.trim();
        payload.accountKey = document.getElementById('backup-b2-account-key').value.trim();
      } else if (type === 'sftp') {
        payload.host = document.getElementById('backup-sftp-host').value.trim();
        payload.port = document.getElementById('backup-sftp-port').value.trim();
        payload.sftpUser = document.getElementById('backup-sftp-username').value.trim();
        payload.path = document.getElementById('backup-sftp-path').value.trim();
        payload.privateKey = document.getElementById('backup-sftp-private-key').value.trim();
      }
      try {
        await api('PUT', '/backup/repo', payload);
        await refreshBackupTab(content);
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
        repoSaveBtn.disabled = false;
      }
    };
  }

  content.querySelectorAll('[data-backup-preset]').forEach((btn) => {
    btn.onclick = () => { document.getElementById('backup-job-schedule').value = btn.dataset.backupPreset; };
  });

  content.querySelectorAll('[data-backup-job-edit]').forEach((btn) => {
    btn.onclick = () => { backupJobEditingId = btn.dataset.backupJobEdit; refreshBackupTab(content); };
  });

  const jobCancelBtn = document.getElementById('backup-job-cancel-btn');
  if (jobCancelBtn) {
    jobCancelBtn.onclick = () => { backupJobEditingId = null; refreshBackupTab(content); };
  }

  content.querySelectorAll('[data-backup-job-toggle]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.backupJobToggle;
      const enabled = btn.dataset.backupJobEnabled === 'true';
      btn.disabled = true;
      try {
        await api('PUT', `/backup/jobs/${id}`, { enabled: !enabled });
        await refreshBackupTab(content);
      } catch (e) {
        window.alert(e.message);
        btn.disabled = false;
      }
    };
  });

  content.querySelectorAll('[data-backup-job-delete]').forEach((btn) => {
    btn.onclick = async () => {
      if (!window.confirm(t('backup.confirm_delete'))) return;
      btn.disabled = true;
      try {
        await api('DELETE', `/backup/jobs/${btn.dataset.backupJobDelete}`);
        await refreshBackupTab(content);
      } catch (e) {
        window.alert(e.message);
        btn.disabled = false;
      }
    };
  });

  content.querySelectorAll('[data-backup-job-run]').forEach((btn) => {
    btn.onclick = async () => {
      const msgEl = document.getElementById('backup-job-msg');
      btn.disabled = true;
      msgEl.textContent = t('backup.running');
      msgEl.className = 'action-msg';
      try {
        await api('POST', `/backup/jobs/${btn.dataset.backupJobRun}/run`);
        await refreshBackupTab(content);
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
        btn.disabled = false;
      }
    };
  });

  const jobSubmitBtn = document.getElementById('backup-job-submit-btn');
  if (jobSubmitBtn) {
    jobSubmitBtn.onclick = async () => {
      const name = document.getElementById('backup-job-name').value.trim();
      const schedule = document.getElementById('backup-job-schedule').value.trim();
      const keepLast = document.getElementById('backup-job-keep-last').value;
      const siteIds = Array.from(content.querySelectorAll('input[name="backup-job-site"]:checked')).map((el) => el.value);
      const databaseIds = Array.from(content.querySelectorAll('input[name="backup-job-db"]:checked')).map((el) => el.value);
      const msgEl = document.getElementById('backup-job-msg');
      msgEl.textContent = '';
      msgEl.className = 'action-msg';
      jobSubmitBtn.disabled = true;
      try {
        if (backupJobEditingId) {
          await api('PUT', `/backup/jobs/${backupJobEditingId}`, { name, schedule, siteIds, databaseIds, keepLast });
          backupJobEditingId = null;
        } else {
          await api('POST', '/backup/jobs', { name, schedule, siteIds, databaseIds, keepLast });
        }
        await refreshBackupTab(content);
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
        jobSubmitBtn.disabled = false;
      }
    };
  }

  const snapRefreshBtn = document.getElementById('backup-snapshots-refresh-btn');
  if (snapRefreshBtn) snapRefreshBtn.onclick = () => refreshBackupTab(content);

  content.querySelectorAll('[data-backup-restore]').forEach((btn) => {
    btn.onclick = async () => {
      if (!window.confirm(t('backup.confirm_restore'))) return;
      const msgEl = document.getElementById('backup-restore-msg');
      btn.disabled = true;
      msgEl.textContent = t('backup.restoring');
      msgEl.className = 'action-msg';
      try {
        const result = await api('POST', '/backup/restore', { snapshotId: btn.dataset.backupRestore });
        msgEl.textContent = t('backup.restore_success', { path: result.stagingPath || '' });
        msgEl.className = 'action-msg success';
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
      } finally {
        btn.disabled = false;
      }
    };
  });
}

async function refreshBackupTab(content) {
  content.innerHTML = `<div class="empty-state">${t('backup.loading')}</div>`;
  try {
    const [repo, jobs, sitesData, dbData] = await Promise.all([
      api('GET', '/backup/repo'),
      api('GET', '/backup/jobs'),
      api('GET', '/sites'),
      api('GET', '/databases')
    ]);
    const snapshots = repo ? await api('GET', '/backup/snapshots').catch(() => []) : [];
    content.innerHTML = renderBackupSection(repo, jobs, snapshots, sitesData.items, dbData.items);
    wireBackupSection(content);
  } catch (e) {
    content.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

function renderTab() {
  const content = document.getElementById('content');
  document.querySelectorAll('nav button.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === currentTab));
  if (currentTab === 'dashboard') {
    renderDashboard(content);
    startUsageRefresh();
    return;
  }
  stopUsageRefresh();
  if (currentTab === 'settings') {
    renderSettings(content);
  } else if (currentTab === 'cron') {
    refreshCronTab(content);
  } else if (currentTab === 'databases') {
    refreshDatabasesTab(content);
  } else if (currentTab === 'redis') {
    refreshRedisTab(content);
  } else if (currentTab === 'ssh') {
    refreshSshTab(content);
  } else if (currentTab === 'sites') {
    refreshSitesTab(content);
  } else if (currentTab === 'mail') {
    refreshMailTab(content);
  } else if (currentTab === 'backup') {
    refreshBackupTab(content);
  } else if (currentTab === 'python') {
    refreshPythonTab(content);
  } else if (currentTab === 'node') {
    refreshNodeTab(content);
  } else if (PLACEHOLDER_TABS[currentTab]) {
    renderPlaceholderTab(content, PLACEHOLDER_TABS[currentTab]);
  }
}

document.querySelectorAll('nav button.tab').forEach((btn) => {
  btn.onclick = () => {
    if (MUST_CHANGE_PASSWORD && btn.dataset.tab !== 'settings') return;
    currentTab = btn.dataset.tab;
    cronEditingId = null;
    siteEditingId = null;
    backupJobEditingId = null;
    renderTab();
  };
});

document.getElementById('logout-btn').onclick = async () => {
  try { await authApi('POST', '/logout'); } catch { /* i tak przenosimy na login */ }
  window.location.href = '/';
};

(async function init() {
  await setLanguage(detectDefaultLang());
  renderThemeSwitches();
  try {
    const status = await authApi('GET', '/user-status');
    if (!status.username) {
      window.location.href = '/';
      return;
    }
    document.getElementById('current-user').textContent = status.username;
    if (status.version) document.getElementById('app-version-header').textContent = `v${status.version}`;

    const me = await api('GET', '/me');
    CURRENT_ACCOUNT = me;
    MUST_CHANGE_PASSWORD = !!me.mustChangePassword;
    if (MUST_CHANGE_PASSWORD) {
      currentTab = 'settings';
      document.querySelectorAll('nav button.tab').forEach((b) => { if (b.dataset.tab !== 'settings') b.disabled = true; });
    }
    renderTab();
  } catch {
    window.location.href = '/';
  }
})();

function updateFooterClock() {
  const el = document.getElementById('footer-clock');
  if (!el) return;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  el.textContent = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}
updateFooterClock();
setInterval(updateFooterClock, 1000);
