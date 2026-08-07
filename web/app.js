const API = '/api';
const SERVICE_DETAIL_TABS = ['ssh', 'firewall', 'cron', 'caddy'];
let currentTab = 'system';

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
  }
}

function showLogin(msg) {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-error').textContent = msg || '';
}

function showApp(username) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  if (username) document.getElementById('current-user').textContent = username;
  renderTab();
  refreshUpdateBadge();
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
  } catch (e) {
    badge.textContent = t('update.error');
    badge.className = 'update-badge update';
    badge.disabled = false;
  }
};

document.getElementById('login-btn').onclick = async () => {
  const username = document.getElementById('username-input').value;
  const password = document.getElementById('password-input').value;
  try {
    const result = await api('POST', '/auth/login', { username, password });
    showApp(result.username);
  } catch (e) {
    document.getElementById('login-error').textContent = t('login.error_wrong_password');
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

async function renderTab() {
  const content = document.getElementById('content');
  if (currentTab === 'services') {
    await renderServicesTab(content);
    return;
  }
  if (SERVICE_DETAIL_TABS.includes(currentTab)) {
    await renderServiceDetailTab(currentTab, content);
    return;
  }
  if (currentTab === 'system') {
    content.innerHTML = `<div class="empty-state">${t('system.loading')}</div>`;
    try {
      const info = await api('GET', '/system');
      const cpuDetail = t('system.cpu_detail', { model: info.cpu.model || '-', cores: info.cpu.cores });
      const ramDetail = t('system.used_of', { used: formatBytes(info.memory.usedBytes), total: formatBytes(info.memory.totalBytes) });
      const diskLabel = info.disk ? t('system.disk', { path: info.disk.path }) : null;
      const diskDetail = info.disk ? t('system.used_of', { used: formatBytes(info.disk.usedBytes), total: formatBytes(info.disk.totalBytes) }) : null;
      const swapDetail = info.swap ? t('system.used_of', { used: formatBytes(info.swap.usedBytes), total: formatBytes(info.swap.totalBytes) }) : null;

      content.innerHTML = `
        <div class="system-info-card">
          <dl>
            <dt data-i18n="system.hostname"></dt><dd>${escapeHtml(info.hostname)}</dd>
            <dt data-i18n="system.os_name"></dt><dd>${escapeHtml(info.osName)}</dd>
            <dt data-i18n="system.platform"></dt><dd>${escapeHtml(info.platform)} / ${escapeHtml(info.arch)}</dd>
            <dt data-i18n="system.kernel"></dt><dd>${escapeHtml(info.release)}</dd>
            <dt data-i18n="system.uptime"></dt><dd>${formatUptime(info.uptimeSeconds)}</dd>
          </dl>
        </div>
        <div class="system-grid">
          ${meterTile(t('system.cpu'), info.cpu.usagePercent, cpuDetail)}
          ${meterTile(t('system.ram'), info.memory.usedPercent, ramDetail)}
          ${info.swap ? meterTile(t('system.swap'), info.swap.usedPercent, swapDetail) : ''}
          ${info.disk ? meterTile(diskLabel, info.disk.usedPercent, diskDetail) : ''}
        </div>
      `;
      applyTranslations();
    } catch (e) {
      content.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
    }
  }
}

function serviceCard(svc) {
  const name = t(`services.${svc.key}.name`);
  if (!svc.found) {
    return `
      <div class="service-card">
        <div class="service-card-header">
          <span class="service-name">${escapeHtml(name)}</span>
          <span class="status-badge unknown">${t('services.not_installed')}</span>
        </div>
        <div class="service-detail">${t('services.not_installed_detail')}</div>
      </div>
    `;
  }
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
    if (!services.length) {
      content.innerHTML = `<div class="empty-state">${t('services.empty')}</div>`;
      return;
    }
    content.innerHTML = `<div class="services-grid">${services.map(serviceCard).join('')}</div>`;
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
        document.getElementById('content').innerHTML = serviceDetailHtml(svc);
        wireServiceActions(key);
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
    content.innerHTML = serviceDetailHtml(svc);
    wireServiceActions(key);
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
    if (status.username) {
      showApp(status.username);
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
})();
