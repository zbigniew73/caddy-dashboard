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

// Szkielet zakladek "na razie tylko szkielet" (Strony/SSH/Backup/Redis) -
// jeden rzad, dwa rowne klocki (ten sam wzorzec co Witaj+Info na
// Dashboardzie), bez tresci - do wypelnienia w kolejnych krokach.
const PLACEHOLDER_TABS = {
  sites: 'nav.sites',
  backup: 'nav.backup'
};

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
    <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px;">
      ${engines.length > 1 ? `
        <div>
          <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('databases.field_engine')}</label>
          <select id="db-new-engine">${engineOptions}</select>
        </div>
      ` : ''}
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
  } else if (PLACEHOLDER_TABS[currentTab]) {
    renderPlaceholderTab(content, PLACEHOLDER_TABS[currentTab]);
  }
}

document.querySelectorAll('nav button.tab').forEach((btn) => {
  btn.onclick = () => {
    if (MUST_CHANGE_PASSWORD && btn.dataset.tab !== 'settings') return;
    currentTab = btn.dataset.tab;
    cronEditingId = null;
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
