const API = '/api';
const CORE_SERVICE_KEYS = ['ssh', 'firewall', 'cron', 'caddy'];
let SERVICE_DETAIL_TABS = [...CORE_SERVICE_KEYS];
let INSTALL_DETAIL_TABS = [];
let currentTab = 'system';

let TURNSTILE_STATE = { enabled: false, siteKey: '' };
let loginTurnstileToken = null;
let loginTurnstileWidgetId = null;

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve();
  if (window.__turnstileLoadPromise) return window.__turnstileLoadPromise;
  window.__turnstileLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Nie udalo sie zaladowac Cloudflare Turnstile'));
    document.head.appendChild(script);
  });
  return window.__turnstileLoadPromise;
}

async function api(method, url, body) {
  const res = await fetch(API + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include'
  });
  if (res.status === 401 || res.status === 503) {
    showLogin(res.status === 503 ? '' : t('login.error_session_expired'));
    throw new Error('unauthorized');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

const NAV_ICON_DEFAULT = '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>';
const NAV_ICONS = {
  fail2ban: '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  mariadb: '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/><path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/></svg>',
  postgresql: '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/><path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/></svg>',
  mongodb: '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/><path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/></svg>',
  redis: '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/></svg>'
};
function navIcon(key) {
  return NAV_ICONS[key] || NAV_ICON_DEFAULT;
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
  if (document.getElementById('app').style.display === 'flex') {
    renderTab();
    renderUpdateBadge();
    refreshDynamicNav();
  }
}

function showLogin(msg) {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-error').textContent = msg || '';
  renderLoginTurnstile();
}

async function renderLoginTurnstile() {
  const container = document.getElementById('turnstile-container');
  if (!TURNSTILE_STATE.enabled || !TURNSTILE_STATE.siteKey) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'block';
  loginTurnstileToken = null;
  try {
    await loadTurnstileScript();
    container.innerHTML = '';
    loginTurnstileWidgetId = window.turnstile.render(container, {
      sitekey: TURNSTILE_STATE.siteKey,
      theme: 'auto',
      callback: (token) => { loginTurnstileToken = token; },
      'error-callback': () => { loginTurnstileToken = null; }
    });
  } catch (e) {
    document.getElementById('login-error').textContent = e.message;
  }
}

function showApp(username) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  if (username) document.getElementById('current-user').textContent = username;
  renderTab();
  refreshUpdateBadge();
  refreshDynamicNav();
}

let latestUpdateInfo = null;

function renderUpdateBadge() {
  const badge = document.getElementById('update-badge');
  if (!latestUpdateInfo) return;
  badge.style.display = '';
  if (latestUpdateInfo.updateAvailable) {
    badge.textContent = t('update.update_to', { version: latestUpdateInfo.remoteVersion });
    badge.className = 'update-badge update';
    badge.disabled = false;
  } else {
    badge.textContent = t('update.stable');
    badge.className = 'update-badge stable';
    badge.disabled = true;
  }
}

async function refreshUpdateBadge() {
  try {
    latestUpdateInfo = await api('GET', '/update/check');
    renderUpdateBadge();
  } catch {
    document.getElementById('update-badge').style.display = 'none';
  }
}

document.getElementById('update-badge').onclick = async () => {
  if (!latestUpdateInfo || !latestUpdateInfo.updateAvailable) return;
  if (!window.confirm(t('update.confirm', { version: latestUpdateInfo.remoteVersion }))) return;

  const badge = document.getElementById('update-badge');
  badge.disabled = true;
  badge.textContent = t('update.updating');
  try {
    const result = await api('POST', '/update/apply');
    badge.textContent = t('update.updated_restart', { version: result.newVersion });
    badge.className = 'update-badge stable';
    latestUpdateInfo = { updateAvailable: false };
    const restartHint = document.getElementById('update-restart-hint');
    restartHint.textContent = t('update.restart_command');
    restartHint.style.display = '';
  } catch (e) {
    badge.textContent = t('update.error');
    badge.className = 'update-badge update';
    badge.disabled = false;
  }
};

document.getElementById('login-btn').onclick = async () => {
  const username = document.getElementById('username-input').value;
  const password = document.getElementById('password-input').value;

  if (TURNSTILE_STATE.enabled && !loginTurnstileToken) {
    document.getElementById('login-error').textContent = t('login.turnstile_required');
    return;
  }

  try {
    const body = { username, password };
    if (TURNSTILE_STATE.enabled) body.turnstileToken = loginTurnstileToken;
    const result = await api('POST', '/auth/login', body);
    showApp(result.username);
  } catch (e) {
    document.getElementById('login-error').textContent = t('login.error_wrong_password');
    if (window.turnstile && loginTurnstileWidgetId !== null) window.turnstile.reset(loginTurnstileWidgetId);
    loginTurnstileToken = null;
  }
};
document.getElementById('username-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('password-input').focus();
});
document.getElementById('password-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('login-btn').click();
});

document.getElementById('logout-btn').onclick = async () => {
  await api('POST', '/auth/logout');
  showLogin();
};

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('nav .tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  renderTab();
}

