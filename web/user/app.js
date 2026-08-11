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

// CPU/RAM sie zmieniaja z sekundy na sekunde (biezace zuzycie procesow) -
// odswiezane co 5s. Strony/Bazy danych zmieniaja sie rzadko (trzeba
// recznie dodac domene/baze), wiec odswiezane co 60s (co 12. tick tego
// samego timera - jeden fetch /me na tick, bez dublowania zapytan). Oba w
// miejscu (bez przeladowania calej zakladki), dopoki user jest na
// dashboardzie.
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
      const cpuTile = document.getElementById('tile-cpu');
      const ramTile = document.getElementById('tile-ram');
      if (cpuTile) cpuTile.innerHTML = usageTileContent(t('dashboard.tile_cpu'), me.cpuUsedPercent ?? 0, me.cpuPercentLimit, '%');
      if (ramTile) ramTile.innerHTML = usageTileContent(t('dashboard.tile_ram'), me.ramUsedMb ?? 0, me.ramLimitMb, ' MB');

      usageRefreshTickCount += 1;
      if (usageRefreshTickCount % SITES_DB_REFRESH_EVERY_N_TICKS === 0) {
        const sitesTile = document.getElementById('tile-sites');
        const dbTile = document.getElementById('tile-databases');
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
    <div style="display:grid;grid-template-columns:repeat(4, minmax(0, 1fr));gap:16px;">
      ${usageTile(t('dashboard.tile_cpu'), a.cpuUsedPercent ?? 0, a.cpuPercentLimit, '%', 'tile-cpu')}
      ${usageTile(t('dashboard.tile_ram'), a.ramUsedMb ?? 0, a.ramLimitMb, ' MB', 'tile-ram')}
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
  cron: 'nav.cron',
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
  } else if (PLACEHOLDER_TABS[currentTab]) {
    renderPlaceholderTab(content, PLACEHOLDER_TABS[currentTab]);
  }
}

document.querySelectorAll('nav button.tab').forEach((btn) => {
  btn.onclick = () => {
    if (MUST_CHANGE_PASSWORD && btn.dataset.tab !== 'settings') return;
    currentTab = btn.dataset.tab;
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
