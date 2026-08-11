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
      const cpuTile = document.getElementById('tile-cpu');
      const ramTile = document.getElementById('tile-ram');
      if (uptimeTile) uptimeTile.innerHTML = plainTileContent(t('dashboard.tile_uptime'), formatUptime(me.serverUptimeSeconds ?? 0));
      if (cpuTile) cpuTile.innerHTML = usageTileContent(t('dashboard.tile_cpu'), me.cpuUsedPercent ?? 0, me.cpuPercentLimit, '%');
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
      ${usageTile(t('dashboard.tile_cpu'), a.cpuUsedPercent ?? 0, a.cpuPercentLimit, '%', 'tile-cpu')}
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

// Szkielet zakladek "na razie tylko szkielet" (Strony/Bazy/Cron/SSH/Backup) -
// jeden rzad, dwa rowne klocki (ten sam wzorzec co Witaj+Info na
// Dashboardzie), bez tresci - do wypelnienia w kolejnych krokach.
const PLACEHOLDER_TABS = {
  sites: 'nav.sites',
  databases: 'nav.databases',
  ssh: 'nav.ssh',
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

  return `
    <h3 style="margin:0 0 4px;font-size:15px;">${editingJob ? t('cron.edit_title') : t('cron.add_title')}</h3>
    <p style="margin:0 0 16px;color:var(--muted);font-size:13px;">${t('cron.add_description')}</p>

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

function wireCronSection(content) {
  content.querySelectorAll('[data-cron-preset]').forEach((btn) => {
    btn.onclick = () => { document.getElementById('cron-schedule').value = btn.dataset.cronPreset; };
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
    wireCronSection(content);
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