async function refreshDynamicNav() {
  let services;
  try {
    services = (await api('GET', '/services')).services;
  } catch {
    return;
  }

  // Go i Restic nie maja jednostki systemd (samodzielne CLI), wiec nie sa w
  // SERVICE_REGISTRY / GET /services - dokladamy je recznie tylko do listy
  // "Install" (nigdy jako normalna zakladke uslugi, bo nie ma jej co pokazac).
  let goEntry = null;
  try {
    const goStatus = await api('GET', '/go/status');
    goEntry = { key: 'go', found: goStatus.installed, installable: true };
  } catch {
    goEntry = null;
  }

  let resticEntry = null;
  try {
    const resticStatus = await api('GET', '/restic/status');
    resticEntry = { key: 'restic', found: resticStatus.installed, installable: true };
  } catch {
    resticEntry = null;
  }

  const installedExtra = services.filter((s) => s.found && !CORE_SERVICE_KEYS.includes(s.key));
  const installablePackages = services.filter((s) => s.installable)
    .concat(goEntry ? [goEntry] : [])
    .concat(resticEntry ? [resticEntry] : []);

  SERVICE_DETAIL_TABS = [...CORE_SERVICE_KEYS, ...installedExtra.map((s) => s.key)];
  INSTALL_DETAIL_TABS = installablePackages.map((s) => `install:${s.key}`);

  const extraContainer = document.getElementById('nav-installed-extra');
  extraContainer.innerHTML = installedExtra.map((s) =>
    `<button type="button" class="tab" data-tab="${escapeHtml(s.key)}">${navIcon(s.key)}<span>${escapeHtml(t(`services.${s.key}.name`))}</span></button>`
  ).join('');
  extraContainer.querySelectorAll('button').forEach((btn) => {
    btn.onclick = () => switchTab(btn.dataset.tab);
  });

  const installContainer = document.getElementById('nav-install-list');
  installContainer.innerHTML = installablePackages.map((s) =>
    `<button type="button" class="tab${s.found ? '' : ' install-pending'}" data-tab="install:${escapeHtml(s.key)}">${escapeHtml(t(`services.${s.key}.name`))}</button>`
  ).join('');
  installContainer.querySelectorAll('button').forEach((btn) => {
    btn.onclick = () => switchTab(btn.dataset.tab);
  });

  const hasInstallSection = installablePackages.length > 0;
  document.getElementById('nav-install-separator').style.display = hasInstallSection ? '' : 'none';
  document.getElementById('nav-install-label').style.display = hasInstallSection ? '' : 'none';

  document.querySelectorAll('nav .tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === currentTab));
}

document.querySelectorAll('nav .tab').forEach((btn) => {
  btn.onclick = () => switchTab(btn.dataset.tab);
});

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

function severity(percent) {
  if (percent >= 90) return 'critical';
  if (percent >= 70) return 'warning';
  return 'good';
}

function meterTile(label, percent, detail) {
  const sev = severity(percent);
  return `
    <div class="stat-tile">
      <div class="stat-label">${escapeHtml(label)}</div>
      <div class="stat-value">${percent}%</div>
      <div class="meter-track"><div class="meter-fill ${sev}" style="width:${Math.min(100, Math.max(0, percent))}%"></div></div>
      ${detail ? `<div class="stat-detail">${escapeHtml(detail)}</div>` : ''}
    </div>
  `;
}

function countTile(label, value) {
  return `
    <div class="stat-tile">
      <div class="stat-label">${escapeHtml(label)}</div>
      <div class="stat-value">${value === null || value === undefined ? '-' : value}</div>
    </div>
  `;
}

function wireSystemRebootButton() {
  const btn = document.getElementById('system-reboot-btn');
  if (!btn) return;
  btn.onclick = async () => {
    if (!window.confirm(t('system.confirm_reboot'))) return;

    const msgEl = document.getElementById('system-reboot-msg');
    btn.disabled = true;
    msgEl.textContent = t('system.rebooting');
    msgEl.className = 'action-msg';
    try {
      await api('POST', '/system/reboot');
      msgEl.textContent = t('system.reboot_initiated');
      msgEl.className = 'action-msg success';
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
      btn.disabled = false;
    }
  };
}

async function renderTab() {
  const content = document.getElementById('content');
  if (currentTab !== 'system') stopSystemAutoRefresh();

  if (currentTab === 'services') {
    await renderServicesTab(content);
    return;
  }
  if (SERVICE_DETAIL_TABS.includes(currentTab)) {
    await renderServiceDetailTab(currentTab, content);
    return;
  }
  if (INSTALL_DETAIL_TABS.includes(currentTab)) {
    await renderInstallDetailTab(currentTab.slice('install:'.length), content);
    return;
  }
  if (currentTab === 'system') {
    await renderSystemTab(content);
    startSystemAutoRefresh();
  }
}

let systemRefreshTimer = null;

function startSystemAutoRefresh() {
  stopSystemAutoRefresh();
  systemRefreshTimer = setInterval(() => {
    if (currentTab === 'system') {
      renderSystemTab(document.getElementById('content'), { silent: true });
    }
  }, 5000);
}

function stopSystemAutoRefresh() {
  if (systemRefreshTimer) {
    clearInterval(systemRefreshTimer);
    systemRefreshTimer = null;
  }
}

async function renderSystemTab(content, { silent = false } = {}) {
  if (!silent) content.innerHTML = `<div class="empty-state">${t('system.loading')}</div>`;
  try {
    const info = await api('GET', '/system');
    const cpuDetail = t('system.cpu_detail', { model: info.cpu.model || '-', cores: info.cpu.cores });
    const ramDetail = t('system.used_of', { used: formatBytes(info.memory.usedBytes), total: formatBytes(info.memory.totalBytes) });
    const diskLabel = info.disk ? t('system.disk', { path: info.disk.path }) : null;
    const diskDetail = info.disk ? t('system.used_of', { used: formatBytes(info.disk.usedBytes), total: formatBytes(info.disk.totalBytes) }) : null;
    const swapDetail = info.swap ? t('system.used_of', { used: formatBytes(info.swap.usedBytes), total: formatBytes(info.swap.totalBytes) }) : null;

    const infoItem = ([labelKey, value]) => `
      <div class="info-line"><span class="info-label" data-i18n="${labelKey}"></span> <span class="info-value">${value}</span></div>
    `;
    const systemItems = [
      ['system.hostname', escapeHtml(info.hostname)],
      ['system.os_name', escapeHtml(info.osName)],
      ['system.platform', `${escapeHtml(info.platform)} / ${escapeHtml(info.arch)}`],
      ['system.kernel', escapeHtml(info.release)],
      ['system.uptime', formatUptime(info.uptimeSeconds)]
    ];
    const versionItems = [
      ['system.caddy_version', escapeHtml(info.versions.caddy || t('system.not_found'))],
      ['system.mariadb_version', escapeHtml(info.versions.mariadb || t('system.not_found'))],
      ['system.postgresql_version', escapeHtml(info.versions.postgresql || t('system.not_found'))],
      ['system.mongodb_version', escapeHtml(info.versions.mongodb || t('system.not_found'))],
      ['system.redis_version', escapeHtml(info.versions.redis || t('system.not_found'))]
    ];
    const runtimeItems = [
      ['system.node_version', escapeHtml(info.versions.node || t('system.not_found'))],
      ['system.python_version', escapeHtml(info.versions.python || t('system.not_found'))]
    ];

    content.innerHTML = `
      <div class="system-grid">
        ${meterTile(t('system.cpu'), info.cpu.usagePercent, cpuDetail)}
        ${meterTile(t('system.ram'), info.memory.usedPercent, ramDetail)}
        ${info.swap ? meterTile(t('system.swap'), info.swap.usedPercent, swapDetail) : ''}
        ${info.disk ? meterTile(diskLabel, info.disk.usedPercent, diskDetail) : ''}
        ${countTile(t('system.all_users'), info.usersCount)}
        ${countTile(t('system.all_sites'), info.caddySiteCount)}
      </div>
      <div class="system-info-card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;">
          <div style="display:flex;gap:40px;align-items:flex-start;">
            <div class="info-grid" style="grid-template-columns:1fr;">${systemItems.map(infoItem).join('')}</div>
            <div class="info-grid" style="grid-template-columns:1fr;">${versionItems.map(infoItem).join('')}</div>
            <div class="info-grid" style="grid-template-columns:1fr;">${runtimeItems.map(infoItem).join('')}</div>
          </div>
          <button type="button" class="danger" id="system-reboot-btn" style="flex-shrink:0;white-space:nowrap;">${t('system.reboot_button')}</button>
        </div>
        <div class="action-msg" id="system-reboot-msg"></div>
      </div>
    `;
    applyTranslations();
    wireSystemRebootButton();
  } catch (e) {
    if (!silent) content.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

function installTileHtml(key, svc) {
  const name = t(`services.${key}.name`);
  const description = t(`install.${key}.description`);
  return `
    <div class="system-info-card" style="max-width:520px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:12px;">
        <div style="font-weight:600;font-size:15px;">${escapeHtml(name)}</div>
        ${svc.found
          ? `<span class="status-badge active">${t('install.installed_badge')}</span>`
          : `<button type="button" id="install-btn-${escapeHtml(key)}">${t('install.install_button')}</button>`}
      </div>
      <p style="color:var(--muted);font-size:13px;line-height:1.5;margin:0;">${escapeHtml(description)}</p>
      <div class="action-msg" id="install-msg-${escapeHtml(key)}"></div>
    </div>
  `;
}

function wireInstallTile(key) {
  const btn = document.getElementById(`install-btn-${key}`);
  if (!btn) return;
  btn.onclick = async () => {
    const msgEl = document.getElementById(`install-msg-${key}`);
    btn.disabled = true;
    msgEl.textContent = t('install.installing');
    msgEl.className = 'action-msg';
    try {
      const svc = await api('POST', `/services/${key}/install`);
      document.getElementById('content').innerHTML = installTileHtml(key, svc);
      const successEl = document.getElementById(`install-msg-${key}`);
      successEl.textContent = t('install.install_success');
      successEl.className = 'action-msg success';
      await refreshDynamicNav();
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
      btn.disabled = false;
    }
  };
}

function mariadbInstallTileHtml(svc) {
  const name = t('services.mariadb.name');
  const description = t('install.mariadb.description');

  if (svc.found) {
    return `
      <div class="system-info-card" style="max-width:560px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:12px;">
          <div style="font-weight:600;font-size:15px;">${escapeHtml(name)}</div>
          <span class="status-badge active">${t('install.installed_badge')}</span>
        </div>
        <p style="color:var(--muted);font-size:13px;line-height:1.5;margin:0;">${escapeHtml(description)}</p>
        <p style="color:var(--muted);font-size:12px;margin-top:10px;">${t('install.mariadb.password_hint')}</p>
        <div class="action-msg" id="mariadb-install-msg"></div>
      </div>
    `;
  }

  return `
    <div class="system-info-card" style="max-width:560px;">
      <div style="font-weight:600;font-size:15px;margin-bottom:8px;">${escapeHtml(name)}</div>
      <p style="color:var(--muted);font-size:13px;line-height:1.5;margin:0 0 16px;">${escapeHtml(description)}</p>

      <label style="display:flex;align-items:flex-start;gap:8px;margin-bottom:10px;font-size:13px;">
        <input type="radio" name="mariadb-mode" value="local" checked style="margin-top:3px;">
        <span>
          <strong>${t('install.mariadb.mode_local')}</strong><br>
          <span id="mariadb-local-version" style="color:var(--muted);font-size:12px;">${t('install.mariadb.checking_version')}</span>
        </span>
      </label>
      <label style="display:flex;align-items:flex-start;gap:8px;font-size:13px;margin-bottom:14px;">
        <input type="radio" name="mariadb-mode" value="official" style="margin-top:3px;">
        <span>
          <strong>${t('install.mariadb.mode_official')}</strong><br>
          <span style="color:var(--muted);font-size:12px;">${t('install.mariadb.mode_official_detail')}</span>
        </span>
      </label>

      <div id="mariadb-version-select" style="display:none;margin-bottom:14px;">
        <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('install.mariadb.version_label')}</label>
        <select id="mariadb-version">
          <option value="11.8">11.8</option>
          <option value="10.11">10.11</option>
        </select>
      </div>

      <button type="button" id="mariadb-install-btn" disabled>${t('install.install_button')}</button>
      <div class="action-msg" id="mariadb-install-msg"></div>
    </div>
  `;
}

function wireMariadbInstallTile() {
  const btn = document.getElementById('mariadb-install-btn');
  if (!btn) return;
  const versionSelectWrap = document.getElementById('mariadb-version-select');
  const localVersionEl = document.getElementById('mariadb-local-version');
  const msgEl = document.getElementById('mariadb-install-msg');
  let localVersionLoaded = false;

  function selectedMode() {
    return document.querySelector('input[name="mariadb-mode"]:checked').value;
  }

  function updateButtonState() {
    const mode = selectedMode();
    versionSelectWrap.style.display = mode === 'official' ? 'block' : 'none';
    btn.disabled = mode === 'local' ? !localVersionLoaded : false;
  }

  document.querySelectorAll('input[name="mariadb-mode"]').forEach((r) => {
    r.onchange = updateButtonState;
  });

  (async () => {
    try {
      const { version } = await api('GET', '/mariadb/local-version');
      localVersionEl.textContent = version
        ? t('install.mariadb.local_version_found', { version })
        : t('install.mariadb.local_version_unknown');
      localVersionLoaded = true;
    } catch (e) {
      localVersionEl.textContent = e.message;
      localVersionLoaded = false;
    }
    updateButtonState();
  })();

  btn.onclick = async () => {
    const mode = selectedMode();
    const version = mode === 'official' ? document.getElementById('mariadb-version').value : undefined;
    if (!window.confirm(t('install.mariadb.confirm_install'))) return;

    btn.disabled = true;
    msgEl.textContent = t('install.installing');
    msgEl.className = 'action-msg';
    try {
      await api('POST', '/mariadb/install', { mode, version });
      const svc = await api('GET', '/services/mariadb');
      document.getElementById('content').innerHTML = mariadbInstallTileHtml(svc);
      applyTranslations();
      const successEl = document.getElementById('mariadb-install-msg');
      if (successEl) {
        successEl.textContent = t('install.install_success');
        successEl.className = 'action-msg success';
      }
      await refreshDynamicNav();
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
      btn.disabled = false;
    }
  };

  updateButtonState();
}

function postgresqlInstallTileHtml(svc) {
  const name = t('services.postgresql.name');
  const description = t('install.postgresql.description');

  if (svc.found) {
    return `
      <div class="system-info-card" style="max-width:560px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:12px;">
          <div style="font-weight:600;font-size:15px;">${escapeHtml(name)}</div>
          <span class="status-badge active">${t('install.installed_badge')}</span>
        </div>
        <p style="color:var(--muted);font-size:13px;line-height:1.5;margin:0;">${escapeHtml(description)}</p>
        <p style="color:var(--muted);font-size:12px;margin-top:10px;">${t('install.postgresql.password_hint')}</p>
        <div class="action-msg" id="postgresql-install-msg"></div>
      </div>
    `;
  }

  return `
    <div class="system-info-card" style="max-width:560px;">
      <div style="font-weight:600;font-size:15px;margin-bottom:8px;">${escapeHtml(name)}</div>
      <p style="color:var(--muted);font-size:13px;line-height:1.5;margin:0 0 16px;">${escapeHtml(description)}</p>

      <label style="display:flex;align-items:flex-start;gap:8px;margin-bottom:10px;font-size:13px;">
        <input type="radio" name="postgresql-mode" value="local" checked style="margin-top:3px;">
        <span>
          <strong>${t('install.postgresql.mode_local')}</strong><br>
          <span id="postgresql-local-version" style="color:var(--muted);font-size:12px;">${t('install.postgresql.checking_version')}</span>
        </span>
      </label>
      <label style="display:flex;align-items:flex-start;gap:8px;font-size:13px;margin-bottom:14px;">
        <input type="radio" name="postgresql-mode" value="official" style="margin-top:3px;">
        <span>
          <strong>${t('install.postgresql.mode_official')}</strong><br>
          <span style="color:var(--muted);font-size:12px;">${t('install.postgresql.mode_official_detail')}</span>
        </span>
      </label>

      <div id="postgresql-version-select" style="display:none;margin-bottom:14px;">
        <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('install.postgresql.version_label')}</label>
        <select id="postgresql-version">
          <option value="17">17</option>
          <option value="16">16</option>
        </select>
      </div>

      <button type="button" id="postgresql-install-btn" disabled>${t('install.install_button')}</button>
      <div class="action-msg" id="postgresql-install-msg"></div>
    </div>
  `;
}

function wirePostgresqlInstallTile() {
  const btn = document.getElementById('postgresql-install-btn');
  if (!btn) return;
  const versionSelectWrap = document.getElementById('postgresql-version-select');
  const localVersionEl = document.getElementById('postgresql-local-version');
  const msgEl = document.getElementById('postgresql-install-msg');
  let localVersionLoaded = false;

  function selectedMode() {
    return document.querySelector('input[name="postgresql-mode"]:checked').value;
  }

  function updateButtonState() {
    const mode = selectedMode();
    versionSelectWrap.style.display = mode === 'official' ? 'block' : 'none';
    btn.disabled = mode === 'local' ? !localVersionLoaded : false;
  }

  document.querySelectorAll('input[name="postgresql-mode"]').forEach((r) => {
    r.onchange = updateButtonState;
  });

  (async () => {
    try {
      const { version } = await api('GET', '/postgresql/local-version');
      localVersionEl.textContent = version
        ? t('install.postgresql.local_version_found', { version })
        : t('install.postgresql.local_version_unknown');
      localVersionLoaded = true;
    } catch (e) {
      localVersionEl.textContent = e.message;
      localVersionLoaded = false;
    }
    updateButtonState();
  })();

  btn.onclick = async () => {
    const mode = selectedMode();
    const version = mode === 'official' ? document.getElementById('postgresql-version').value : undefined;
    if (!window.confirm(t('install.postgresql.confirm_install'))) return;

    btn.disabled = true;
    msgEl.textContent = t('install.installing');
    msgEl.className = 'action-msg';
    try {
      await api('POST', '/postgresql/install', { mode, version });
      const svc = await api('GET', '/services/postgresql');
      document.getElementById('content').innerHTML = postgresqlInstallTileHtml(svc);
      applyTranslations();
      const successEl = document.getElementById('postgresql-install-msg');
      if (successEl) {
        successEl.textContent = t('install.install_success');
        successEl.className = 'action-msg success';
      }
      await refreshDynamicNav();
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
      btn.disabled = false;
    }
  };

  updateButtonState();
}

function mongodbVersionFormHtml() {
  return `
    <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('install.mongodb.version_label')}</label>
    <select id="mongodb-version" style="width:100%;margin-bottom:16px;">
      <option value="8.0">8.0</option>
      <option value="7.0">7.0</option>
    </select>

    <button type="button" id="mongodb-install-btn">${t('install.install_button')}</button>
    <div class="action-msg" id="mongodb-install-msg"></div>
  `;
}

function mongodbInstallTileHtml(svc, authStatus) {
  const name = t('services.mongodb.name');
  const description = t('install.mongodb.description');

  if (svc.found && authStatus && authStatus.authConfigured) {
    return `
      <div class="system-info-card" style="max-width:560px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:12px;">
          <div style="font-weight:600;font-size:15px;">${escapeHtml(name)}</div>
          <span class="status-badge active">${t('install.installed_badge')}</span>
        </div>
        <p style="color:var(--muted);font-size:13px;line-height:1.5;margin:0;">${escapeHtml(description)}</p>
        <p style="color:var(--muted);font-size:12px;margin-top:10px;">${t('install.mongodb.password_hint')}</p>
        <div class="action-msg" id="mongodb-install-msg"></div>
      </div>
    `;
  }

  if (svc.found && authStatus && !authStatus.authConfigured) {
    return `
      <div class="system-info-card" style="max-width:560px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:12px;">
          <div style="font-weight:600;font-size:15px;">${escapeHtml(name)}</div>
          <span class="status-badge inactive">${t('install.mongodb.setup_incomplete_badge')}</span>
        </div>
        <p style="color:var(--danger);font-size:13px;line-height:1.5;margin:0 0 14px;">${t('install.mongodb.setup_incomplete_note')}</p>
        ${mongodbVersionFormHtml()}
      </div>
    `;
  }

  return `
    <div class="system-info-card" style="max-width:560px;">
      <div style="font-weight:600;font-size:15px;margin-bottom:8px;">${escapeHtml(name)}</div>
      <p style="color:var(--muted);font-size:13px;line-height:1.5;margin:0 0 16px;">${escapeHtml(description)}</p>
      <p style="color:var(--muted);font-size:12px;margin:0 0 14px;">${t('install.mongodb.no_local_repo_note')}</p>
      ${mongodbVersionFormHtml()}
    </div>
  `;
}

function wireMongodbInstallTile() {
  const btn = document.getElementById('mongodb-install-btn');
  if (!btn) return;
  const msgEl = document.getElementById('mongodb-install-msg');

  btn.onclick = async () => {
    const version = document.getElementById('mongodb-version').value;
    if (!window.confirm(t('install.mongodb.confirm_install'))) return;

    btn.disabled = true;
    msgEl.textContent = t('install.installing');
    msgEl.className = 'action-msg';
    try {
      await api('POST', '/mongodb/install', { version });
      const svc = await api('GET', '/services/mongodb');
      document.getElementById('content').innerHTML = mongodbInstallTileHtml(svc, { reachable: true, authConfigured: true });
      applyTranslations();
      const successEl = document.getElementById('mongodb-install-msg');
      if (successEl) {
        successEl.textContent = t('install.install_success');
        successEl.className = 'action-msg success';
      }
      await refreshDynamicNav();
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
      btn.disabled = false;
    }
  };
}

function redisModeFormHtml() {
  return `
    <label style="display:flex;align-items:flex-start;gap:8px;margin-bottom:10px;font-size:13px;">
      <input type="radio" name="redis-mode" value="local" checked style="margin-top:3px;">
      <span>
        <strong>${t('install.redis.mode_local')}</strong><br>
        <span id="redis-local-version" style="color:var(--muted);font-size:12px;">${t('install.redis.checking_version')}</span>
      </span>
    </label>
    <label style="display:flex;align-items:flex-start;gap:8px;font-size:13px;margin-bottom:16px;">
      <input type="radio" name="redis-mode" value="official" style="margin-top:3px;">
      <span>
        <strong>${t('install.redis.mode_official')}</strong><br>
        <span style="color:var(--muted);font-size:12px;">${t('install.redis.mode_official_detail')}</span>
      </span>
    </label>

    <button type="button" id="redis-install-btn" disabled>${t('install.install_button')}</button>
    <div class="action-msg" id="redis-install-msg"></div>
  `;
}

function redisInstallTileHtml(svc, authStatus) {
  const name = t('services.redis.name');
  const description = t('install.redis.description');

  if (svc.found && authStatus && authStatus.authConfigured) {
    return `
      <div class="system-info-card" style="max-width:560px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:12px;">
          <div style="font-weight:600;font-size:15px;">${escapeHtml(name)}</div>
          <span class="status-badge active">${t('install.installed_badge')}</span>
        </div>
        <p style="color:var(--muted);font-size:13px;line-height:1.5;margin:0;">${escapeHtml(description)}</p>
        <p style="color:var(--muted);font-size:12px;margin-top:10px;">${t('install.redis.password_hint')}</p>
        <div class="action-msg" id="redis-install-msg"></div>
      </div>
    `;
  }

  if (svc.found && authStatus && !authStatus.authConfigured) {
    return `
      <div class="system-info-card" style="max-width:560px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:12px;">
          <div style="font-weight:600;font-size:15px;">${escapeHtml(name)}</div>
          <span class="status-badge inactive">${t('install.redis.setup_incomplete_badge')}</span>
        </div>
        <p style="color:var(--danger);font-size:13px;line-height:1.5;margin:0 0 14px;">${t('install.redis.setup_incomplete_note')}</p>
        ${redisModeFormHtml()}
      </div>
    `;
  }

  return `
    <div class="system-info-card" style="max-width:560px;">
      <div style="font-weight:600;font-size:15px;margin-bottom:8px;">${escapeHtml(name)}</div>
      <p style="color:var(--muted);font-size:13px;line-height:1.5;margin:0 0 16px;">${escapeHtml(description)}</p>
      ${redisModeFormHtml()}
    </div>
  `;
}

function wireRedisInstallTile() {
  const btn = document.getElementById('redis-install-btn');
  if (!btn) return;
  const localVersionEl = document.getElementById('redis-local-version');
  const msgEl = document.getElementById('redis-install-msg');
  let localVersionLoaded = false;

  function selectedMode() {
    return document.querySelector('input[name="redis-mode"]:checked').value;
  }

  function updateButtonState() {
    const mode = selectedMode();
    btn.disabled = mode === 'local' ? !localVersionLoaded : false;
  }

  document.querySelectorAll('input[name="redis-mode"]').forEach((r) => {
    r.onchange = updateButtonState;
  });

  (async () => {
    try {
      const { version } = await api('GET', '/redis/local-version');
      localVersionEl.textContent = version
        ? t('install.redis.local_version_found', { version })
        : t('install.redis.local_version_unknown');
      localVersionLoaded = true;
    } catch (e) {
      localVersionEl.textContent = e.message;
      localVersionLoaded = false;
    }
    updateButtonState();
  })();

  btn.onclick = async () => {
    const mode = selectedMode();
    if (!window.confirm(t('install.redis.confirm_install'))) return;

    btn.disabled = true;
    msgEl.textContent = t('install.installing');
    msgEl.className = 'action-msg';
    try {
      await api('POST', '/redis/install', { mode });
      const svc = await api('GET', '/services/redis');
      document.getElementById('content').innerHTML = redisInstallTileHtml(svc, { reachable: true, authConfigured: true });
      applyTranslations();
      const successEl = document.getElementById('redis-install-msg');
      if (successEl) {
        successEl.textContent = t('install.install_success');
        successEl.className = 'action-msg success';
      }
      await refreshDynamicNav();
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
      btn.disabled = false;
    }
  };

  updateButtonState();
}

function goInstallTileHtml(status) {
  const name = t('services.go.name');
  const description = t('install.go.description');

  if (status.installed) {
    return `
      <div class="system-info-card" style="max-width:560px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:12px;">
          <div style="font-weight:600;font-size:15px;">${escapeHtml(name)}</div>
          <span class="status-badge active">${t('install.installed_badge')}</span>
        </div>
        <p style="color:var(--muted);font-size:13px;line-height:1.5;margin:0;">${escapeHtml(description)}</p>
        <p style="color:var(--muted);font-size:12px;margin-top:10px;">${t('install.go.installed_hint', { version: status.version || '?' })}</p>
        <div class="action-msg" id="go-install-msg"></div>
      </div>
    `;
  }

  return `
    <div class="system-info-card" style="max-width:560px;">
      <div style="font-weight:600;font-size:15px;margin-bottom:8px;">${escapeHtml(name)}</div>
      <p style="color:var(--muted);font-size:13px;line-height:1.5;margin:0 0 16px;">${escapeHtml(description)}</p>

      <label style="display:flex;align-items:flex-start;gap:8px;margin-bottom:10px;font-size:13px;">
        <input type="radio" name="go-mode" value="local" checked style="margin-top:3px;">
        <span>
          <strong>${t('install.go.mode_local')}</strong><br>
          <span id="go-local-version" style="color:var(--muted);font-size:12px;">${t('install.go.checking_version')}</span>
        </span>
      </label>
      <label style="display:flex;align-items:flex-start;gap:8px;font-size:13px;margin-bottom:16px;">
        <input type="radio" name="go-mode" value="official" style="margin-top:3px;">
        <span>
          <strong>${t('install.go.mode_official')}</strong><br>
          <span style="color:var(--muted);font-size:12px;">${t('install.go.mode_official_detail')}</span>
        </span>
      </label>

      <button type="button" id="go-install-btn" disabled>${t('install.install_button')}</button>
      <div class="action-msg" id="go-install-msg"></div>
    </div>
  `;
}

function wireGoInstallTile() {
  const btn = document.getElementById('go-install-btn');
  if (!btn) return;
  const localVersionEl = document.getElementById('go-local-version');
  const msgEl = document.getElementById('go-install-msg');
  let localVersionLoaded = false;

  function selectedMode() {
    return document.querySelector('input[name="go-mode"]:checked').value;
  }

  function updateButtonState() {
    const mode = selectedMode();
    btn.disabled = mode === 'local' ? !localVersionLoaded : false;
  }

  document.querySelectorAll('input[name="go-mode"]').forEach((r) => {
    r.onchange = updateButtonState;
  });

  (async () => {
    try {
      const { version } = await api('GET', '/go/local-version');
      localVersionEl.textContent = version
        ? t('install.go.local_version_found', { version })
        : t('install.go.local_version_unknown');
      localVersionLoaded = true;
    } catch (e) {
      localVersionEl.textContent = e.message;
      localVersionLoaded = false;
    }
    updateButtonState();
  })();

  btn.onclick = async () => {
    const mode = selectedMode();
    if (!window.confirm(t('install.go.confirm_install'))) return;

    btn.disabled = true;
    msgEl.textContent = t('install.installing');
    msgEl.className = 'action-msg';
    try {
      await api('POST', '/go/install', { mode });
      const status = await api('GET', '/go/status');
      document.getElementById('content').innerHTML = goInstallTileHtml(status);
      applyTranslations();
      const successEl = document.getElementById('go-install-msg');
      if (successEl) {
        successEl.textContent = t('install.install_success');
        successEl.className = 'action-msg success';
      }
      await refreshDynamicNav();
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
      btn.disabled = false;
    }
  };

  updateButtonState();
}

function resticInstallTileHtml(status) {
  const name = t('services.restic.name');
  const description = t('install.restic.description');

  if (status.installed) {
    return `
      <div class="system-info-card" style="max-width:560px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:12px;">
          <div style="font-weight:600;font-size:15px;">${escapeHtml(name)}</div>
          <span class="status-badge active">${t('install.installed_badge')}</span>
        </div>
        <p style="color:var(--muted);font-size:13px;line-height:1.5;margin:0;">${escapeHtml(description)}</p>
        <p style="color:var(--muted);font-size:12px;margin-top:10px;">${t('install.restic.installed_hint', { version: status.version || '?' })}</p>
        <div class="action-msg" id="restic-install-msg"></div>
      </div>
    `;
  }

  return `
    <div class="system-info-card" style="max-width:560px;">
      <div style="font-weight:600;font-size:15px;margin-bottom:8px;">${escapeHtml(name)}</div>
      <p style="color:var(--muted);font-size:13px;line-height:1.5;margin:0 0 16px;">${escapeHtml(description)}</p>

      <label style="display:flex;align-items:flex-start;gap:8px;margin-bottom:10px;font-size:13px;">
        <input type="radio" name="restic-mode" value="local" checked style="margin-top:3px;">
        <span>
          <strong>${t('install.restic.mode_local')}</strong><br>
          <span id="restic-local-version" style="color:var(--muted);font-size:12px;">${t('install.restic.checking_version')}</span>
        </span>
      </label>
      <label style="display:flex;align-items:flex-start;gap:8px;font-size:13px;margin-bottom:16px;">
        <input type="radio" name="restic-mode" value="official" style="margin-top:3px;">
        <span>
          <strong>${t('install.restic.mode_official')}</strong><br>
          <span style="color:var(--muted);font-size:12px;">${t('install.restic.mode_official_detail')}</span>
        </span>
      </label>

      <button type="button" id="restic-install-btn" disabled>${t('install.install_button')}</button>
      <div class="action-msg" id="restic-install-msg"></div>
    </div>
  `;
}

function wireResticInstallTile() {
  const btn = document.getElementById('restic-install-btn');
  if (!btn) return;
  const localVersionEl = document.getElementById('restic-local-version');
  const msgEl = document.getElementById('restic-install-msg');
  let localVersionLoaded = false;

  function selectedMode() {
    return document.querySelector('input[name="restic-mode"]:checked').value;
  }

  function updateButtonState() {
    const mode = selectedMode();
    btn.disabled = mode === 'local' ? !localVersionLoaded : false;
  }

  document.querySelectorAll('input[name="restic-mode"]').forEach((r) => {
    r.onchange = updateButtonState;
  });

  (async () => {
    try {
      const { version } = await api('GET', '/restic/local-version');
      localVersionEl.textContent = version
        ? t('install.restic.local_version_found', { version })
        : t('install.restic.local_version_unknown');
      localVersionLoaded = true;
    } catch (e) {
      localVersionEl.textContent = e.message;
      localVersionLoaded = false;
    }
    updateButtonState();
  })();

  btn.onclick = async () => {
    const mode = selectedMode();
    if (!window.confirm(t('install.restic.confirm_install'))) return;

    btn.disabled = true;
    msgEl.textContent = t('install.installing');
    msgEl.className = 'action-msg';
    try {
      await api('POST', '/restic/install', { mode });
      const status = await api('GET', '/restic/status');
      document.getElementById('content').innerHTML = resticInstallTileHtml(status);
      applyTranslations();
      const successEl = document.getElementById('restic-install-msg');
      if (successEl) {
        successEl.textContent = t('install.install_success');
        successEl.className = 'action-msg success';
      }
      await refreshDynamicNav();
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
      btn.disabled = false;
    }
  };

  updateButtonState();
}

async function renderInstallDetailTab(key, content) {
  content.innerHTML = `<div class="empty-state">${t('services.loading')}</div>`;
  try {
    if (key === 'go') {
      const status = await api('GET', '/go/status');
      content.innerHTML = goInstallTileHtml(status);
      applyTranslations();
      wireGoInstallTile();
      return;
    }
    if (key === 'restic') {
      const status = await api('GET', '/restic/status');
      content.innerHTML = resticInstallTileHtml(status);
      applyTranslations();
      wireResticInstallTile();
      return;
    }
    const svc = await api('GET', `/services/${key}`);
    if (key === 'mariadb') {
      content.innerHTML = mariadbInstallTileHtml(svc);
      applyTranslations();
      wireMariadbInstallTile();
      return;
    }
    if (key === 'postgresql') {
      content.innerHTML = postgresqlInstallTileHtml(svc);
      applyTranslations();
      wirePostgresqlInstallTile();
      return;
    }
    if (key === 'mongodb') {
      const authStatus = svc.found ? await api('GET', '/mongodb/auth-status') : null;
      content.innerHTML = mongodbInstallTileHtml(svc, authStatus);
      applyTranslations();
      wireMongodbInstallTile();
      return;
    }
    if (key === 'redis') {
      const authStatus = svc.found ? await api('GET', '/redis/auth-status') : null;
      content.innerHTML = redisInstallTileHtml(svc, authStatus);
      applyTranslations();
      wireRedisInstallTile();
      return;
    }
    content.innerHTML = installTileHtml(key, svc);
    wireInstallTile(key);
  } catch (e) {
    content.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

function serviceCard(svc) {
  const name = t(`services.${svc.key}.name`);
  const isActive = svc.activeState === 'active';
  return `
    <div class="service-card" data-nav-tab="${escapeHtml(svc.key)}">
      <div class="service-card-header">
        <span class="service-name">${escapeHtml(name)}</span>
        <span class="status-badge ${isActive ? 'active' : 'inactive'}">${isActive ? t('services.active') : t('services.inactive')}</span>
      </div>
      <div class="service-detail">${escapeHtml(svc.unit)}</div>
    </div>
  `;
}

async function renderServicesTab(content) {
  content.innerHTML = `<div class="empty-state">${t('services.loading')}</div>`;
  try {
    const { services } = await api('GET', '/services');
    const installed = services.filter((s) => s.found);
    if (!installed.length) {
      content.innerHTML = `<div class="empty-state">${t('services.empty')}</div>`;
      return;
    }
    content.innerHTML = `<div class="services-grid">${installed.map(serviceCard).join('')}</div>`;
    content.querySelectorAll('[data-nav-tab]').forEach((card) => {
      card.onclick = () => switchTab(card.dataset.navTab);
    });
  } catch (e) {
    content.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

function serviceDetailHtml(svc) {
  if (!svc.found) {
    return `<div class="empty-state">${t('services.not_installed_detail')}</div>`;
  }
  const isActive = svc.activeState === 'active';
  const isEnabled = svc.enabled === 'enabled';
  return `
    <div class="system-info-card">
      <dl>
        <dt data-i18n="services.unit"></dt><dd>${escapeHtml(svc.unit)}</dd>
        <dt data-i18n="services.status"></dt><dd><span class="status-badge ${isActive ? 'active' : 'inactive'}">${isActive ? t('services.active') : t('services.inactive')}</span> (${escapeHtml(svc.subState)})</dd>
        <dt data-i18n="services.enabled_label"></dt><dd>${isEnabled ? t('services.enabled') : t('services.disabled')}</dd>
        <dt data-i18n="services.pid"></dt><dd>${svc.mainPid || '-'}</dd>
        <dt data-i18n="services.since"></dt><dd>${escapeHtml(svc.since || '-')}</dd>
      </dl>
      <div class="service-actions">
        <button type="button" data-action="start">${t('services.action_start')}</button>
        <button type="button" data-action="restart">${t('services.action_restart')}</button>
        <button type="button" class="danger" data-action="stop">${t('services.action_stop')}</button>
      </div>
      <div class="action-msg" id="${svc.key}-action-msg"></div>
    </div>
  `;
}

async function renderSshPortSection() {
  try {
    const { port } = await api('GET', '/ssh/port');
    return `
      <div class="system-info-card">
        <dl>
          <dt data-i18n="ssh.current_port"></dt><dd id="ssh-current-port">${port}</dd>
        </dl>
        <div class="service-actions">
          <input type="number" id="ssh-new-port" min="1" max="65535" placeholder="${t('ssh.new_port_placeholder')}" style="width:140px;">
          <button type="button" id="ssh-change-port-btn">${t('ssh.change_port_button')}</button>
        </div>
        <div class="action-msg" id="ssh-port-msg"></div>
      </div>
    `;
  } catch (e) {
    return `<div class="system-info-card"><div class="empty-state">${escapeHtml(e.message)}</div></div>`;
  }
}

function wireSshPortSection() {
  const btn = document.getElementById('ssh-change-port-btn');
  if (!btn) return;
  btn.onclick = async () => {
    const input = document.getElementById('ssh-new-port');
    const newPort = parseInt(input.value, 10);
    const msgEl = document.getElementById('ssh-port-msg');

    if (!Number.isInteger(newPort) || newPort < 1 || newPort > 65535) {
      msgEl.textContent = t('ssh.invalid_port');
      msgEl.className = 'action-msg error';
      return;
    }
    if (!window.confirm(t('ssh.confirm_change_port', { port: newPort }))) return;

    btn.disabled = true;
    input.disabled = true;
    msgEl.textContent = t('ssh.changing_port');
    msgEl.className = 'action-msg';
    try {
      const result = await api('POST', '/ssh/port', { port: newPort });
      document.getElementById('ssh-current-port').textContent = result.port;
      msgEl.textContent = t('ssh.port_changed', { port: result.port });
      msgEl.className = 'action-msg success';
      input.value = '';
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
    } finally {
      btn.disabled = false;
      input.disabled = false;
    }
  };
}

async function renderFirewallSection() {
  try {
    const { entries } = await api('GET', '/firewall/entries');
    const rows = entries.map((e) => {
      if (e.type === 'service') {
        return `<tr><td>${escapeHtml(e.name)}</td><td>${t('firewall.type_service')}</td><td></td><td></td></tr>`;
      }
      const value = `${e.port}/${e.protocol}`;
      return `
        <tr>
          <td>${escapeHtml(e.port)}</td>
          <td>${escapeHtml(e.protocol.toUpperCase())}</td>
          <td>${escapeHtml(e.description || '')}</td>
          <td>
            <button type="button" class="secondary" data-edit-type="port" data-edit-value="${escapeHtml(value)}" data-edit-desc="${escapeHtml(e.description || '')}">${t('firewall.edit')}</button>
            <button type="button" class="danger" data-remove-type="port" data-remove-value="${escapeHtml(value)}">${t('firewall.remove')}</button>
          </td>
        </tr>
      `;
    }).join('');

    return `
      <div style="overflow-x:auto;">
        <table class="firewall-table">
          <thead>
            <tr>
              <th data-i18n="firewall.col_port"></th>
              <th data-i18n="firewall.col_protocol"></th>
              <th data-i18n="firewall.col_description"></th>
              <th></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="service-actions">
        <input type="number" id="fw-new-port" min="1" max="65535" placeholder="${t('firewall.new_port_placeholder')}" style="width:140px;">
        <select id="fw-new-protocol">
          <option value="tcp">TCP</option>
          <option value="udp">UDP</option>
        </select>
        <input type="text" id="fw-new-desc" maxlength="100" placeholder="${t('firewall.new_desc_placeholder')}" style="width:220px;">
        <button type="button" id="fw-add-port-btn">${t('firewall.add_button')}</button>
      </div>
      <div class="action-msg" id="fw-port-msg"></div>
    `;
  } catch (e) {
    return `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

async function refreshFirewallSection() {
  const container = document.getElementById('fw-section-container');
  if (!container) return;
  container.innerHTML = await renderFirewallSection();
  applyTranslations();
  wireFirewallSection();
}

function wireFirewallSection() {
  document.querySelectorAll('[data-remove-type]').forEach((btn) => {
    btn.onclick = async () => {
      const type = btn.dataset.removeType;
      const value = btn.dataset.removeValue;
      if (!window.confirm(t('firewall.confirm_remove', { value }))) return;

      const msgEl = document.getElementById('fw-port-msg');
      btn.disabled = true;
      try {
        await api('POST', '/firewall/entries/remove', { type, value });
        await refreshFirewallSection();
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
        btn.disabled = false;
      }
    };
  });

  document.querySelectorAll('[data-edit-type]').forEach((btn) => {
    btn.onclick = async () => {
      const value = btn.dataset.editValue;
      const [port, protocol] = value.split('/');
      const current = btn.dataset.editDesc || '';
      const description = window.prompt(t('firewall.edit_description_prompt', { value }), current);
      if (description === null) return;

      const msgEl = document.getElementById('fw-port-msg');
      btn.disabled = true;
      try {
        await api('POST', '/firewall/entries/description', { port, protocol, description });
        await refreshFirewallSection();
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
        btn.disabled = false;
      }
    };
  });

  const addBtn = document.getElementById('fw-add-port-btn');
  if (addBtn) {
    addBtn.onclick = async () => {
      const portInput = document.getElementById('fw-new-port');
      const protocolSelect = document.getElementById('fw-new-protocol');
      const descInput = document.getElementById('fw-new-desc');
      const port = parseInt(portInput.value, 10);
      const protocol = protocolSelect.value;
      const description = descInput.value.trim();
      const msgEl = document.getElementById('fw-port-msg');

      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        msgEl.textContent = t('firewall.invalid_port');
        msgEl.className = 'action-msg error';
        return;
      }
      if (!window.confirm(t('firewall.confirm_add', { port, protocol: protocol.toUpperCase() }))) return;

      addBtn.disabled = true;
      msgEl.textContent = t('firewall.adding');
      msgEl.className = 'action-msg';
      try {
        await api('POST', '/firewall/entries', { port, protocol, description });
        await refreshFirewallSection();
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
        addBtn.disabled = false;
      }
    };
  }
}

const FAIL2BAN_SSH_EXAMPLE = `[sshd]
enabled = true
port = ssh
filter = sshd
logpath = %(sshd_log)s
backend = %(sshd_backend)s
maxretry = 5
bantime = 3600
findtime = 600
`;

async function renderFail2banSection() {
  try {
    const { content } = await api('GET', '/fail2ban/config');
    return `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:10px;">
        <div style="font-weight:600;font-size:13px;color:var(--muted);">${t('fail2ban.jail_config_label')}</div>
        <button type="button" class="secondary" id="fail2ban-insert-example-btn">${t('fail2ban.insert_ssh_example')}</button>
      </div>
      <textarea id="fail2ban-jail-textarea" rows="12" style="width:100%;font-family:var(--mono);font-size:12px;background:var(--input-bg);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px;box-sizing:border-box;resize:vertical;">${escapeHtml(content)}</textarea>
      <div class="service-actions" style="margin-top:10px;">
        <button type="button" id="fail2ban-save-btn">${t('fail2ban.save_button')}</button>
      </div>
      <div class="action-msg" id="fail2ban-config-msg"></div>
    `;
  } catch (e) {
    return `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

function wireFail2banSection() {
  const textarea = document.getElementById('fail2ban-jail-textarea');
  const insertBtn = document.getElementById('fail2ban-insert-example-btn');
  if (insertBtn && textarea) {
    insertBtn.onclick = () => {
      const sep = textarea.value && !textarea.value.endsWith('\n') ? '\n\n' : (textarea.value ? '\n' : '');
      textarea.value += sep + FAIL2BAN_SSH_EXAMPLE;
    };
  }

  const saveBtn = document.getElementById('fail2ban-save-btn');
  if (saveBtn && textarea) {
    saveBtn.onclick = async () => {
      const msgEl = document.getElementById('fail2ban-config-msg');
      saveBtn.disabled = true;
      msgEl.textContent = t('fail2ban.saving');
      msgEl.className = 'action-msg';
      try {
        await api('POST', '/fail2ban/config', { content: textarea.value });
        msgEl.textContent = t('fail2ban.save_success');
        msgEl.className = 'action-msg success';
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
      } finally {
        saveBtn.disabled = false;
      }
    };
  }
}

let turnstileAdminWidgetId = null;

async function renderTurnstileSection() {
  let cfg;
  try {
    cfg = await api('GET', '/caddy/turnstile');
  } catch (e) {
    return `<div class="system-info-card"><div class="empty-state">${escapeHtml(e.message)}</div></div>`;
  }
  const statusText = cfg.configured
    ? (cfg.enabled ? t('turnstile.status_enabled') : t('turnstile.status_disabled'))
    : t('turnstile.status_not_configured');
  const statusClass = cfg.enabled ? 'success' : '';
  return `
    <div class="system-info-card">
      <h3 style="margin:0 0 4px;font-size:15px;">${t('turnstile.title')}</h3>
      <p style="margin:0 0 14px;color:var(--muted);font-size:13px;">${t('turnstile.description')}</p>
      <div class="action-msg ${statusClass}" style="margin-bottom:10px;">${escapeHtml(statusText)}</div>
      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('turnstile.site_key_label')}</label>
      <input type="text" id="turnstile-site-key" value="${escapeHtml(cfg.siteKey || '')}" style="width:100%;margin-bottom:10px;">
      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('turnstile.secret_key_label')}</label>
      <input type="password" id="turnstile-secret-key" placeholder="${cfg.configured ? escapeHtml(t('turnstile.secret_key_saved_placeholder')) : ''}" style="width:100%;">
      <div id="turnstile-widget-container" style="margin:14px 0;display:none;"></div>
      <div class="service-actions">
        <button type="button" id="turnstile-verify-btn">${t('turnstile.verify_button')}</button>
        <button type="button" id="turnstile-apply-btn" style="display:none;">${t('turnstile.apply_button')}</button>
        ${cfg.configured ? `<button type="button" class="secondary" id="turnstile-toggle-btn" data-enable="${cfg.enabled ? '0' : '1'}">${cfg.enabled ? t('turnstile.disable_button') : t('turnstile.enable_button')}</button>` : ''}
      </div>
      <div class="action-msg" id="turnstile-msg"></div>
    </div>
  `;
}

function wireTurnstileSection() {
  const verifyBtn = document.getElementById('turnstile-verify-btn');
  const applyBtn = document.getElementById('turnstile-apply-btn');
  const toggleBtn = document.getElementById('turnstile-toggle-btn');
  const msgEl = document.getElementById('turnstile-msg');
  const widgetContainer = document.getElementById('turnstile-widget-container');
  if (!verifyBtn) return;

  verifyBtn.onclick = async () => {
    const siteKey = document.getElementById('turnstile-site-key').value.trim();
    const secretKey = document.getElementById('turnstile-secret-key').value.trim();
    if (!siteKey || !secretKey) {
      msgEl.textContent = t('turnstile.missing_keys');
      msgEl.className = 'action-msg error';
      return;
    }

    msgEl.textContent = t('turnstile.loading_widget');
    msgEl.className = 'action-msg';
    applyBtn.style.display = 'none';
    verifyBtn.disabled = true;

    try {
      await loadTurnstileScript();
      widgetContainer.style.display = 'block';
      widgetContainer.innerHTML = '';
      if (turnstileAdminWidgetId !== null) {
        try { window.turnstile.remove(turnstileAdminWidgetId); } catch { /* widget already gone */ }
      }
      turnstileAdminWidgetId = window.turnstile.render(widgetContainer, {
        sitekey: siteKey,
        theme: 'auto',
        callback: async (token) => {
          try {
            const result = await api('POST', '/caddy/turnstile/verify', { siteKey, secretKey, token });
            if (result.success) {
              msgEl.textContent = t('turnstile.verify_ok');
              msgEl.className = 'action-msg success';
              applyBtn.style.display = '';
              applyBtn.dataset.siteKey = siteKey;
              applyBtn.dataset.secretKey = secretKey;
            } else {
              msgEl.textContent = t('turnstile.verify_failed', { errors: (result['error-codes'] || []).join(', ') || '-' });
              msgEl.className = 'action-msg error';
            }
          } catch (e) {
            msgEl.textContent = e.message;
            msgEl.className = 'action-msg error';
          } finally {
            verifyBtn.disabled = false;
          }
        },
        'error-callback': () => {
          msgEl.textContent = t('turnstile.widget_error');
          msgEl.className = 'action-msg error';
          verifyBtn.disabled = false;
        }
      });
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
      verifyBtn.disabled = false;
    }
  };

  if (applyBtn) {
    applyBtn.onclick = async () => {
      if (!window.confirm(t('turnstile.confirm_apply'))) return;
      applyBtn.disabled = true;
      try {
        await api('POST', '/caddy/turnstile/apply', { siteKey: applyBtn.dataset.siteKey, secretKey: applyBtn.dataset.secretKey });
        await renderTab();
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
        applyBtn.disabled = false;
      }
    };
  }

  if (toggleBtn) {
    toggleBtn.onclick = async () => {
      const enabling = toggleBtn.dataset.enable === '1';
      if (!window.confirm(enabling ? t('turnstile.confirm_enable') : t('turnstile.confirm_disable'))) return;
      toggleBtn.disabled = true;
      try {
        await api('POST', '/caddy/turnstile/mode', { enabled: enabling });
        await renderTab();
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
        toggleBtn.disabled = false;
      }
    };
  }
}

const CADDYPERF_PROFILE_KEYS = ['balanced', 'low_ram', 'high_throughput'];
let CADDYPERF_PROFILE_BLOCKS = {};

async function renderCaddyPerformanceSection() {
  let status;
  try {
    status = await api('GET', '/caddy/performance');
  } catch (e) {
    return `<div class="system-info-card"><div class="empty-state">${escapeHtml(e.message)}</div></div>`;
  }
  CADDYPERF_PROFILE_BLOCKS = status.profileBlocks || {};

  const isExpertActive = status.profile === 'expert';
  const selectedProfile = status.active && !isExpertActive ? status.profile : 'balanced';
  const currentLabel = !status.active
    ? t('caddyperf.status_none')
    : (isExpertActive ? t('caddyperf.status_expert') : t(`caddyperf.profile_${status.profile}`));

  const profileOption = (key) => `
    <label style="display:flex;align-items:center;gap:6px;margin-right:16px;font-size:13px;">
      <input type="radio" name="caddyperf-profile" value="${key}" ${key === selectedProfile ? 'checked' : ''}>
      ${t(`caddyperf.profile_${key}`)}
    </label>
  `;

  const initialTextareaValue = isExpertActive ? status.block : (CADDYPERF_PROFILE_BLOCKS[selectedProfile] || '');

  return `
    <div class="system-info-card">
      <h3 style="margin:0 0 4px;font-size:15px;">${t('caddyperf.title')}</h3>
      <p style="margin:0 0 10px;color:var(--muted);font-size:13px;">${t('caddyperf.description')}</p>
      <p style="margin:0 0 14px;color:var(--danger);font-size:12px;">${t('caddyperf.warning')}</p>
      <div class="action-msg" style="margin-bottom:10px;">${escapeHtml(t('caddyperf.current_label'))}: ${escapeHtml(currentLabel)}</div>
      <div style="display:flex;flex-wrap:wrap;margin-bottom:12px;">
        ${CADDYPERF_PROFILE_KEYS.map(profileOption).join('')}
      </div>
      <label style="display:flex;align-items:center;gap:6px;margin-bottom:10px;font-size:13px;">
        <input type="checkbox" id="caddyperf-expert-toggle" ${isExpertActive ? 'checked' : ''}>
        ${t('caddyperf.expert_mode_label')}
      </label>
      <textarea id="caddyperf-expert-textarea" rows="10" style="width:100%;font-family:var(--mono);font-size:12px;background:var(--input-bg);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px;box-sizing:border-box;resize:vertical;display:${isExpertActive ? 'block' : 'none'};">${escapeHtml(initialTextareaValue)}</textarea>
      <div class="service-actions" style="margin-top:12px;">
        <button type="button" id="caddyperf-apply-btn">${t('caddyperf.apply_button')}</button>
      </div>
      <div class="action-msg" id="caddyperf-msg"></div>
    </div>
  `;
}

function wireCaddyPerformanceSection() {
  const applyBtn = document.getElementById('caddyperf-apply-btn');
  if (!applyBtn) return;
  const expertToggle = document.getElementById('caddyperf-expert-toggle');
  const textarea = document.getElementById('caddyperf-expert-textarea');
  const msgEl = document.getElementById('caddyperf-msg');

  function selectedProfileKey() {
    const checked = document.querySelector('input[name="caddyperf-profile"]:checked');
    return checked ? checked.value : 'balanced';
  }

  expertToggle.onchange = () => {
    textarea.style.display = expertToggle.checked ? 'block' : 'none';
    if (expertToggle.checked && !textarea.dataset.userEdited) {
      textarea.value = CADDYPERF_PROFILE_BLOCKS[selectedProfileKey()] || '';
    }
  };

  document.querySelectorAll('input[name="caddyperf-profile"]').forEach((radio) => {
    radio.onchange = () => {
      if (expertToggle.checked) {
        textarea.value = CADDYPERF_PROFILE_BLOCKS[selectedProfileKey()] || '';
        delete textarea.dataset.userEdited;
      }
    };
  });

  textarea.oninput = () => { textarea.dataset.userEdited = '1'; };

  applyBtn.onclick = async () => {
    if (!window.confirm(t('caddyperf.confirm_apply'))) return;
    applyBtn.disabled = true;
    msgEl.textContent = t('caddyperf.applying');
    msgEl.className = 'action-msg';
    try {
      const body = expertToggle.checked
        ? { profile: 'expert', expertBlock: textarea.value }
        : { profile: selectedProfileKey() };
      await api('POST', '/caddy/performance', body);
      await renderTab();
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
      applyBtn.disabled = false;
    }
  };
}

async function renderCaddyfileViewerSection() {
  try {
    const { content } = await api('GET', '/caddy/caddyfile');
    return `
      <div class="system-info-card">
        <h3 style="margin:0 0 10px;font-size:15px;">${t('caddyfile.title')}</h3>
        <textarea readonly rows="16" style="width:100%;font-family:var(--mono);font-size:12px;background:var(--input-bg);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px;box-sizing:border-box;resize:vertical;">${escapeHtml(content)}</textarea>
      </div>
    `;
  } catch (e) {
    return `<div class="system-info-card"><div class="empty-state">${escapeHtml(e.message)}</div></div>`;
  }
}

async function wrapCaddyExtras(serviceHtml) {
  const turnstileHtml = await renderTurnstileSection();
  const perfHtml = await renderCaddyPerformanceSection();
  const caddyfileHtml = await renderCaddyfileViewerSection();
  return `
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
      <div style="flex:1 1 45%;max-width:45%;">${serviceHtml}</div>
      <div style="flex:1 1 45%;max-width:45%;">${turnstileHtml}</div>
    </div>
    <div style="margin-top:16px;">${perfHtml}</div>
    <div style="margin-top:16px;">${caddyfileHtml}</div>
  `;
}

async function renderMariadbPerformanceSection() {
  let ramInfo;
  try {
    ramInfo = await api('GET', '/mariadb/ram-info');
  } catch (e) {
    return `<div class="system-info-card"><div class="empty-state">${escapeHtml(e.message)}</div></div>`;
  }
  const ramHint = t('mariadbperf.ram_hint', {
    total: ramInfo.totalMb,
    min: ramInfo.recommendedMinMb,
    max: ramInfo.recommendedMaxMb
  });

  return `
    <div class="system-info-card">
      <h3 style="margin:0 0 4px;font-size:15px;">${t('mariadbperf.title')}</h3>
      <p style="margin:0 0 16px;color:var(--muted);font-size:13px;">${t('mariadbperf.description')}</p>

      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('mariadbperf.buffer_pool_label')}</label>
      <input type="number" id="mariadbperf-buffer-pool" value="4096" min="16" style="width:100%;margin-bottom:4px;">
      <div style="font-size:11px;color:var(--muted);margin-bottom:14px;">${escapeHtml(ramHint)}</div>

      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('mariadbperf.max_connections_label')}</label>
      <input type="number" id="mariadbperf-max-connections" value="151" min="1" style="width:100%;margin-bottom:4px;">
      <div style="font-size:11px;color:var(--muted);margin-bottom:14px;">${t('mariadbperf.max_connections_hint')}</div>

      <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:4px;">
        <input type="checkbox" id="mariadbperf-perf-schema" checked>
        ${t('mariadbperf.perf_schema_label')}
      </label>
      <div style="font-size:11px;color:var(--muted);margin-bottom:16px;">${t('mariadbperf.perf_schema_hint')}</div>

      <button type="button" id="mariadbperf-save-btn">${t('mariadbperf.save_button')}</button>
      <div class="action-msg" id="mariadbperf-msg"></div>
    </div>
  `;
}

function wireMariadbPerformanceSection() {
  const btn = document.getElementById('mariadbperf-save-btn');
  if (!btn) return;
  const msgEl = document.getElementById('mariadbperf-msg');

  btn.onclick = async () => {
    const innodbBufferPoolMb = parseInt(document.getElementById('mariadbperf-buffer-pool').value, 10);
    const maxConnections = parseInt(document.getElementById('mariadbperf-max-connections').value, 10);
    const performanceSchema = document.getElementById('mariadbperf-perf-schema').checked;

    if (!Number.isInteger(innodbBufferPoolMb) || !Number.isInteger(maxConnections)) {
      msgEl.textContent = t('mariadbperf.invalid_values');
      msgEl.className = 'action-msg error';
      return;
    }
    if (!window.confirm(t('mariadbperf.confirm_save'))) return;

    btn.disabled = true;
    msgEl.textContent = t('mariadbperf.saving');
    msgEl.className = 'action-msg';
    try {
      await api('POST', '/mariadb/performance', { innodbBufferPoolMb, maxConnections, performanceSchema });
      msgEl.textContent = t('mariadbperf.save_success');
      msgEl.className = 'action-msg success';
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
    } finally {
      btn.disabled = false;
    }
  };
}

async function wrapMariadbExtras(serviceHtml) {
  const perfHtml = await renderMariadbPerformanceSection();
  return `
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
      <div style="flex:1 1 0;min-width:320px;">${serviceHtml}</div>
      <div style="flex:1 1 0;min-width:320px;">${perfHtml}</div>
    </div>
  `;
}

async function renderPostgresqlPerformanceSection() {
  let ramInfo;
  try {
    ramInfo = await api('GET', '/postgresql/ram-info');
  } catch (e) {
    return `<div class="system-info-card"><div class="empty-state">${escapeHtml(e.message)}</div></div>`;
  }
  const ramHint = t('postgresqlperf.ram_hint', {
    total: ramInfo.totalMb,
    min: ramInfo.recommendedMinMb,
    max: ramInfo.recommendedMaxMb
  });

  return `
    <div class="system-info-card">
      <h3 style="margin:0 0 4px;font-size:15px;">${t('postgresqlperf.title')}</h3>
      <p style="margin:0 0 16px;color:var(--muted);font-size:13px;">${t('postgresqlperf.description')}</p>

      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('postgresqlperf.shared_buffers_label')}</label>
      <input type="number" id="postgresqlperf-shared-buffers" value="1024" min="16" style="width:100%;margin-bottom:4px;">
      <div style="font-size:11px;color:var(--muted);margin-bottom:14px;">${escapeHtml(ramHint)}</div>

      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('postgresqlperf.max_connections_label')}</label>
      <input type="number" id="postgresqlperf-max-connections" value="100" min="1" style="width:100%;margin-bottom:4px;">
      <div style="font-size:11px;color:var(--muted);margin-bottom:14px;">${t('postgresqlperf.max_connections_hint')}</div>

      <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:4px;">
        <input type="checkbox" id="postgresqlperf-track-activities" checked>
        ${t('postgresqlperf.track_activities_label')}
      </label>
      <div style="font-size:11px;color:var(--muted);margin-bottom:16px;">${t('postgresqlperf.track_activities_hint')}</div>

      <button type="button" id="postgresqlperf-save-btn">${t('postgresqlperf.save_button')}</button>
      <div class="action-msg" id="postgresqlperf-msg"></div>
    </div>
  `;
}

function wirePostgresqlPerformanceSection() {
  const btn = document.getElementById('postgresqlperf-save-btn');
  if (!btn) return;
  const msgEl = document.getElementById('postgresqlperf-msg');

  btn.onclick = async () => {
    const sharedBuffersMb = parseInt(document.getElementById('postgresqlperf-shared-buffers').value, 10);
    const maxConnections = parseInt(document.getElementById('postgresqlperf-max-connections').value, 10);
    const trackActivities = document.getElementById('postgresqlperf-track-activities').checked;

    if (!Number.isInteger(sharedBuffersMb) || !Number.isInteger(maxConnections)) {
      msgEl.textContent = t('postgresqlperf.invalid_values');
      msgEl.className = 'action-msg error';
      return;
    }
    if (!window.confirm(t('postgresqlperf.confirm_save'))) return;

    btn.disabled = true;
    msgEl.textContent = t('postgresqlperf.saving');
    msgEl.className = 'action-msg';
    try {
      await api('POST', '/postgresql/performance', { sharedBuffersMb, maxConnections, trackActivities });
      msgEl.textContent = t('postgresqlperf.save_success');
      msgEl.className = 'action-msg success';
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
    } finally {
      btn.disabled = false;
    }
  };
}

async function wrapPostgresqlExtras(serviceHtml) {
  const perfHtml = await renderPostgresqlPerformanceSection();
  return `
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
      <div style="flex:1 1 0;min-width:320px;">${serviceHtml}</div>
      <div style="flex:1 1 0;min-width:320px;">${perfHtml}</div>
    </div>
  `;
}

async function renderMongodbPerformanceSection() {
  let ramInfo;
  try {
    ramInfo = await api('GET', '/mongodb/ram-info');
  } catch (e) {
    return `<div class="system-info-card"><div class="empty-state">${escapeHtml(e.message)}</div></div>`;
  }
  const ramHint = t('mongodbperf.ram_hint', {
    total: ramInfo.totalMb,
    recommended: ramInfo.recommendedGb
  });

  return `
    <div class="system-info-card">
      <h3 style="margin:0 0 4px;font-size:15px;">${t('mongodbperf.title')}</h3>
      <p style="margin:0 0 16px;color:var(--muted);font-size:13px;">${t('mongodbperf.description')}</p>

      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('mongodbperf.cache_size_label')}</label>
      <input type="number" id="mongodbperf-cache-size" value="${ramInfo.recommendedGb}" min="0.25" step="0.25" style="width:100%;margin-bottom:4px;">
      <div style="font-size:11px;color:var(--muted);margin-bottom:14px;">${escapeHtml(ramHint)}</div>

      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('mongodbperf.max_connections_label')}</label>
      <input type="number" id="mongodbperf-max-connections" value="500" min="1" style="width:100%;margin-bottom:4px;">
      <div style="font-size:11px;color:var(--muted);margin-bottom:14px;">${t('mongodbperf.max_connections_hint')}</div>

      <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:4px;">
        <input type="checkbox" id="mongodbperf-profiler">
        ${t('mongodbperf.profiler_label')}
      </label>
      <div style="font-size:11px;color:var(--muted);margin-bottom:16px;">${t('mongodbperf.profiler_hint')}</div>

      <button type="button" id="mongodbperf-save-btn">${t('mongodbperf.save_button')}</button>
      <div class="action-msg" id="mongodbperf-msg"></div>
    </div>
  `;
}

function wireMongodbPerformanceSection() {
  const btn = document.getElementById('mongodbperf-save-btn');
  if (!btn) return;
  const msgEl = document.getElementById('mongodbperf-msg');

  btn.onclick = async () => {
    const cacheSizeGb = parseFloat(document.getElementById('mongodbperf-cache-size').value);
    const maxConnections = parseInt(document.getElementById('mongodbperf-max-connections').value, 10);
    const profilerEnabled = document.getElementById('mongodbperf-profiler').checked;

    if (!Number.isFinite(cacheSizeGb) || !Number.isInteger(maxConnections)) {
      msgEl.textContent = t('mongodbperf.invalid_values');
      msgEl.className = 'action-msg error';
      return;
    }
    if (!window.confirm(t('mongodbperf.confirm_save'))) return;

    btn.disabled = true;
    msgEl.textContent = t('mongodbperf.saving');
    msgEl.className = 'action-msg';
    try {
      await api('POST', '/mongodb/performance', { cacheSizeGb, maxConnections, profilerEnabled });
      msgEl.textContent = t('mongodbperf.save_success');
      msgEl.className = 'action-msg success';
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
    } finally {
      btn.disabled = false;
    }
  };
}

async function wrapMongodbExtras(serviceHtml) {
  const perfHtml = await renderMongodbPerformanceSection();
  return `
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
      <div style="flex:1 1 0;min-width:320px;">${serviceHtml}</div>
      <div style="flex:1 1 0;min-width:320px;">${perfHtml}</div>
    </div>
  `;
}

async function renderRedisPerformanceSection() {
  let ramInfo;
  try {
    ramInfo = await api('GET', '/redis/ram-info');
  } catch (e) {
    return `<div class="system-info-card"><div class="empty-state">${escapeHtml(e.message)}</div></div>`;
  }
  const ramHint = t('redisperf.ram_hint', {
    total: ramInfo.totalMb,
    min: ramInfo.recommendedMinMb,
    max: ramInfo.recommendedMaxMb
  });

  return `
    <div class="system-info-card">
      <h3 style="margin:0 0 4px;font-size:15px;">${t('redisperf.title')}</h3>
      <p style="margin:0 0 16px;color:var(--muted);font-size:13px;">${t('redisperf.description')}</p>

      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('redisperf.maxmemory_label')}</label>
      <input type="number" id="redisperf-maxmemory" value="1024" min="16" style="width:100%;margin-bottom:4px;">
      <div style="font-size:11px;color:var(--muted);margin-bottom:14px;">${escapeHtml(ramHint)}</div>

      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('redisperf.max_clients_label')}</label>
      <input type="number" id="redisperf-max-clients" value="10000" min="1" style="width:100%;margin-bottom:4px;">
      <div style="font-size:11px;color:var(--muted);margin-bottom:14px;">${t('redisperf.max_clients_hint')}</div>

      <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:4px;">
        <input type="checkbox" id="redisperf-slowlog" checked>
        ${t('redisperf.slowlog_label')}
      </label>
      <div style="font-size:11px;color:var(--muted);margin-bottom:16px;">${t('redisperf.slowlog_hint')}</div>

      <button type="button" id="redisperf-save-btn">${t('redisperf.save_button')}</button>
      <div class="action-msg" id="redisperf-msg"></div>
    </div>
  `;
}

function wireRedisPerformanceSection() {
  const btn = document.getElementById('redisperf-save-btn');
  if (!btn) return;
  const msgEl = document.getElementById('redisperf-msg');

  btn.onclick = async () => {
    const maxmemoryMb = parseInt(document.getElementById('redisperf-maxmemory').value, 10);
    const maxClients = parseInt(document.getElementById('redisperf-max-clients').value, 10);
    const slowlogEnabled = document.getElementById('redisperf-slowlog').checked;

    if (!Number.isInteger(maxmemoryMb) || !Number.isInteger(maxClients)) {
      msgEl.textContent = t('redisperf.invalid_values');
      msgEl.className = 'action-msg error';
      return;
    }
    if (!window.confirm(t('redisperf.confirm_save'))) return;

    btn.disabled = true;
    msgEl.textContent = t('redisperf.saving');
    msgEl.className = 'action-msg';
    try {
      await api('POST', '/redis/performance', { maxmemoryMb, maxClients, slowlogEnabled });
      msgEl.textContent = t('redisperf.save_success');
      msgEl.className = 'action-msg success';
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
    } finally {
      btn.disabled = false;
    }
  };
}

async function wrapRedisExtras(serviceHtml) {
  const perfHtml = await renderRedisPerformanceSection();
  return `
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
      <div style="flex:1 1 0;min-width:320px;">${serviceHtml}</div>
      <div style="flex:1 1 0;min-width:320px;">${perfHtml}</div>
    </div>
  `;
}

function confirmMessageFor(key, action) {
  if (action === 'stop' && key === 'ssh') return t('services.confirm_stop_ssh');
  if (action === 'stop' && key === 'firewall') return t('services.confirm_stop_firewall');
  if (action === 'stop' && key === 'caddy') return t('services.confirm_stop_caddy');
  return t('services.confirm_action', { action: t('services.action_' + action) });
}

function wireServiceActions(key) {
  document.querySelectorAll('#content [data-action]').forEach((btn) => {
    btn.onclick = async () => {
      const action = btn.dataset.action;
      if (!window.confirm(confirmMessageFor(key, action))) return;

      const msgEl = document.getElementById(`${key}-action-msg`);
      document.querySelectorAll('#content [data-action]').forEach((b) => { b.disabled = true; });
      msgEl.textContent = t('services.action_pending');
      msgEl.className = 'action-msg';
      try {
        const svc = await api('POST', `/services/${key}/${action}`);
        let html = serviceDetailHtml(svc);
        if (key === 'ssh' && svc.found) html += await renderSshPortSection();
        if (key === 'firewall' && svc.found) html += `<div class="system-info-card" id="fw-section-container">${await renderFirewallSection()}</div>`;
        if (key === 'fail2ban' && svc.found) html += `<div class="system-info-card">${await renderFail2banSection()}</div>`;
        if (key === 'caddy' && svc.found) html = await wrapCaddyExtras(html);
        if (key === 'mariadb' && svc.found) html = await wrapMariadbExtras(html);
        if (key === 'postgresql' && svc.found) html = await wrapPostgresqlExtras(html);
        if (key === 'mongodb' && svc.found) html = await wrapMongodbExtras(html);
        if (key === 'redis' && svc.found) html = await wrapRedisExtras(html);
        document.getElementById('content').innerHTML = html;
        wireServiceActions(key);
        if (key === 'ssh' && svc.found) wireSshPortSection();
        if (key === 'firewall' && svc.found) wireFirewallSection();
        if (key === 'fail2ban' && svc.found) wireFail2banSection();
        if (key === 'caddy' && svc.found) { wireTurnstileSection(); wireCaddyPerformanceSection(); }
        if (key === 'mariadb' && svc.found) wireMariadbPerformanceSection();
        if (key === 'postgresql' && svc.found) wirePostgresqlPerformanceSection();
        if (key === 'mongodb' && svc.found) wireMongodbPerformanceSection();
        if (key === 'redis' && svc.found) wireRedisPerformanceSection();
        const successEl = document.getElementById(`${key}-action-msg`);
        successEl.textContent = t('services.action_success');
        successEl.className = 'action-msg success';
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
        document.querySelectorAll('#content [data-action]').forEach((b) => { b.disabled = false; });
      }
    };
  });
}

async function renderServiceDetailTab(key, content) {
  content.innerHTML = `<div class="empty-state">${t('services.loading')}</div>`;
  try {
    const svc = await api('GET', `/services/${key}`);
    let html = serviceDetailHtml(svc);
    if (key === 'ssh' && svc.found) html += await renderSshPortSection();
    if (key === 'firewall' && svc.found) html += `<div class="system-info-card" id="fw-section-container">${await renderFirewallSection()}</div>`;
    if (key === 'fail2ban' && svc.found) html += `<div class="system-info-card">${await renderFail2banSection()}</div>`;
    if (key === 'caddy' && svc.found) html = await wrapCaddyExtras(html);
    if (key === 'mariadb' && svc.found) html = await wrapMariadbExtras(html);
    if (key === 'postgresql' && svc.found) html = await wrapPostgresqlExtras(html);
    if (key === 'mongodb' && svc.found) html = await wrapMongodbExtras(html);
    if (key === 'redis' && svc.found) html = await wrapRedisExtras(html);
    content.innerHTML = html;
    wireServiceActions(key);
    if (key === 'ssh' && svc.found) wireSshPortSection();
    if (key === 'firewall' && svc.found) wireFirewallSection();
    if (key === 'fail2ban' && svc.found) wireFail2banSection();
    if (key === 'caddy' && svc.found) { wireTurnstileSection(); wireCaddyPerformanceSection(); }
    if (key === 'mariadb' && svc.found) wireMariadbPerformanceSection();
    if (key === 'postgresql' && svc.found) wirePostgresqlPerformanceSection();
    if (key === 'mongodb' && svc.found) wireMongodbPerformanceSection();
    if (key === 'redis' && svc.found) wireRedisPerformanceSection();
  } catch (e) {
    content.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

(async function init() {
  await setLanguage(detectDefaultLang());
  renderThemeSwitches();
  try {
    const status = await api('GET', '/auth/status');
    if (status.version) {
      const versionLabel = `v${status.version}`;
      document.getElementById('app-version-login').textContent = versionLabel;
      document.getElementById('app-version-header').textContent = versionLabel;
    }
    TURNSTILE_STATE = status.turnstile || { enabled: false, siteKey: '' };
    if (status.username) {
      showApp(status.username);
    } else {
      showLogin();
    }
  } catch {
    showLogin();
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
