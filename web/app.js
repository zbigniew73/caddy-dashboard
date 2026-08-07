const API = '/api';
const CORE_SERVICE_KEYS = ['ssh', 'firewall', 'cron', 'caddy'];
let SERVICE_DETAIL_TABS = [...CORE_SERVICE_KEYS];
let INSTALL_DETAIL_TABS = [];
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
    refreshDynamicNav();
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

async function refreshDynamicNav() {
  let services;
  try {
    services = (await api('GET', '/services')).services;
  } catch {
    return;
  }

  const installedExtra = services.filter((s) => s.found && !CORE_SERVICE_KEYS.includes(s.key));
  const installablePackages = services.filter((s) => s.installable);

  SERVICE_DETAIL_TABS = [...CORE_SERVICE_KEYS, ...installedExtra.map((s) => s.key)];
  INSTALL_DETAIL_TABS = installablePackages.map((s) => `install:${s.key}`);

  const extraContainer = document.getElementById('nav-installed-extra');
  extraContainer.innerHTML = installedExtra.map((s) =>
    `<button type="button" class="tab" data-tab="${escapeHtml(s.key)}">${escapeHtml(t(`services.${s.key}.name`))}</button>`
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
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;">
            <dl>
              <dt data-i18n="system.hostname"></dt><dd>${escapeHtml(info.hostname)}</dd>
              <dt data-i18n="system.os_name"></dt><dd>${escapeHtml(info.osName)}</dd>
              <dt data-i18n="system.platform"></dt><dd>${escapeHtml(info.platform)} / ${escapeHtml(info.arch)}</dd>
              <dt data-i18n="system.kernel"></dt><dd>${escapeHtml(info.release)}</dd>
              <dt data-i18n="system.uptime"></dt><dd>${formatUptime(info.uptimeSeconds)}</dd>
            </dl>
            <button type="button" class="danger" id="system-reboot-btn" style="flex-shrink:0;white-space:nowrap;">${t('system.reboot_button')}</button>
          </div>
          <div class="action-msg" id="system-reboot-msg"></div>
        </div>
        <div class="system-grid">
          ${meterTile(t('system.cpu'), info.cpu.usagePercent, cpuDetail)}
          ${meterTile(t('system.ram'), info.memory.usedPercent, ramDetail)}
          ${info.swap ? meterTile(t('system.swap'), info.swap.usedPercent, swapDetail) : ''}
          ${info.disk ? meterTile(diskLabel, info.disk.usedPercent, diskDetail) : ''}
        </div>
      `;
      applyTranslations();
      wireSystemRebootButton();
    } catch (e) {
      content.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
    }
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

async function renderInstallDetailTab(key, content) {
  content.innerHTML = `<div class="empty-state">${t('services.loading')}</div>`;
  try {
    const svc = await api('GET', `/services/${key}`);
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
        return `<tr><td>${escapeHtml(e.name)}</td><td>${t('firewall.type_service')}</td><td></td></tr>`;
      }
      const value = `${e.port}/${e.protocol}`;
      return `
        <tr>
          <td>${escapeHtml(e.port)}</td>
          <td>${escapeHtml(e.protocol.toUpperCase())}</td>
          <td><button type="button" class="danger" data-remove-type="port" data-remove-value="${escapeHtml(value)}">${t('firewall.remove')}</button></td>
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

  const addBtn = document.getElementById('fw-add-port-btn');
  if (addBtn) {
    addBtn.onclick = async () => {
      const portInput = document.getElementById('fw-new-port');
      const protocolSelect = document.getElementById('fw-new-protocol');
      const port = parseInt(portInput.value, 10);
      const protocol = protocolSelect.value;
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
        await api('POST', '/firewall/entries', { port, protocol });
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
        document.getElementById('content').innerHTML = html;
        wireServiceActions(key);
        if (key === 'ssh' && svc.found) wireSshPortSection();
        if (key === 'firewall' && svc.found) wireFirewallSection();
        if (key === 'fail2ban' && svc.found) wireFail2banSection();
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
    content.innerHTML = html;
    wireServiceActions(key);
    if (key === 'ssh' && svc.found) wireSshPortSection();
    if (key === 'firewall' && svc.found) wireFirewallSection();
    if (key === 'fail2ban' && svc.found) wireFail2banSection();
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
