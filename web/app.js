const API = '/api';
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
  if (document.getElementById('app').style.display === 'flex') renderTab();
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
}

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

document.querySelectorAll('nav .tab').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('nav .tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentTab = btn.dataset.tab;
    renderTab();
  };
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
  if (currentTab === 'system') {
    content.innerHTML = `<div class="empty-state">${t('system.loading')}</div>`;
    try {
      const info = await api('GET', '/system');
      const cpuDetail = t('system.cpu_detail', { model: info.cpu.model || '-', cores: info.cpu.cores });
      const ramDetail = t('system.used_of', { used: formatBytes(info.memory.usedBytes), total: formatBytes(info.memory.totalBytes) });
      const diskLabel = info.disk ? t('system.disk', { path: info.disk.path }) : null;
      const diskDetail = info.disk ? t('system.used_of', { used: formatBytes(info.disk.usedBytes), total: formatBytes(info.disk.totalBytes) }) : null;

      content.innerHTML = `
        <div class="system-info-card">
          <dl>
            <dt data-i18n="system.hostname"></dt><dd>${escapeHtml(info.hostname)}</dd>
            <dt data-i18n="system.platform"></dt><dd>${escapeHtml(info.platform)} / ${escapeHtml(info.arch)}</dd>
            <dt data-i18n="system.kernel"></dt><dd>${escapeHtml(info.release)}</dd>
            <dt data-i18n="system.uptime"></dt><dd>${formatUptime(info.uptimeSeconds)}</dd>
          </dl>
        </div>
        <div class="system-grid">
          ${meterTile(t('system.cpu'), info.cpu.usagePercent, cpuDetail)}
          ${meterTile(t('system.ram'), info.memory.usedPercent, ramDetail)}
          ${info.disk ? meterTile(diskLabel, info.disk.usedPercent, diskDetail) : ''}
        </div>
      `;
      applyTranslations();
    } catch (e) {
      content.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
    }
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
    if (status.username) {
      showApp(status.username);
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
})();
