const API = '/api';
const CORE_SERVICE_KEYS = ['ssh', 'firewall', 'cron', 'runtime-manager', 'caddy'];
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
  redis: '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/></svg>',
  phpmyadmin: '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>',
  adminer: '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/><path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/></svg>',
  roundcube: '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/></svg>'
};
const PHP_ICON = '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="8 6 3 12 8 18"/><polyline points="16 6 21 12 16 18"/></svg>';
function navIcon(key) {
  if (/^php\d{2}$/.test(key)) return PHP_ICON;
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
  renderTurnstilePreviews();
  renderPhpmyadminGatePreview();
  renderAdminerGatePreview();
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
    if (result.role === 'user') {
      window.location.href = result.redirect || '/user/';
      return;
    }
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

  // "php-fpm" to tylko wpis kafelka instalacji (wielokrotny wybor wersji) -
  // nigdy zakladka w GLOWNE, tam trafiaja pojedyncze zainstalowane wersje
  // (klucze "phpXX", dolaczane przez serwer po istniejacych uslugach, wiec
  // wychodza na liscie po Redis - patrz server/routes/api.js phpServiceEntries()).
  // 'mail' wykluczone jak 'php-fpm' - to tylko trigger instalacji
  // (kafelek "MAIL SERVER"). 'postfix'/'dovecot' rowniez wykluczone z
  // LEWEGO PASKA NAWIGACJI - ich Start/Stop/Restart zyje przede
  // wszystkim w dedykowanej zakladce Poczta (renderMailTab), zeby nie
  // dublowac sterowania w dwoch miejscach.
  const installedExtra = services.filter((s) => s.found && !CORE_SERVICE_KEYS.includes(s.key) && s.key !== 'php-fpm' && s.key !== 'mail' && s.key !== 'postfix' && s.key !== 'dovecot');
  const installablePackages = services.filter((s) => s.installable);

  // 'dovecot' MA wlasny pelny kafelek (i strone szczegolow w stylu
  // sshd.service - unit/status/wlaczony/pid/od kiedy + Start/Stop/
  // Restart) w ogolnej zakladce USLUGI, mimo ze nie ma go w lewym
  // pasku nawigacji powyzej - stad osobne dopisanie tutaj, poza
  // 'installedExtra'. 'postfix' celowo NIE dostaje tego (zostaje
  // wylacznie w Poczcie).
  const dovecotFound = services.some((s) => s.key === 'dovecot' && s.found);
  SERVICE_DETAIL_TABS = [...CORE_SERVICE_KEYS, ...installedExtra.map((s) => s.key), ...(dovecotFound ? ['dovecot'] : [])];
  INSTALL_DETAIL_TABS = installablePackages.map((s) => `install:${s.key}`);

  const extraContainer = document.getElementById('nav-installed-extra');
  extraContainer.innerHTML = installedExtra.map((s) =>
    `<button type="button" class="tab" data-tab="${escapeHtml(s.key)}">${navIcon(s.key)}<span>${escapeHtml(s.name || t(`services.${s.key}.name`))}</span></button>`
  ).join('');
  extraContainer.querySelectorAll('button').forEach((btn) => {
    btn.onclick = () => switchTab(btn.dataset.tab);
  });

  const installContainer = document.getElementById('nav-install-list');
  installContainer.innerHTML = installablePackages.map((s) =>
    `<button type="button" class="tab${s.found ? '' : ' install-pending'}" data-tab="install:${escapeHtml(s.key)}">${escapeHtml(s.name || t(`services.${s.key}.name`))}</button>`
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

// Lewy kafelek Postfix, prawy Dovecot - markup dzielony z serviceDetailHtml
// (ta sama karta co w zakladce Uslugi, z dopisanym naglowkiem), stan i
// kontrolki nadal czytane/sterowane przez generyczny mechanizm uslug
// (GET/POST /services/:key(/:action)). Brak potwierdzenia przed akcja
// (celowo, w odroznieniu od wireServiceActions) - tak bylo od zawsze na
// tej zakladce, zostawiamy bez zmian. Jesli pakiety nie sa jeszcze
// zainstalowane (found=false), pusty stan z podpowiedzia "zainstaluj z
// Instalatora", w tym samym pudelku co reszta kart (system-info-card).
function mailServiceCardHtml(title, svc) {
  if (!svc.found) {
    return `
      <div class="system-info-card">
        <h3>${escapeHtml(title)}</h3>
        <div class="empty-state">${t('mail.not_installed_hint')}</div>
      </div>
    `;
  }
  return serviceDetailHtml(svc, title);
}

function wireMailServiceCards(content) {
  content.querySelectorAll('[data-key][data-action]').forEach((btn) => {
    btn.onclick = async () => {
      const key = btn.dataset.key;
      const action = btn.dataset.action;
      const msgEl = document.getElementById(`${key}-action-msg`);
      content.querySelectorAll(`[data-key="${key}"]`).forEach((b) => { b.disabled = true; });
      msgEl.textContent = '';
      msgEl.className = 'action-msg';
      try {
        await api('POST', `/services/${key}/${action}`);
        await renderMailTab(content);
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
        content.querySelectorAll(`[data-key="${key}"]`).forEach((b) => { b.disabled = false; });
      }
    };
  });
}

// Drugi rzad Poczty: lewy kafelek to lista kont hostingowych z
// przelacznikiem dostepu do skrzynki (mechanizm - patrz
// server/scripts/mail-toggle-access.sh: pam_listfile w DEDYKOWANYM pliku
// PAM Dovecota, wiec SSH danego konta nigdy sie nie zmienia). Konta
// hostingowe to JEDYNE konta z dostepem do poczty (logowanie Dovecota =
// to samo haslo co SSH przez PAM - patrz mail-install.sh), wiec zrodlem
// listy jest zwykle /accounts, tu przez dedykowany /mail/access, ktory
// dokleja stan wlaczony/wylaczony.
async function renderMailAccessSection() {
  let accounts;
  try {
    accounts = (await api('GET', '/mail/access')).accounts;
  } catch (e) {
    return `<div class="system-info-card"><div class="empty-state">${escapeHtml(e.message)}</div></div>`;
  }
  const rows = accounts.map((a) => `
    <tr>
      <td>${escapeHtml(a.username)}</td>
      <td>${escapeHtml(a.fullName || a.email || '-')}</td>
      <td><span class="status-badge ${a.mailEnabled ? 'active' : 'inactive'}">${a.mailEnabled ? t('mail.access_enabled') : t('mail.access_disabled')}</span></td>
      <td>${t('mail.limit_value', { mailboxes: a.mailLimit.mailboxes, aliases: a.mailLimit.aliases })}
        <button type="button" class="secondary" data-mail-limit-user="${escapeHtml(a.username)}" data-mail-limit-mailboxes="${a.mailLimit.mailboxes}" data-mail-limit-aliases="${a.mailLimit.aliases}">${t('mail.limit_edit_button')}</button>
      </td>
      <td>${a.mailEnabled
        ? `<button type="button" class="danger" data-mail-access-user="${escapeHtml(a.username)}" data-mail-access-action="disable">${t('mail.disable_button')}</button>`
        : `<button type="button" data-mail-access-user="${escapeHtml(a.username)}" data-mail-access-action="enable">${t('mail.enable_button')}</button>`}
      </td>
    </tr>
  `).join('');

  return `
    <div class="system-info-card">
      <h3>${t('mail.access_title')}</h3>
      <p style="margin:0 0 16px;color:var(--accent);font-size:13px;">${t('mail.access_limit_note')}</p>
      ${accounts.length ? `
        <table class="firewall-table">
          <thead>
            <tr>
              <th>${t('mail.column_account')}</th>
              <th>${t('mail.column_contact')}</th>
              <th>${t('mail.column_access')}</th>
              <th>${t('mail.column_limit')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      ` : `<div class="empty-state">${t('mail.access_empty')}</div>`}
      <div class="action-msg" id="mail-access-msg"></div>
    </div>
  `;
}

function wireMailAccessSection(content) {
  content.querySelectorAll('[data-mail-access-user]').forEach((btn) => {
    btn.onclick = async () => {
      const username = btn.dataset.mailAccessUser;
      const enable = btn.dataset.mailAccessAction === 'enable';
      const confirmMsg = enable
        ? t('mail.confirm_enable', { account: username })
        : t('mail.confirm_disable', { account: username });
      if (!window.confirm(confirmMsg)) return;

      const msgEl = document.getElementById('mail-access-msg');
      content.querySelectorAll('[data-mail-access-user]').forEach((b) => { b.disabled = true; });
      msgEl.textContent = t('mail.access_working');
      msgEl.className = 'action-msg';
      try {
        await api('POST', `/mail/access/${username}`, { enabled: enable });
        await renderMailTab(content);
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
        content.querySelectorAll('[data-mail-access-user]').forEach((b) => { b.disabled = false; });
      }
    };
  });

  content.querySelectorAll('[data-mail-limit-user]').forEach((btn) => {
    btn.onclick = async () => {
      const username = btn.dataset.mailLimitUser;
      const mailboxesInput = window.prompt(t('mail.limit_prompt_mailboxes', { account: username }), btn.dataset.mailLimitMailboxes);
      if (mailboxesInput === null) return;
      const mailboxes = parseInt(mailboxesInput, 10);
      if (!Number.isInteger(mailboxes) || mailboxes < 0) {
        window.alert(t('mail.limit_invalid'));
        return;
      }
      const aliasesInput = window.prompt(t('mail.limit_prompt_aliases', { account: username }), btn.dataset.mailLimitAliases);
      if (aliasesInput === null) return;
      const aliases = parseInt(aliasesInput, 10);
      if (!Number.isInteger(aliases) || aliases < 0) {
        window.alert(t('mail.limit_invalid'));
        return;
      }
      btn.disabled = true;
      try {
        await api('PUT', `/mail/access/${username}/limit`, { mailboxes, aliases });
        await renderMailTab(content);
      } catch (e) {
        window.alert(e.message);
        btn.disabled = false;
      }
    };
  });
}

// Prawy kafelek statystyczny (Poczta, drugi rzad). "Certyfikat TLS" jest
// TERAZ dynamiczny (GET /mail/tls-status - czyta `postconf -h
// smtpd_tls_cert_file`, bez sudo), nie stala wartosc jak wczesniej -
// odzwierciedla realny stan Postfixa/Dovecota po ewentualnej podmianie
// (patrz mail-tls-swap.sh). Wiersz z przyciskami Wlacz/Wylacz pokazuje
// sie TYLKO gdy Caddy faktycznie juz wydal zaufany certyfikat Let's
// Encrypt dla mail.<domena Roundcube'a> (GET /mail/cert-status,
// checkMailCertTrusted - prawdziwe polaczenie TLS, nie zgadywanie po
// plikach) - bez tego przelacznik i tak nie mialby czego wlaczyc.
async function renderMailStatsSection() {
  let accounts = [];
  try {
    accounts = (await api('GET', '/mail/access')).accounts;
  } catch {
    accounts = [];
  }
  let queueCount = null;
  try {
    queueCount = (await api('GET', '/mail/stats')).queueCount;
  } catch {
    queueCount = null;
  }
  const enabledCount = accounts.filter((a) => a.mailEnabled).length;
  const queueText = queueCount === null ? t('mail.stats_queue_unavailable') : t('mail.stats_queue_value', { count: queueCount });

  let tlsActive = null;
  let tlsDaysRemaining = null;
  try {
    const tlsStatus = await api('GET', '/mail/tls-status');
    tlsActive = tlsStatus.active;
    tlsDaysRemaining = tlsStatus.daysRemaining;
  } catch {
    tlsActive = null;
    tlsDaysRemaining = null;
  }
  const tlsValueText = tlsActive === 'letsencrypt'
    ? (tlsDaysRemaining === null ? t('mail.stats_tls_value_le') : t('mail.stats_tls_value_le_days', { days: tlsDaysRemaining }))
    : t('mail.stats_tls_value');
  // Kolor odliczania do odnowienia - TYLKO dla Let's Encrypt z dniami:
  // >30 zielony (spokojnie), 10-30 zolty (czas kliknac Wlacz ponownie po
  // odnowieniu przez Caddy), <10 czerwony (pilne). Self-signed/brak
  // danych zostaje bez koloru (nie jest to odliczanie do niczego).
  let tlsValueColor = '';
  if (tlsActive === 'letsencrypt' && tlsDaysRemaining !== null) {
    if (tlsDaysRemaining > 30) tlsValueColor = 'var(--accent)';
    else if (tlsDaysRemaining >= 10) tlsValueColor = 'var(--warning)';
    else tlsValueColor = 'var(--danger)';
  }
  const tlsValueHtml = tlsValueColor ? `<span style="color:${tlsValueColor};">${tlsValueText}</span>` : tlsValueText;

  let certRow = '';
  try {
    const certStatus = await api('GET', '/mail/cert-status');
    if (certStatus.available) {
      const isActive = tlsActive === 'letsencrypt';
      certRow = `
        <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;">
            <p style="margin:0;color:var(--accent);font-size:13px;">${t('mail.stats_cert_available', { host: certStatus.hostname })}</p>
            <div style="display:flex;gap:10px;flex-shrink:0;">
              <button type="button" id="mail-tls-enable-btn" ${isActive ? 'disabled' : ''}>${t('mail.tls_enable_button')}</button>
              <button type="button" class="danger" id="mail-tls-disable-btn" ${isActive ? '' : 'disabled'}>${t('mail.tls_disable_button')}</button>
            </div>
          </div>
          <div class="action-msg" id="mail-tls-msg"></div>
        </div>
      `;
    }
  } catch {
    certRow = '';
  }

  return `
    <div class="system-info-card">
      <h3>${t('mail.stats_title')}</h3>
      <div style="display:flex;gap:24px;flex-wrap:wrap;">
        <dl style="flex:1 1 0;min-width:160px;">
          <dt>${t('mail.stats_accounts_label')}</dt><dd>${enabledCount} / ${accounts.length}</dd>
          <dt>${t('mail.stats_queue_label')}</dt><dd>${escapeHtml(queueText)}</dd>
          <dt>${t('mail.stats_tls_label')}</dt><dd>${tlsValueHtml}</dd>
        </dl>
        <dl style="flex:1 1 0;min-width:120px;">
          <dt>SMTP</dt><dd>25</dd>
          <dt>SMTPS</dt><dd>465 | 587</dd>
          <dt>IMAP</dt><dd>143</dd>
          <dt>IMAPS</dt><dd>993</dd>
        </dl>
      </div>
      ${certRow}
    </div>
  `;
}

function wireMailTlsSwapSection(content) {
  const enableBtn = document.getElementById('mail-tls-enable-btn');
  const disableBtn = document.getElementById('mail-tls-disable-btn');
  if (!enableBtn && !disableBtn) return;
  const msgEl = document.getElementById('mail-tls-msg');

  const run = async (enabled, confirmMsg) => {
    if (!window.confirm(confirmMsg)) return;
    if (enableBtn) enableBtn.disabled = true;
    if (disableBtn) disableBtn.disabled = true;
    msgEl.textContent = t('mail.tls_working');
    msgEl.className = 'action-msg';
    try {
      await api('POST', '/mail/tls-swap', { enabled });
      await renderMailTab(content);
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
      if (enableBtn) enableBtn.disabled = false;
      if (disableBtn) disableBtn.disabled = false;
    }
  };

  if (enableBtn) enableBtn.onclick = () => run(true, t('mail.tls_confirm_enable'));
  if (disableBtn) disableBtn.onclick = () => run(false, t('mail.tls_confirm_disable'));
}

async function renderMailTab(content) {
  content.innerHTML = `<div class="empty-state">${t('services.loading')}</div>`;
  try {
    const [postfix, dovecot, accessHtml, statsHtml] = await Promise.all([
      api('GET', '/services/postfix'),
      api('GET', '/services/dovecot'),
      renderMailAccessSection(),
      renderMailStatsSection()
    ]);
    content.innerHTML = `
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
        <div style="flex:1 1 0;min-width:320px;">${mailServiceCardHtml(t('mail.postfix_title'), postfix)}</div>
        <div style="flex:1 1 0;min-width:320px;">${mailServiceCardHtml(t('mail.dovecot_title'), dovecot)}</div>
      </div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;margin-top:16px;">
        <div style="flex:1 1 0;min-width:320px;">${accessHtml}</div>
        <div style="flex:1 1 0;min-width:320px;">${statsHtml}</div>
      </div>
    `;
    applyTranslations();
    wireMailServiceCards(content);
    wireMailAccessSection(content);
    wireMailTlsSwapSection(content);
  } catch (e) {
    content.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

async function renderTab() {
  const content = document.getElementById('content');
  if (currentTab !== 'system') stopSystemAutoRefresh();

  if (currentTab === 'packages') {
    await renderPackagesTab(content);
    return;
  }
  if (currentTab === 'accounts') {
    await renderAccountsTab(content);
    return;
  }
  if (currentTab === 'mail') {
    await renderMailTab(content);
    return;
  }
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
      ['system.python_version', escapeHtml(info.versions.python || t('system.not_found'))],
      ['system.restic_version', escapeHtml(info.versions.restic || t('system.not_found'))]
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

function phpmyadminInfoCardHtml(status, includeActions, constrainWidth = true) {
  const name = t('services.phpmyadmin.name');
  if (!status.installed) return '';
  return `
    <div class="system-info-card"${constrainWidth ? ' style="max-width:640px;"' : ''}>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:12px;">
        <div style="font-weight:600;font-size:15px;">${escapeHtml(name)}</div>
        <span class="status-badge active">${t('install.installed_badge')}</span>
      </div>
      <dl style="margin:0 0 16px;">
        <dt>${t('phpmyadmin.version_label')}</dt><dd style="font-family:monospace;">${escapeHtml(status.version || '-')}</dd>
        <dt>${t('phpmyadmin.docroot_label')}</dt><dd style="font-family:monospace;">${escapeHtml(status.docroot)}</dd>
        <dt>${t('phpmyadmin.socket_label')}</dt><dd style="font-family:monospace;">${escapeHtml(status.socketPath)}</dd>
      </dl>
      <p style="margin:0 0 8px;color:var(--muted);font-size:13px;">${t('phpmyadmin.caddy_hint')}</p>
      <pre style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:12px;font-size:12px;overflow-x:auto;margin:0 0 16px;">${escapeHtml(status.caddyBlock)}</pre>
      ${includeActions ? `
        <button type="button" class="danger" id="phpmyadmin-uninstall-btn">${t('phpmyadmin.uninstall_button')}</button>
        <div class="action-msg" id="phpmyadmin-msg"></div>
      ` : ''}
    </div>
  `;
}

function phpmyadminGateCaddyBlock(status) {
  return `pma.twojadomena.pl {
	handle /pma-gate/* {
		reverse_proxy 127.0.0.1:4300
	}
	handle {
		forward_auth 127.0.0.1:4300 {
			uri /pma-gate/check
		}
		header -X-Powered-By
		root * ${status.docroot}
		php_fastcgi unix/${status.socketPath}
		file_server
	}
}`;
}

async function renderPhpmyadminGateSection(pmaStatus) {
  let gate;
  try {
    gate = await api('GET', '/phpmyadmin-gate');
  } catch (e) {
    return `<div class="system-info-card"><div class="empty-state">${escapeHtml(e.message)}</div></div>`;
  }
  return `
    <div class="system-info-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:12px;">
        <div>
          <div style="font-weight:600;font-size:15px;margin-bottom:8px;">${t('phpmyadmin.gate_title')}</div>
          <span class="status-badge ${gate.enabled ? 'active' : 'inactive'}">${gate.enabled ? t('phpmyadmin.gate_enabled') : t('phpmyadmin.gate_disabled')}</span>
        </div>
        <div id="phpmyadmin-gate-preview-box" style="flex:0 0 auto;border:1px solid var(--border);border-radius:8px;padding:8px;pointer-events:none;">
          <div id="phpmyadmin-gate-preview"></div>
        </div>
      </div>
      <p style="margin:0 0 16px;color:var(--muted);font-size:13px;line-height:1.5;">${t('phpmyadmin.gate_description')}</p>
      ${!gate.turnstileConfigured ? `<div class="empty-state" style="margin-bottom:16px;">${t('phpmyadmin.gate_requires_turnstile')}</div>` : ''}
      <ol style="margin:0 0 16px;padding-left:20px;font-size:13px;line-height:1.8;">
        <li>${t('phpmyadmin.gate_step1')}</li>
        <li>${t('phpmyadmin.gate_step2')}</li>
        <li>${t('phpmyadmin.gate_step3')}</li>
      </ol>
      <p style="margin:0 0 8px;color:var(--muted);font-size:13px;">${t('phpmyadmin.gate_caddy_hint')}</p>
      <pre style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:12px;font-size:12px;overflow-x:auto;margin:0 0 16px;">${escapeHtml(phpmyadminGateCaddyBlock(pmaStatus))}</pre>
      <button type="button" id="phpmyadmin-gate-enable-btn" ${gate.enabled || !gate.turnstileConfigured ? 'disabled' : ''}>${t('phpmyadmin.gate_enable_button')}</button>
      <button type="button" class="danger" id="phpmyadmin-gate-disable-btn" ${gate.enabled ? '' : 'disabled'}>${t('phpmyadmin.gate_disable_button')}</button>
      <div class="action-msg" id="phpmyadmin-gate-msg"></div>
    </div>
  `;
}

function wirePhpmyadminGateSection(pmaStatus) {
  renderPhpmyadminGatePreview();
  const enableBtn = document.getElementById('phpmyadmin-gate-enable-btn');
  const disableBtn = document.getElementById('phpmyadmin-gate-disable-btn');
  if (!enableBtn || !disableBtn) return;
  const msgEl = document.getElementById('phpmyadmin-gate-msg');

  async function refresh() {
    const container = enableBtn.closest('.system-info-card');
    if (container) {
      container.outerHTML = await renderPhpmyadminGateSection(pmaStatus);
      applyTranslations();
      wirePhpmyadminGateSection(pmaStatus);
    }
  }

  enableBtn.onclick = async () => {
    if (!window.confirm(t('phpmyadmin.gate_confirm_enable'))) return;
    enableBtn.disabled = true;
    msgEl.textContent = t('testdb.working');
    msgEl.className = 'action-msg';
    try {
      await api('POST', '/phpmyadmin-gate', { enabled: true });
      await refresh();
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
      enableBtn.disabled = false;
    }
  };

  disableBtn.onclick = async () => {
    if (!window.confirm(t('phpmyadmin.gate_confirm_disable'))) return;
    disableBtn.disabled = true;
    msgEl.textContent = t('testdb.working');
    msgEl.className = 'action-msg';
    try {
      await api('POST', '/phpmyadmin-gate', { enabled: false });
      await refresh();
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
      disableBtn.disabled = false;
    }
  };
}

function phpmyadminInstallTileHtml(status) {
  const name = t('services.phpmyadmin.name');
  if (status.installed) return phpmyadminInfoCardHtml(status, true);

  if (!status.php83Installed) {
    return `
      <div class="system-info-card" style="max-width:560px;">
        <div style="font-weight:600;font-size:15px;margin-bottom:8px;">${escapeHtml(name)}</div>
        <div class="empty-state">${t('phpmyadmin.requires_php83')}</div>
      </div>
    `;
  }

  return `
    <div class="system-info-card" style="max-width:560px;">
      <div style="font-weight:600;font-size:15px;margin-bottom:8px;">${escapeHtml(name)}</div>
      <p style="color:var(--muted);font-size:13px;line-height:1.5;margin:0 0 16px;">${t('install.phpmyadmin.description')}</p>
      <button type="button" id="phpmyadmin-install-btn">${t('install.install_button')}</button>
      <div class="action-msg" id="phpmyadmin-msg"></div>
    </div>
  `;
}

function wirePhpmyadminInstallTile() {
  const installBtn = document.getElementById('phpmyadmin-install-btn');
  const uninstallBtn = document.getElementById('phpmyadmin-uninstall-btn');
  const msgEl = document.getElementById('phpmyadmin-msg');

  if (installBtn) {
    installBtn.onclick = async () => {
      if (!window.confirm(t('install.phpmyadmin.confirm_install'))) return;
      installBtn.disabled = true;
      msgEl.textContent = t('install.installing');
      msgEl.className = 'action-msg';
      try {
        await api('POST', '/phpmyadmin/install');
        const status = await api('GET', '/phpmyadmin');
        document.getElementById('content').innerHTML = phpmyadminInstallTileHtml(status);
        applyTranslations();
        wirePhpmyadminInstallTile();
        const successEl = document.getElementById('phpmyadmin-msg');
        if (successEl) {
          successEl.textContent = t('install.install_success');
          successEl.className = 'action-msg success';
        }
        await refreshDynamicNav();
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
        installBtn.disabled = false;
      }
    };
  }

  if (uninstallBtn) {
    uninstallBtn.onclick = async () => {
      if (!window.confirm(t('phpmyadmin.confirm_uninstall'))) return;
      uninstallBtn.disabled = true;
      msgEl.textContent = t('testdb.working');
      msgEl.className = 'action-msg';
      try {
        await api('POST', '/phpmyadmin/uninstall');
        const status = await api('GET', '/phpmyadmin');
        document.getElementById('content').innerHTML = phpmyadminInstallTileHtml(status);
        applyTranslations();
        wirePhpmyadminInstallTile();
        await refreshDynamicNav();
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
        uninstallBtn.disabled = false;
      }
    };
  }
}

function adminerInfoCardHtml(status, includeActions, constrainWidth = true) {
  const name = t('services.adminer.name');
  if (!status.installed) return '';
  return `
    <div class="system-info-card"${constrainWidth ? ' style="max-width:640px;"' : ''}>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:12px;">
        <div style="font-weight:600;font-size:15px;">${escapeHtml(name)}</div>
        <span class="status-badge active">${t('install.installed_badge')}</span>
      </div>
      <dl style="margin:0 0 16px;">
        <dt>${t('adminer.version_label')}</dt><dd style="font-family:monospace;">${escapeHtml(status.version || '-')}</dd>
        <dt>${t('adminer.docroot_label')}</dt><dd style="font-family:monospace;">${escapeHtml(status.docroot)}</dd>
        <dt>${t('adminer.socket_label')}</dt><dd style="font-family:monospace;">${escapeHtml(status.socketPath)}</dd>
      </dl>
      <p style="margin:0 0 8px;color:var(--muted);font-size:13px;">${t('adminer.caddy_hint')}</p>
      <pre style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:12px;font-size:12px;overflow-x:auto;margin:0 0 16px;">${escapeHtml(status.caddyBlock)}</pre>
      ${includeActions ? `
        <button type="button" class="danger" id="adminer-uninstall-btn">${t('adminer.uninstall_button')}</button>
        <div class="action-msg" id="adminer-msg"></div>
      ` : ''}
    </div>
  `;
}

function adminerInstallTileHtml(status) {
  const name = t('services.adminer.name');
  if (status.installed) return adminerInfoCardHtml(status, true);

  if (!status.php83Installed) {
    return `
      <div class="system-info-card" style="max-width:560px;">
        <div style="font-weight:600;font-size:15px;margin-bottom:8px;">${escapeHtml(name)}</div>
        <div class="empty-state">${t('adminer.requires_php83')}</div>
      </div>
    `;
  }

  return `
    <div class="system-info-card" style="max-width:560px;">
      <div style="font-weight:600;font-size:15px;margin-bottom:8px;">${escapeHtml(name)}</div>
      <p style="color:var(--muted);font-size:13px;line-height:1.5;margin:0 0 16px;">${t('install.adminer.description')}</p>
      <button type="button" id="adminer-install-btn">${t('install.install_button')}</button>
      <div class="action-msg" id="adminer-msg"></div>
    </div>
  `;
}

function wireAdminerInstallTile() {
  const installBtn = document.getElementById('adminer-install-btn');
  const uninstallBtn = document.getElementById('adminer-uninstall-btn');
  const msgEl = document.getElementById('adminer-msg');

  if (installBtn) {
    installBtn.onclick = async () => {
      if (!window.confirm(t('install.adminer.confirm_install'))) return;
      installBtn.disabled = true;
      msgEl.textContent = t('install.installing');
      msgEl.className = 'action-msg';
      try {
        await api('POST', '/adminer/install');
        const status = await api('GET', '/adminer');
        document.getElementById('content').innerHTML = adminerInstallTileHtml(status);
        applyTranslations();
        wireAdminerInstallTile();
        const successEl = document.getElementById('adminer-msg');
        if (successEl) {
          successEl.textContent = t('install.install_success');
          successEl.className = 'action-msg success';
        }
        await refreshDynamicNav();
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
        installBtn.disabled = false;
      }
    };
  }

  if (uninstallBtn) {
    uninstallBtn.onclick = async () => {
      if (!window.confirm(t('adminer.confirm_uninstall'))) return;
      uninstallBtn.disabled = true;
      msgEl.textContent = t('testdb.working');
      msgEl.className = 'action-msg';
      try {
        await api('POST', '/adminer/uninstall');
        const status = await api('GET', '/adminer');
        document.getElementById('content').innerHTML = adminerInstallTileHtml(status);
        applyTranslations();
        wireAdminerInstallTile();
        await refreshDynamicNav();
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
        uninstallBtn.disabled = false;
      }
    };
  }
}

function adminerGateCaddyBlock(status) {
  return `adm.twojadomena.pl {
	handle /adm-gate/* {
		reverse_proxy 127.0.0.1:4300
	}
	handle {
		forward_auth 127.0.0.1:4300 {
			uri /adm-gate/check
		}
		header -X-Powered-By
		root * ${status.docroot}
		php_fastcgi unix/${status.socketPath}
		file_server
	}
}`;
}

async function renderAdminerGateSection(admStatus) {
  let gate;
  try {
    gate = await api('GET', '/adminer-gate');
  } catch (e) {
    return `<div class="system-info-card"><div class="empty-state">${escapeHtml(e.message)}</div></div>`;
  }
  return `
    <div class="system-info-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:12px;">
        <div>
          <div style="font-weight:600;font-size:15px;margin-bottom:8px;">${t('adminer.gate_title')}</div>
          <span class="status-badge ${gate.enabled ? 'active' : 'inactive'}">${gate.enabled ? t('adminer.gate_enabled') : t('adminer.gate_disabled')}</span>
        </div>
        <div id="adminer-gate-preview-box" style="flex:0 0 auto;border:1px solid var(--border);border-radius:8px;padding:8px;pointer-events:none;">
          <div id="adminer-gate-preview"></div>
        </div>
      </div>
      <p style="margin:0 0 16px;color:var(--muted);font-size:13px;line-height:1.5;">${t('adminer.gate_description')}</p>
      ${!gate.turnstileConfigured ? `<div class="empty-state" style="margin-bottom:16px;">${t('adminer.gate_requires_turnstile')}</div>` : ''}
      <ol style="margin:0 0 16px;padding-left:20px;font-size:13px;line-height:1.8;">
        <li>${t('adminer.gate_step1')}</li>
        <li>${t('adminer.gate_step2')}</li>
        <li>${t('adminer.gate_step3')}</li>
      </ol>
      <p style="margin:0 0 8px;color:var(--muted);font-size:13px;">${t('adminer.gate_caddy_hint')}</p>
      <pre style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:12px;font-size:12px;overflow-x:auto;margin:0 0 16px;">${escapeHtml(adminerGateCaddyBlock(admStatus))}</pre>
      <button type="button" id="adminer-gate-enable-btn" ${gate.enabled || !gate.turnstileConfigured ? 'disabled' : ''}>${t('adminer.gate_enable_button')}</button>
      <button type="button" class="danger" id="adminer-gate-disable-btn" ${gate.enabled ? '' : 'disabled'}>${t('adminer.gate_disable_button')}</button>
      <div class="action-msg" id="adminer-gate-msg"></div>
    </div>
  `;
}

function wireAdminerGateSection(admStatus) {
  renderAdminerGatePreview();
  const enableBtn = document.getElementById('adminer-gate-enable-btn');
  const disableBtn = document.getElementById('adminer-gate-disable-btn');
  if (!enableBtn || !disableBtn) return;
  const msgEl = document.getElementById('adminer-gate-msg');

  async function refresh() {
    const container = enableBtn.closest('.system-info-card');
    if (container) {
      container.outerHTML = await renderAdminerGateSection(admStatus);
      applyTranslations();
      wireAdminerGateSection(admStatus);
    }
  }

  enableBtn.onclick = async () => {
    if (!window.confirm(t('adminer.gate_confirm_enable'))) return;
    enableBtn.disabled = true;
    msgEl.textContent = t('testdb.working');
    msgEl.className = 'action-msg';
    try {
      await api('POST', '/adminer-gate', { enabled: true });
      await refresh();
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
      enableBtn.disabled = false;
    }
  };

  disableBtn.onclick = async () => {
    if (!window.confirm(t('adminer.gate_confirm_disable'))) return;
    disableBtn.disabled = true;
    msgEl.textContent = t('testdb.working');
    msgEl.className = 'action-msg';
    try {
      await api('POST', '/adminer-gate', { enabled: false });
      await refresh();
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
      disableBtn.disabled = false;
    }
  };
}

// Sekcja domeny wewnatrz karty Roundcube - w odroznieniu od bramki
// Turnstile (ponizej), TO nie jest opcjonalne: bez skonfigurowanej domeny
// webmail w ogole nie jest dostepny przez przegladarke (Caddy nie ma go
// gdzie serwowac). Uzywana zarowno zaraz po instalacji aplikacji (gdy
// config.domain jeszcze puste) jak i do PONOWNEJ zmiany domeny pozniej -
// jeden widget, dwa konteksty.
async function roundcubeDomainSectionHtml(status) {
  const configured = status.caddyConfigured && status.domain;
  let detected = null;
  if (!configured) {
    try {
      detected = await api('GET', '/roundcube/detect-domain');
    } catch {
      detected = null;
    }
  }
  const suggestedValue = configured ? status.domain : (detected?.suggested || '');
  return `
    <div id="roundcube-domain-section">
      <h3>${t('roundcube.domain_title')}</h3>
      ${configured
        ? `<p style="margin:0 0 12px;color:var(--accent);font-size:13px;">${t('roundcube.domain_configured_hint', { webmail: `webmail.${status.domain}`, mail: `mail.${status.domain}` })}</p>`
        : `<p style="margin:0 0 12px;color:var(--muted);font-size:13px;">${t('roundcube.domain_not_configured_hint')}</p>`}
      ${!configured && detected?.detected ? `<p style="margin:0 0 12px;color:var(--muted);font-size:12px;">${t('roundcube.domain_detected_hint', { domain: detected.detected })}</p>` : ''}
      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('roundcube.domain_input_label')}</label>
      <input type="text" id="roundcube-domain-input" value="${escapeHtml(suggestedValue)}" placeholder="${t('roundcube.domain_input_placeholder')}" style="width:100%;margin-bottom:12px;">
      <button type="button" id="roundcube-domain-apply-btn">${configured ? t('roundcube.domain_change_button') : t('roundcube.domain_apply_button')}</button>
      <div class="action-msg" id="roundcube-domain-msg"></div>
    </div>
  `;
}

function wireRoundcubeDomainSection(afterApply) {
  const btn = document.getElementById('roundcube-domain-apply-btn');
  if (!btn) return;
  const input = document.getElementById('roundcube-domain-input');
  const msgEl = document.getElementById('roundcube-domain-msg');
  btn.onclick = async () => {
    const domain = input.value.trim().toLowerCase();
    if (!domain) {
      msgEl.textContent = t('roundcube.domain_required');
      msgEl.className = 'action-msg error';
      return;
    }
    if (!window.confirm(t('roundcube.confirm_configure', { webmail: `webmail.${domain}`, mail: `mail.${domain}` }))) return;
    btn.disabled = true;
    input.disabled = true;
    msgEl.textContent = t('roundcube.domain_working');
    msgEl.className = 'action-msg';
    try {
      await api('POST', '/roundcube/configure', { domain, gate: false });
      msgEl.textContent = t('roundcube.domain_success');
      msgEl.className = 'action-msg success';
      await afterApply();
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
      btn.disabled = false;
      input.disabled = false;
    }
  };
}

async function roundcubeInfoCardHtml(status, includeActions, constrainWidth = true) {
  const name = t('services.roundcube.name');
  if (!status.installed) return '';
  const domainSection = await roundcubeDomainSectionHtml(status);
  return `
    <div class="system-info-card"${constrainWidth ? ' style="max-width:640px;"' : ''}>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:12px;">
        <div style="font-weight:600;font-size:15px;">${escapeHtml(name)}</div>
        <span class="status-badge active">${t('install.installed_badge')}</span>
      </div>
      <dl style="margin:0 0 16px;">
        <dt>${t('roundcube.version_label')}</dt><dd style="font-family:monospace;">${escapeHtml(status.version || '-')}</dd>
        <dt>${t('roundcube.db_engine_label')}</dt><dd style="font-family:monospace;">${escapeHtml(status.dbEngine || '-')}</dd>
        <dt>${t('roundcube.docroot_label')}</dt><dd style="font-family:monospace;">${escapeHtml(status.docroot)}</dd>
        <dt>${t('roundcube.socket_label')}</dt><dd style="font-family:monospace;">${escapeHtml(status.socketPath)}</dd>
      </dl>
      ${domainSection}
      ${includeActions ? `
        <button type="button" class="danger" id="roundcube-uninstall-btn" style="margin-top:16px;">${t('roundcube.uninstall_button')}</button>
        <div class="action-msg" id="roundcube-msg"></div>
      ` : ''}
    </div>
  `;
}

async function renderRoundcubeGateSection(rcStatus) {
  let gate;
  try {
    gate = await api('GET', '/roundcube-gate');
  } catch (e) {
    return `<div class="system-info-card"><div class="empty-state">${escapeHtml(e.message)}</div></div>`;
  }
  const canToggle = rcStatus.caddyConfigured && rcStatus.domain;
  return `
    <div class="system-info-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:12px;">
        <div>
          <div style="font-weight:600;font-size:15px;margin-bottom:8px;">${t('roundcube.gate_title')}</div>
          <span class="status-badge ${gate.enabled ? 'active' : 'inactive'}">${gate.enabled ? t('roundcube.gate_enabled') : t('roundcube.gate_disabled')}</span>
        </div>
      </div>
      <p style="margin:0 0 16px;color:var(--muted);font-size:13px;line-height:1.5;">${t('roundcube.gate_description')}</p>
      ${!canToggle ? `<div class="empty-state" style="margin-bottom:16px;">${t('roundcube.gate_requires_domain')}</div>` : ''}
      ${canToggle && !gate.turnstileConfigured ? `<div class="empty-state" style="margin-bottom:16px;">${t('roundcube.gate_requires_turnstile')}</div>` : ''}
      <button type="button" id="roundcube-gate-enable-btn" ${!canToggle || gate.enabled || !gate.turnstileConfigured ? 'disabled' : ''}>${t('roundcube.gate_enable_button')}</button>
      <button type="button" class="danger" id="roundcube-gate-disable-btn" ${!canToggle || !gate.enabled ? 'disabled' : ''}>${t('roundcube.gate_disable_button')}</button>
      <div class="action-msg" id="roundcube-gate-msg"></div>
    </div>
  `;
}

function wireRoundcubeGateSection(rcStatus) {
  const enableBtn = document.getElementById('roundcube-gate-enable-btn');
  const disableBtn = document.getElementById('roundcube-gate-disable-btn');
  if (!enableBtn || !disableBtn) return;
  const msgEl = document.getElementById('roundcube-gate-msg');

  async function refresh() {
    const container = enableBtn.closest('.system-info-card');
    if (container) {
      container.outerHTML = await renderRoundcubeGateSection(rcStatus);
      applyTranslations();
      wireRoundcubeGateSection(rcStatus);
    }
  }

  enableBtn.onclick = async () => {
    if (!window.confirm(t('roundcube.gate_confirm_enable'))) return;
    enableBtn.disabled = true;
    msgEl.textContent = t('testdb.working');
    msgEl.className = 'action-msg';
    try {
      await api('POST', '/roundcube-gate', { enabled: true });
      await refresh();
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
      enableBtn.disabled = false;
    }
  };

  disableBtn.onclick = async () => {
    if (!window.confirm(t('roundcube.gate_confirm_disable'))) return;
    disableBtn.disabled = true;
    msgEl.textContent = t('testdb.working');
    msgEl.className = 'action-msg';
    try {
      await api('POST', '/roundcube-gate', { enabled: false });
      await refresh();
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
      disableBtn.disabled = false;
    }
  };
}

async function roundcubeInstallTileHtml(status) {
  const name = t('services.roundcube.name');
  if (status.installed) return roundcubeInfoCardHtml(status, true, false);

  if (!status.php84Installed) {
    return `
      <div class="system-info-card">
        <div style="font-weight:600;font-size:15px;margin-bottom:8px;">${escapeHtml(name)}</div>
        <div class="empty-state">${t('roundcube.requires_php84')}</div>
      </div>
    `;
  }

  return `
    <div class="system-info-card">
      <div style="font-weight:600;font-size:15px;margin-bottom:8px;">${escapeHtml(name)}</div>
      <p style="color:var(--muted);font-size:13px;line-height:1.5;margin:0 0 16px;">${t('install.roundcube.description')}</p>
      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('install.roundcube.db_engine_label')}</label>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:4px;">
        <input type="radio" name="roundcube-db-engine" value="mysql" checked>${t('install.roundcube.db_engine_mysql')}
      </label>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:16px;">
        <input type="radio" name="roundcube-db-engine" value="sqlite">${t('install.roundcube.db_engine_sqlite')}
      </label>
      <button type="button" id="roundcube-install-btn">${t('install.install_button')}</button>
      <div class="action-msg" id="roundcube-msg"></div>
    </div>
  `;
}

// Zakladka Instalator -> Roundcube: dwa kafelki 50/50 pelnej szerokosci
// (lewy - instalacja/info, prawy - bramka Turnstile), ten sam wzorzec co
// dwukolumnowy widok w zakladce GLOWNE -> ROUNDCUBE po instalacji (patrz
// renderServiceDetailTab). Bramka ma sens pokazywac juz na etapie
// Instalatora (nie tylko po instalacji) - user chce ja widziec od razu
// obok, tak jak phpMyAdmin ma swoja.
async function renderRoundcubeInstallPageHtml(status) {
  const [leftHtml, rightHtml] = await Promise.all([
    roundcubeInstallTileHtml(status),
    renderRoundcubeGateSection(status)
  ]);
  return `
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
      <div style="flex:1 1 0;min-width:320px;">${leftHtml}</div>
      <div style="flex:1 1 0;min-width:320px;">${rightHtml}</div>
    </div>
  `;
}

async function refreshRoundcubeTile() {
  const status = await api('GET', '/roundcube');
  document.getElementById('content').innerHTML = await renderRoundcubeInstallPageHtml(status);
  applyTranslations();
  wireRoundcubeInstallTile();
  wireRoundcubeGateSection(status);
  await refreshDynamicNav();
}

function wireRoundcubeInstallTile() {
  const installBtn = document.getElementById('roundcube-install-btn');
  const uninstallBtn = document.getElementById('roundcube-uninstall-btn');
  const msgEl = document.getElementById('roundcube-msg');

  wireRoundcubeDomainSection(refreshRoundcubeTile);

  if (installBtn) {
    installBtn.onclick = async () => {
      const dbEngine = document.querySelector('input[name="roundcube-db-engine"]:checked')?.value || 'mysql';
      if (!window.confirm(t('install.roundcube.confirm_install'))) return;
      installBtn.disabled = true;
      msgEl.textContent = t('install.installing');
      msgEl.className = 'action-msg';
      try {
        await api('POST', '/roundcube/install', { dbEngine });
        await refreshRoundcubeTile();
        const successEl = document.getElementById('roundcube-msg');
        if (successEl) {
          successEl.textContent = t('install.install_success');
          successEl.className = 'action-msg success';
        }
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
        installBtn.disabled = false;
      }
    };
  }

  if (uninstallBtn) {
    uninstallBtn.onclick = async () => {
      if (!window.confirm(t('roundcube.confirm_uninstall'))) return;
      uninstallBtn.disabled = true;
      msgEl.textContent = t('testdb.working');
      msgEl.className = 'action-msg';
      try {
        await api('POST', '/roundcube/uninstall');
        await refreshRoundcubeTile();
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
        uninstallBtn.disabled = false;
      }
    };
  }
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

// Bez wyboru trybu/wersji (w odroznieniu od MariaDB/Redis) - jeden,
// stabilny zestaw pakietow (postfix+dovecot+opendkim, patrz
// mail-install.sh) - prosty, pojedynczy przycisk.
function mailInstallTileHtml(svc) {
  const name = t('services.mail.name');
  const description = t('install.mail.description');

  if (svc.found) {
    return `
      <div class="system-info-card" style="max-width:560px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:12px;">
          <div style="font-weight:600;font-size:15px;">${escapeHtml(name)}</div>
          <span class="status-badge active">${t('install.installed_badge')}</span>
        </div>
        <p style="color:var(--muted);font-size:13px;line-height:1.5;margin:0;">${escapeHtml(description)}</p>
        <p style="color:var(--muted);font-size:12px;margin-top:10px;">${t('install.mail.installed_hint')}</p>
      </div>
    `;
  }

  return `
    <div class="system-info-card" style="max-width:560px;">
      <div style="font-weight:600;font-size:15px;margin-bottom:8px;">${escapeHtml(name)}</div>
      <p style="color:var(--muted);font-size:13px;line-height:1.5;margin:0 0 16px;">${escapeHtml(description)}</p>
      <button type="button" id="mail-install-btn">${t('install.install_button')}</button>
      <div class="action-msg" id="mail-install-msg"></div>
    </div>
  `;
}

function wireMailInstallTile() {
  const btn = document.getElementById('mail-install-btn');
  if (!btn) return;
  const msgEl = document.getElementById('mail-install-msg');

  btn.onclick = async () => {
    if (!window.confirm(t('install.mail.confirm_install'))) return;

    btn.disabled = true;
    msgEl.textContent = t('install.installing');
    msgEl.className = 'action-msg';
    try {
      await api('POST', '/mail/install');
      const svc = await api('GET', '/services/mail');
      document.getElementById('content').innerHTML = mailInstallTileHtml(svc);
      applyTranslations();
      const successEl = document.getElementById('mail-install-msg');
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

function phpInstallTileHtml(data) {
  const name = t('services.php-fpm.name');
  const description = t('install.php-fpm.description');
  const versions = data.versions || [];
  const selectable = versions.filter((v) => !v.installed);
  const firstSelectableId = selectable[0]?.id;

  const versionList = versions.length
    ? versions.map((v) => `
        <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:13px;${v.installed ? 'opacity:0.6;' : ''}">
          <input type="radio" name="php-version" value="${escapeHtml(v.id)}" ${v.installed ? 'disabled' : ''} ${!v.installed && v.id === firstSelectableId ? 'checked' : ''}>
          <span>PHP ${escapeHtml(v.version)}${v.installed ? ` <span class="status-badge active">${t('install.installed_badge')}</span>` : ''}</span>
        </label>
      `).join('')
    : `<p style="color:var(--muted);font-size:13px;">${t('install.php-fpm.no_versions')}</p>`;

  return `
    <div class="system-info-card" style="max-width:560px;">
      <div style="font-weight:600;font-size:15px;margin-bottom:8px;">${escapeHtml(name)}</div>
      <p style="color:var(--muted);font-size:13px;line-height:1.5;margin:0 0 16px;">${escapeHtml(description)}</p>

      <div style="margin-bottom:14px;">${versionList}</div>

      ${selectable.length ? `<button type="button" id="php-install-btn">${t('install.install_button')}</button>` : ''}
      <div class="action-msg" id="php-install-msg"></div>
    </div>
  `;
}

function wirePhpInstallTile() {
  const btn = document.getElementById('php-install-btn');
  if (!btn) return;
  const msgEl = document.getElementById('php-install-msg');

  btn.onclick = async () => {
    const selected = document.querySelector('input[name="php-version"]:checked');
    if (!selected) return;
    const id = selected.value;
    const versionLabel = `${id[0]}.${id.slice(1)}`;
    if (!window.confirm(t('install.php-fpm.confirm_install', { version: versionLabel }))) return;

    btn.disabled = true;
    msgEl.textContent = t('install.installing');
    msgEl.className = 'action-msg';
    try {
      await api('POST', `/php/${id}/install`);
      const data = await api('GET', '/php/available');
      document.getElementById('content').innerHTML = phpInstallTileHtml(data);
      applyTranslations();
      wirePhpInstallTile();
      const successEl = document.getElementById('php-install-msg');
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

async function renderInstallDetailTab(key, content) {
  content.innerHTML = `<div class="empty-state">${t('services.loading')}</div>`;
  try {
    if (key === 'php-fpm') {
      const data = await api('GET', '/php/available');
      content.innerHTML = phpInstallTileHtml(data);
      applyTranslations();
      wirePhpInstallTile();
      return;
    }
    if (key === 'phpmyadmin') {
      const status = await api('GET', '/phpmyadmin');
      content.innerHTML = phpmyadminInstallTileHtml(status);
      applyTranslations();
      wirePhpmyadminInstallTile();
      return;
    }
    if (key === 'adminer') {
      const status = await api('GET', '/adminer');
      content.innerHTML = adminerInstallTileHtml(status);
      applyTranslations();
      wireAdminerInstallTile();
      return;
    }
    if (key === 'roundcube') {
      const status = await api('GET', '/roundcube');
      content.innerHTML = await renderRoundcubeInstallPageHtml(status);
      applyTranslations();
      wireRoundcubeInstallTile();
      wireRoundcubeGateSection(status);
      return;
    }
    const svc = await api('GET', `/services/${key}`);
    if (key === 'mail') {
      content.innerHTML = mailInstallTileHtml(svc);
      applyTranslations();
      wireMailInstallTile();
      return;
    }
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
  const name = svc.name || t(`services.${svc.key}.name`);
  const isActive = svc.activeState === 'active';
  return `
    <div class="service-card" data-nav-tab="${escapeHtml(svc.key)}">
      <div class="service-card-header">
        <span class="service-name">${escapeHtml(name)}</span>
        <span class="status-badge ${isActive ? 'active' : 'inactive'}">${isActive ? t('services.active') : t('services.inactive')}</span>
      </div>
      <div class="service-detail">${escapeHtml(svc.unit)}</div>
      <div class="service-detail">${t('services.ram_label')}: ${formatBytes(svc.memoryBytes)}</div>
    </div>
  `;
}

const PACKAGE_RAM_OPTIONS_MB = [512, 1024, 2048, 4096, 8192, 16384];

async function renderPackageFormHtml(pkg, cpuCount, resources) {
  const currentRam = pkg?.ramLimitMb ?? 1024;
  const ramField = `<select id="pkg-form-ram">${PACKAGE_RAM_OPTIONS_MB.map((mb) =>
    `<option value="${mb}" ${currentRam === mb ? 'selected' : ''}>${mb} MB</option>`
  ).join('')}</select>`;

  const diskFsType = resources?.diskFsType ?? 'none';
  const diskModeLabel = diskFsType === 'ext4' ? 'ext4' : diskFsType === 'xfs' ? 'XFS' : t('packages.disk_fs_none');
  const diskQuotaOffBadge = diskFsType === 'none' ? `<span class="status-badge inactive">${t('packages.quota_off_badge')}</span>` : '';
  const diskQuotaHint = diskFsType === 'none'
    ? t('packages.pkg_form_quota_none_hint')
    : resources?.diskQuotaVerified
      ? t('packages.pkg_form_quota_active_hint', { mode: diskModeLabel, mount: resources.diskMountPoint })
      : t('packages.pkg_form_quota_unverified_hint', { mode: diskModeLabel, mount: resources.diskMountPoint });

  return `
    <div class="system-info-card" id="pkg-form-card" style="margin-top:16px;max-width:480px;">
      <h3 style="margin:0 0 14px;font-size:15px;">${pkg ? t('packages.form_title_edit') : t('packages.form_title_add')}</h3>
      <input type="hidden" id="pkg-form-id" value="${escapeHtml(pkg?.id || '')}">
      <input type="hidden" id="pkg-form-cpu-count" value="${cpuCount}">

      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('packages.field_name')}</label>
      <input type="text" id="pkg-form-name" value="${escapeHtml(pkg?.name || '')}" style="width:100%;margin-bottom:10px;">

      <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('packages.field_disk')} ${diskQuotaOffBadge}</label>
      <input type="number" id="pkg-form-disk" min="0" value="${pkg?.diskQuotaMb ?? 1024}" style="width:100%;margin-bottom:4px;">
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">${diskQuotaHint}</div>

      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('packages.field_domains')}</label>
      <input type="number" id="pkg-form-domains" min="0" value="${pkg?.maxDomains ?? 1}" style="width:100%;margin-bottom:10px;">

      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('packages.field_databases')}</label>
      <input type="number" id="pkg-form-databases" min="0" value="${pkg?.maxDatabases ?? 1}" style="width:100%;margin-bottom:10px;">

      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('packages.field_ram')}</label>
      <div style="margin-bottom:10px;">${ramField}</div>

      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('packages.field_cpu')}</label>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <input type="number" id="pkg-form-cpu" min="1" max="100" value="${pkg?.cpuPercent ?? 100}" style="width:100%;">
        <span style="font-size:12px;color:var(--muted);white-space:nowrap;">% / rdzen</span>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px;" id="pkg-form-cpu-hint"></div>

      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('packages.field_description')}</label>
      <textarea id="pkg-form-description" rows="3" style="width:100%;margin-bottom:14px;font-family:inherit;">${escapeHtml(pkg?.description || '')}</textarea>

      <button type="button" id="pkg-form-save-btn">${t('packages.save_button')}</button>
      <button type="button" class="secondary" id="pkg-form-cancel-btn">${t('packages.cancel_button')}</button>
      <div class="action-msg" id="pkg-form-msg"></div>
    </div>
  `;
}

function wirePackageForm() {
  const saveBtn = document.getElementById('pkg-form-save-btn');
  const cancelBtn = document.getElementById('pkg-form-cancel-btn');
  if (!saveBtn) return;
  const msgEl = document.getElementById('pkg-form-msg');
  const cpuInput = document.getElementById('pkg-form-cpu');
  const cpuHint = document.getElementById('pkg-form-cpu-hint');
  const cpuCount = parseInt(document.getElementById('pkg-form-cpu-count').value, 10) || 1;

  const updateCpuHint = () => {
    const percent = parseInt(cpuInput.value, 10);
    cpuHint.textContent = Number.isInteger(percent) && percent >= 1 && percent <= 100
      ? t('packages.cpu_hint', { total: percent * cpuCount, count: cpuCount })
      : '';
  };
  cpuInput.oninput = updateCpuHint;
  updateCpuHint();

  cancelBtn.onclick = () => {
    document.getElementById('pkg-form-card').remove();
  };

  saveBtn.onclick = async () => {
    const id = document.getElementById('pkg-form-id').value;
    const body = {
      name: document.getElementById('pkg-form-name').value,
      diskQuotaMb: document.getElementById('pkg-form-disk').value,
      maxDomains: document.getElementById('pkg-form-domains').value,
      maxDatabases: document.getElementById('pkg-form-databases').value,
      ramLimitMb: document.getElementById('pkg-form-ram').value,
      cpuPercent: cpuInput.value,
      description: document.getElementById('pkg-form-description').value
    };
    saveBtn.disabled = true;
    msgEl.textContent = t('packages.saving');
    msgEl.className = 'action-msg';
    try {
      if (id) {
        await api('PUT', `/packages/${id}`, body);
      } else {
        await api('POST', '/packages', body);
      }
      await renderPackagesTab(document.getElementById('content'));
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
      saveBtn.disabled = false;
    }
  };
}

async function showPackageForm(pkg, cpuCount, resources) {
  const existing = document.getElementById('pkg-form-card');
  if (existing) existing.remove();
  const container = document.getElementById('packages-form-container');
  container.innerHTML = await renderPackageFormHtml(pkg, cpuCount, resources);
  applyTranslations();
  wirePackageForm();
}

function renderSystemResourcesHtml(resources) {
  const { reservePercent, slice, quota, diskFsType, diskMountPoint, diskQuotaVerified, diskQuotaVerifiedMessage } = resources;
  const verifyBadge = diskFsType === 'none'
    ? `<span style="font-size:13px;color:var(--muted);">${t('packages.quota_verify_na')}</span>`
    : diskQuotaVerified
      ? `<span class="status-badge active">${t('packages.quota_verify_ok')}</span>`
      : `<span class="status-badge inactive">${t('packages.quota_verify_missing')}</span>`;
  return `
    <h3 style="margin:0 0 4px;font-size:15px;">${t('packages.resources_title')}</h3>
    <p style="margin:0 0 16px;color:var(--muted);font-size:13px;">${t('packages.resources_description')}</p>
    <div style="display:flex;flex-wrap:wrap;gap:28px;">
      <div>
        <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('packages.field_reserve')}</label>
        <div style="display:flex;align-items:center;gap:8px;">
          <input type="number" id="sysres-reserve" min="0" max="90" value="${reservePercent}" style="width:90px;">
          <span style="font-size:12px;color:var(--muted);">%</span>
          <button type="button" id="sysres-apply-btn">${t('packages.apply_button')}</button>
        </div>
        <div style="font-size:12px;color:var(--muted);margin-top:6px;" id="sysres-hint"></div>
      </div>
      <div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:4px;">${t('packages.slice_status')}</div>
        <div style="font-size:13px;">
          ${slice.installed
            ? t('packages.slice_installed', { quota: slice.cpuQuotaPercent, count: slice.cpuCount })
            : t('packages.slice_not_installed')}
        </div>
      </div>
      <div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:4px;">${t('packages.quota_status')}</div>
        <div style="font-size:13px;display:flex;align-items:center;gap:8px;">
          ${quota.installed
            ? `<span class="status-badge active">${t('packages.quota_installed')}</span>`
            : `<span class="status-badge inactive">${t('packages.quota_not_installed')}</span><button type="button" id="quota-install-btn">${t('packages.quota_install_button')}</button>`}
        </div>
      </div>
      <div>
        <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('packages.field_disk_fs')}</label>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <select id="sysres-fstype">
            <option value="none" ${diskFsType === 'none' ? 'selected' : ''}>${t('packages.disk_fs_none')}</option>
            <option value="ext4" ${diskFsType === 'ext4' ? 'selected' : ''}>ext4</option>
            <option value="xfs" ${diskFsType === 'xfs' ? 'selected' : ''}>XFS</option>
          </select>
          <select id="sysres-mountpoint">
            <option value="/" ${diskMountPoint === '/' ? 'selected' : ''}>/</option>
            <option value="/home" ${diskMountPoint === '/home' ? 'selected' : ''}>/home</option>
          </select>
          <button type="button" id="sysres-disk-apply-btn">${t('packages.apply_button')}</button>
        </div>
        <div style="font-size:12px;color:var(--muted);margin-top:6px;">${t('packages.field_disk_fs_hint')}</div>
        <div style="margin-top:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">${verifyBadge}</div>
        ${diskQuotaVerifiedMessage ? `<div style="font-size:12px;color:var(--muted);margin-top:6px;">${escapeHtml(diskQuotaVerifiedMessage)}</div>` : ''}
      </div>
    </div>
    <div style="margin-top:16px;">
      <div style="font-size:12px;color:var(--muted);margin-bottom:6px;">${t('packages.quota_help_title')}</div>
      <p style="margin:0 0 12px;color:var(--muted);font-size:13px;">${t('packages.quota_help_body')}</p>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:16px;">
        <div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:6px;">${t('packages.quota_help_xfs_title')}</div>
          <pre style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:12px;font-size:12px;overflow-x:auto;margin:0;">${escapeHtml(t('packages.quota_help_xfs_example'))}</pre>
        </div>
        <div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:6px;">${t('packages.quota_help_ext4_title')}</div>
          <pre style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:12px;font-size:12px;overflow-x:auto;margin:0;">${escapeHtml(t('packages.quota_help_ext4_example'))}</pre>
        </div>
      </div>
    </div>
    <div class="action-msg" id="sysres-msg"></div>
  `;
}

function wireSystemResourcesSection(resources, content) {
  const cpuCount = resources.slice.cpuCount;
  const applyBtn = document.getElementById('sysres-apply-btn');
  const input = document.getElementById('sysres-reserve');
  const hint = document.getElementById('sysres-hint');
  const msgEl = document.getElementById('sysres-msg');

  const updateHint = () => {
    const reserve = parseInt(input.value, 10);
    hint.textContent = Number.isInteger(reserve) && reserve >= 0 && reserve <= 90
      ? t('packages.reserve_hint', { quota: Math.max(1, Math.round((100 - reserve) * cpuCount)), count: cpuCount })
      : '';
  };
  input.oninput = updateHint;
  updateHint();

  applyBtn.onclick = async () => {
    applyBtn.disabled = true;
    msgEl.textContent = t('packages.saving');
    msgEl.className = 'action-msg';
    try {
      await api('PUT', '/system-resources', { reservePercent: input.value });
      await renderPackagesTab(content);
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
      applyBtn.disabled = false;
    }
  };

  const quotaBtn = document.getElementById('quota-install-btn');
  if (quotaBtn) {
    quotaBtn.onclick = async () => {
      quotaBtn.disabled = true;
      msgEl.textContent = t('packages.quota_installing');
      msgEl.className = 'action-msg';
      try {
        await api('POST', '/quota/install');
        await renderPackagesTab(content);
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
        quotaBtn.disabled = false;
      }
    };
  }

  const diskFsApplyBtn = document.getElementById('sysres-disk-apply-btn');
  diskFsApplyBtn.onclick = async () => {
    diskFsApplyBtn.disabled = true;
    msgEl.textContent = t('packages.saving');
    msgEl.className = 'action-msg';
    try {
      await api('PUT', '/quota/settings', {
        diskFsType: document.getElementById('sysres-fstype').value,
        diskMountPoint: document.getElementById('sysres-mountpoint').value
      });
      msgEl.textContent = t('packages.quota_verifying');
      try {
        await api('POST', '/quota/verify');
      } catch {
        // Blad juz zapisany po stronie serwera (setDiskQuotaVerified) -
        // odswiezenie ponizej pokaze czerwony status + tresc bledu w
        // trwalym baneriku, nie tylko w znikajacym komunikacie.
      }
      await renderPackagesTab(content);
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
      diskFsApplyBtn.disabled = false;
    }
  };
}

function renderAccountsHtml(accounts, packages, nextUsername) {
  const prefix = nextUsername?.prefix || 'srv_';
  const nextId = nextUsername?.nextId ?? '';
  return `
    <h3 style="margin:0 0 4px;font-size:15px;">${t('accounts.title')}</h3>
    <p style="margin:0 0 16px;color:var(--muted);font-size:13px;">${t('accounts.description')}</p>
    ${packages.length ? `
      <div style="display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
        <div>
          <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('accounts.field_username')}</label>
          <input type="hidden" id="acc-form-username-prefix" value="${escapeHtml(prefix)}">
          <div style="display:flex;">
            <span style="display:flex;align-items:center;padding:0 0 0 12px;background:var(--input-bg);border:1px solid var(--border);border-right:none;border-radius:8px 0 0 8px;font-family:var(--mono);color:var(--muted);font-size:14px;">${escapeHtml(prefix)}</span>
            <input type="text" id="acc-form-username-id" inputmode="numeric" value="${escapeHtml(String(nextId))}" style="width:100px;border-radius:0 8px 8px 0;font-family:var(--mono);">
          </div>
        </div>
        <div>
          <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('accounts.field_fullname')}</label>
          <input type="text" id="acc-form-fullname" style="width:160px;">
        </div>
        <div>
          <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('accounts.field_email')}</label>
          <input type="email" id="acc-form-email" style="width:180px;">
        </div>
        <div>
          <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('accounts.field_package')}</label>
          <select id="acc-form-package" style="width:180px;">
            ${packages.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('')}
          </select>
        </div>
        <button type="button" id="acc-form-create-btn">${t('accounts.create_button')}</button>
      </div>
    ` : `<p style="margin:0 0 12px;color:var(--muted);font-size:13px;">${t('accounts.no_packages')}</p>`}
    <div class="action-msg" id="acc-form-msg"></div>
    ${accounts.length ? `
      <div style="overflow-x:auto;">
        <table class="firewall-table">
          <thead>
            <tr>
              <th>${t('accounts.column_username')}</th>
              <th>${t('accounts.column_fullname')}</th>
              <th>${t('accounts.column_email')}</th>
              <th>${t('accounts.column_package')}</th>
              <th>${t('packages.column_ram')}</th>
              <th>${t('accounts.column_homedir')}</th>
              <th>${t('accounts.column_quota')}</th>
              <th>${t('accounts.column_created')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${accounts.map((a) => `
              <tr>
                <td>${escapeHtml(a.username)}</td>
                <td>${escapeHtml(a.fullName || '-')}</td>
                <td>${escapeHtml(a.email || '-')}</td>
                <td>${escapeHtml(a.packageName || '-')}</td>
                <td>${a.ramLimitMb ? `${a.ramLimitMb} MB` : '-'}</td>
                <td>${escapeHtml(a.homeDir)}</td>
                <td>${a.diskFsType === 'ext4' ? 'ext4' : a.diskFsType === 'xfs' ? 'XFS' : `<span class="status-badge inactive">${t('packages.quota_off_badge')}</span>`}</td>
                <td>${escapeHtml(new Date(a.createdAt).toLocaleString())}</td>
                <td>
                  <button type="button" class="secondary" data-edit-account="${escapeHtml(a.id)}">${t('accounts.edit_button')}</button>
                  <button type="button" class="danger" data-delete-account="${escapeHtml(a.id)}">${t('accounts.delete_button')}</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : `<div class="empty-state">${t('accounts.empty')}</div>`}
    <div id="acc-edit-form-container"></div>
  `;
}

function renderAccountEditFormHtml(account, packages) {
  return `
    <div class="system-info-card" id="acc-edit-form-card" style="margin-top:16px;max-width:480px;">
      <h3 style="margin:0 0 14px;font-size:15px;">${t('accounts.form_title_edit')}</h3>
      <input type="hidden" id="acc-edit-form-id" value="${escapeHtml(account.id)}">

      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('accounts.field_username')}</label>
      <div style="margin-bottom:10px;font-family:var(--mono);">${escapeHtml(account.username)}</div>

      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('accounts.field_fullname')}</label>
      <input type="text" id="acc-edit-form-fullname" value="${escapeHtml(account.fullName || '')}" style="width:100%;margin-bottom:10px;">

      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('accounts.field_email')}</label>
      <input type="email" id="acc-edit-form-email" value="${escapeHtml(account.email || '')}" style="width:100%;margin-bottom:10px;">

      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('accounts.field_package')}</label>
      <select id="acc-edit-form-package" style="width:100%;margin-bottom:14px;">
        ${packages.map((p) => `<option value="${escapeHtml(p.id)}" ${p.id === account.packageId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
      </select>

      <button type="button" id="acc-edit-form-save-btn">${t('accounts.save_button')}</button>
      <button type="button" class="secondary" id="acc-edit-form-cancel-btn">${t('accounts.cancel_button')}</button>
      <div class="action-msg" id="acc-edit-form-msg"></div>
    </div>
  `;
}

function wireAccountEditForm(content, refresh) {
  const saveBtn = document.getElementById('acc-edit-form-save-btn');
  const cancelBtn = document.getElementById('acc-edit-form-cancel-btn');
  if (!saveBtn) return;
  const msgEl = document.getElementById('acc-edit-form-msg');

  cancelBtn.onclick = () => {
    document.getElementById('acc-edit-form-card').remove();
  };

  saveBtn.onclick = async () => {
    const id = document.getElementById('acc-edit-form-id').value;
    const body = {
      fullName: document.getElementById('acc-edit-form-fullname').value,
      email: document.getElementById('acc-edit-form-email').value,
      packageId: document.getElementById('acc-edit-form-package').value
    };
    saveBtn.disabled = true;
    msgEl.textContent = t('accounts.saving');
    msgEl.className = 'action-msg';
    try {
      await api('PUT', `/accounts/${id}`, body);
      await refresh(content);
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
      saveBtn.disabled = false;
    }
  };
}

function showAccountEditForm(account, packages, content, refresh) {
  const existing = document.getElementById('acc-edit-form-card');
  if (existing) existing.remove();
  const container = document.getElementById('acc-edit-form-container');
  container.innerHTML = renderAccountEditFormHtml(account, packages);
  applyTranslations();
  wireAccountEditForm(content, refresh);
}

function wireAccountsSection(content, refresh, accounts, packages) {
  const createBtn = document.getElementById('acc-form-create-btn');
  const msgEl = document.getElementById('acc-form-msg');
  const idInput = document.getElementById('acc-form-username-id');

  if (idInput) {
    idInput.oninput = () => { idInput.value = idInput.value.replace(/[^0-9]/g, ''); };
    idInput.focus();
    idInput.select();
  }

  if (createBtn) {
    createBtn.onclick = async () => {
      const prefix = document.getElementById('acc-form-username-prefix').value;
      const idValue = idInput.value.trim();
      if (!idValue) {
        msgEl.textContent = t('accounts.error_missing_id');
        msgEl.className = 'action-msg error';
        return;
      }
      const username = prefix + idValue;
      const fullName = document.getElementById('acc-form-fullname').value;
      const email = document.getElementById('acc-form-email').value;
      const packageId = document.getElementById('acc-form-package').value;
      createBtn.disabled = true;
      msgEl.textContent = t('accounts.creating');
      msgEl.className = 'action-msg';
      try {
        await api('POST', '/accounts', { username, fullName, email, packageId });
        await refresh(content);
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
        createBtn.disabled = false;
      }
    };
  }

  document.querySelectorAll('[data-edit-account]').forEach((btn) => {
    btn.onclick = () => {
      const account = accounts.find((a) => a.id === btn.dataset.editAccount);
      showAccountEditForm(account, packages, content, refresh);
    };
  });

  document.querySelectorAll('[data-delete-account]').forEach((btn) => {
    btn.onclick = async () => {
      if (!window.confirm(t('accounts.confirm_delete', { name: btn.closest('tr').children[0].textContent }))) return;
      btn.disabled = true;
      try {
        await api('DELETE', `/accounts/${btn.dataset.deleteAccount}`);
        await refresh(content);
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
        btn.disabled = false;
      }
    };
  });
}

async function renderPackagesTab(content) {
  content.innerHTML = `<div class="empty-state">${t('services.loading')}</div>`;
  try {
    const [{ packages }, resources] = await Promise.all([
      api('GET', '/packages'),
      api('GET', '/system-resources')
    ]);
    const cpuCount = resources.slice.cpuCount;
    const diskModeLabel = (mode) => (mode === 'ext4' ? 'ext4' : mode === 'xfs' ? 'XFS' : `<span class="status-badge inactive">${t('packages.quota_off_badge')}</span>`);
    const rows = packages.map((p) => `
      <tr>
        <td>${escapeHtml(p.name)}</td>
        <td>${p.diskQuotaMb} MB</td>
        <td>${diskModeLabel(p.diskQuotaMode)}</td>
        <td>${p.maxDomains}</td>
        <td>${p.maxDatabases}</td>
        <td>${p.ramLimitMb ? `${p.ramLimitMb} MB` : '-'}</td>
        <td>${p.cpuPercent}% (${p.cpuTotalPercent}%)</td>
        <td>
          <button type="button" class="secondary" data-edit="${escapeHtml(p.id)}">${t('packages.edit_button')}</button>
          <button type="button" class="danger" data-delete="${escapeHtml(p.id)}">${t('packages.delete_button')}</button>
        </td>
      </tr>
    `).join('');

    content.innerHTML = `
      <div class="system-info-card">
        ${renderSystemResourcesHtml(resources)}
      </div>
      <div class="system-info-card" style="margin-top:16px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:4px;">
          <h3 style="margin:0;font-size:15px;">${t('packages.title')}</h3>
          <button type="button" id="packages-add-btn">${t('packages.add_button')}</button>
        </div>
        <p style="margin:0 0 16px;color:var(--muted);font-size:13px;">${t('packages.description')}</p>
        ${packages.length ? `
          <div style="overflow-x:auto;">
            <table class="firewall-table">
              <thead>
                <tr>
                  <th>${t('packages.column_name')}</th>
                  <th>${t('packages.column_disk')}</th>
                  <th>${t('packages.column_quota_mode')}</th>
                  <th>${t('packages.column_domains')}</th>
                  <th>${t('packages.column_databases')}</th>
                  <th>${t('packages.column_ram')}</th>
                  <th>${t('packages.column_cpu')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        ` : `<div class="empty-state">${t('packages.empty')}</div>`}
        <div class="action-msg" id="packages-msg"></div>
        <div id="packages-form-container"></div>
      </div>
    `;

    applyTranslations();
    wireSystemResourcesSection(resources, content);

    const addBtn = document.getElementById('packages-add-btn');
    addBtn.onclick = () => showPackageForm(null, cpuCount, resources);

    document.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.onclick = () => {
        const pkg = packages.find((p) => p.id === btn.dataset.edit);
        showPackageForm(pkg, cpuCount, resources);
      };
    });

    document.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.onclick = async () => {
        if (!window.confirm(t('packages.confirm_delete', { name: btn.closest('tr').children[0].textContent }))) return;
        const msgEl = document.getElementById('packages-msg');
        btn.disabled = true;
        try {
          await api('DELETE', `/packages/${btn.dataset.delete}`);
          await renderPackagesTab(content);
        } catch (e) {
          msgEl.textContent = e.message;
          msgEl.className = 'action-msg error';
          btn.disabled = false;
        }
      };
    });
  } catch (e) {
    content.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

async function renderAccountsTab(content) {
  content.innerHTML = `<div class="empty-state">${t('services.loading')}</div>`;
  try {
    const [{ packages }, { accounts }, nextUsername] = await Promise.all([
      api('GET', '/packages'),
      api('GET', '/accounts'),
      api('GET', '/accounts/next-username')
    ]);

    content.innerHTML = `
      <div class="system-info-card">
        ${renderAccountsHtml(accounts, packages, nextUsername)}
      </div>
    `;

    applyTranslations();
    wireAccountsSection(content, renderAccountsTab, accounts, packages);
  } catch (e) {
    content.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

async function renderServicesTab(content) {
  content.innerHTML = `<div class="empty-state">${t('services.loading')}</div>`;
  try {
    const { services } = await api('GET', '/services');
    // 'postfix' zostaje wylacznie w zakladce Poczta, ale 'dovecot' ma
    // tu wlasny kafelek (patrz refreshDynamicNav - SERVICE_DETAIL_TABS).
    const installed = services.filter((s) => s.found && s.key !== 'php-fpm' && s.key !== 'postfix');
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

// Ta sama rezolucja nazwy co w serviceCard() (siatka "Uslugi") i
// refreshDynamicNav() (lewy pasek nawigacji) - svc.name z serwera (np.
// "PHP 8.3" dla dynamicznych wersji PHP), a w braku tego i18n
// "services.<key>.name" dla stalych wpisow (SSH, FIREWALL, CADDY...).
// UWAGA: svc.name przychodzi tylko z listy GET /services (patrz
// phpServiceEntries() w server/routes/api.js) - pojedynczy GET
// /services/:key (uzywany na zakladce szczegolow, tu wlasnie) go NIE
// ma, wiec dla "phpXX" dokladamy wlasny fallback z klucza zamiast
// pokazywac surowy, nieprzetlumaczony klucz i18n.
function serviceTitleFor(svc) {
  if (svc.name) return svc.name;
  const phpMatch = /^php(\d)(\d)$/.exec(svc.key);
  if (phpMatch) return `PHP ${phpMatch[1]}.${phpMatch[2]}`;
  return t(`services.${svc.key}.name`);
}

// 'title' to opcjonalny naglowek karty (wzor jak w redisadmin) - uzywany
// tam, gdzie kilka kart uslug wystepuje razem na jednej zakladce (np.
// Poczta: Postfix + Dovecot) i trzeba je podpisac.
//
// Caddy (jedyny wyjatek): brak Start/Stop, tylko Restart. Caddy to
// reverse proxy CALEGO panelu (typowa instalacja EXPOSURE=world) - Stop
// odcina dostep do panelu (i wszystkich stron) bez mozliwosci ponownego
// Startu z poziomu UI (polaczenie z przegladarka i tak idzie przez
// Caddy), a Start i tak nigdy nie bylby klikalny w praktyce z tego
// samego powodu - jesli Caddy nie dziala, panel jest nieosiagalny.
function serviceDetailHtml(svc, title) {
  if (!svc.found) {
    return `<div class="empty-state">${t('services.not_installed_detail')}</div>`;
  }
  const isActive = svc.activeState === 'active';
  const isEnabled = svc.enabled === 'enabled';
  return `
    <div class="system-info-card">
      ${title ? `<h3>${escapeHtml(title)}</h3>` : ''}
      <dl>
        <dt data-i18n="services.unit"></dt><dd>${escapeHtml(svc.unit)}</dd>
        <dt data-i18n="services.status"></dt><dd><span class="status-badge ${isActive ? 'active' : 'inactive'}">${isActive ? t('services.active') : t('services.inactive')}</span> (${escapeHtml(svc.subState)})</dd>
        <dt data-i18n="services.enabled_label"></dt><dd>${isEnabled ? t('services.enabled') : t('services.disabled')}</dd>
        <dt data-i18n="services.pid"></dt><dd>${svc.mainPid || '-'}</dd>
        <dt data-i18n="services.since"></dt><dd>${escapeHtml(svc.since || '-')}</dd>
      </dl>
      <div class="service-actions">
        ${svc.key === 'caddy' ? '' : `<button type="button" data-key="${svc.key}" data-action="start">${t('services.action_start')}</button>`}
        <button type="button" data-key="${svc.key}" data-action="restart">${t('services.action_restart')}</button>
        ${svc.key === 'caddy' ? '' : `<button type="button" class="danger" data-key="${svc.key}" data-action="stop">${t('services.action_stop')}</button>`}
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
      <div style="display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start;">
        <div style="flex:1 1 260px;min-width:260px;">
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
        </div>
        <div style="flex:0 0 auto;">
          <div id="turnstile-preview-box" style="border:1px solid var(--border);border-radius:8px;padding:8px;pointer-events:none;">
            <div id="turnstile-preview"></div>
          </div>
        </div>
      </div>
      <div class="action-msg" id="turnstile-msg"></div>
    </div>
  `;
}

// Cloudflare-owy oficjalny publiczny testowy sitekey - uzywany TYLKO jako
// fallback, dopoki admin nie wpisal wlasnego site key ponizej. Cloudflare
// sam dopisuje do tego testowego widgetu adnotacje "tylko do testowania"
// (to nie jest cos co ten kod generuje ani moze usunac) - jak tylko admin
// wpisze prawdziwy site key, podglad przelacza sie na niego i adnotacja
// znika sama, bo to juz nie jest testowy klucz Cloudflare.
const TURNSTILE_PREVIEW_FALLBACK_SITEKEY = '1x00000000000000000000AA';
const turnstilePreviewWidgetIds = {};

// Rozwiazuje "system" do faktycznego jasny/ciemny - ta sama logika co CSS
// w web/index.html (html[data-theme="dark"] albo
// @media(prefers-color-scheme:dark) dla data-theme="system").
function effectiveTheme() {
  const saved = localStorage.getItem('cd-theme') || 'system';
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Wspolna logika podgladu widgetu Turnstile - uzywana zarowno w Uslugi ->
// Caddy (klucz wpisywany na biezaco) jak i w Uslugi -> phpMyAdmin ->
// Bramka Turnstile (klucz juz zapisany w panelu). Tylko JEDEN wariant na
// raz (nie jasny+ciemny obok siebie) - odpowiada aktualnie aktywnemu
// motywowi panelu, aktualizowany na zywo przy przelaczeniu motywu (patrz
// applyTheme() nizej). `name` to dowolny unikalny klucz do sledzenia id
// widgetu miedzy wywolaniami (rozne karty = rozne widgety).
async function renderTurnstilePreviewWidget(name, boxElId, widgetElId, sitekey) {
  const boxEl = document.getElementById(boxElId);
  const widgetEl = document.getElementById(widgetElId);
  if (!boxEl || !widgetEl) return;

  const theme = effectiveTheme();
  boxEl.style.background = theme === 'dark' ? '#0f1115' : '#ffffff';

  try {
    await loadTurnstileScript();
    widgetEl.innerHTML = '';
    if (turnstilePreviewWidgetIds[name] != null) {
      try { window.turnstile.remove(turnstilePreviewWidgetIds[name]); } catch { /* widget already gone */ }
      turnstilePreviewWidgetIds[name] = null;
    }
    turnstilePreviewWidgetIds[name] = window.turnstile.render(widgetEl, { sitekey, theme });
  } catch {
    // Podglad jest czysto informacyjny - brak polaczenia z Cloudflare nie
    // powinno przeszkadzac w reszcie sekcji (klucze/zapis nadal dzialaja).
  }
}

async function renderTurnstilePreviews() {
  const siteKeyInput = document.getElementById('turnstile-site-key');
  const sitekey = siteKeyInput?.value.trim() || TURNSTILE_PREVIEW_FALLBACK_SITEKEY;
  await renderTurnstilePreviewWidget('caddy', 'turnstile-preview-box', 'turnstile-preview', sitekey);
}

async function renderPhpmyadminGatePreview() {
  let sitekey = TURNSTILE_PREVIEW_FALLBACK_SITEKEY;
  try {
    const cfg = await api('GET', '/caddy/turnstile');
    if (cfg.siteKey) sitekey = cfg.siteKey;
  } catch {
    // brak dostepu do konfiguracji Turnstile - podglad spada na klucz testowy
  }
  await renderTurnstilePreviewWidget('phpmyadmin-gate', 'phpmyadmin-gate-preview-box', 'phpmyadmin-gate-preview', sitekey);
}

async function renderAdminerGatePreview() {
  let sitekey = TURNSTILE_PREVIEW_FALLBACK_SITEKEY;
  try {
    const cfg = await api('GET', '/caddy/turnstile');
    if (cfg.siteKey) sitekey = cfg.siteKey;
  } catch {
    // brak dostepu do konfiguracji Turnstile - podglad spada na klucz testowy
  }
  await renderTurnstilePreviewWidget('adminer-gate', 'adminer-gate-preview-box', 'adminer-gate-preview', sitekey);
}

function wireTurnstileSection() {
  const verifyBtn = document.getElementById('turnstile-verify-btn');
  const applyBtn = document.getElementById('turnstile-apply-btn');
  const toggleBtn = document.getElementById('turnstile-toggle-btn');
  const msgEl = document.getElementById('turnstile-msg');
  const widgetContainer = document.getElementById('turnstile-widget-container');
  renderTurnstilePreviews();
  const siteKeyInput = document.getElementById('turnstile-site-key');
  if (siteKeyInput) {
    let debounceTimer = null;
    siteKeyInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(renderTurnstilePreviews, 500);
    });
  }
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

function renderCaddyLogsSection() {
  return `
    <div class="system-info-card" style="margin-top:16px;">
      <p style="margin:0 0 10px;color:var(--muted);font-size:13px;">${t('caddylogs.description')}</p>
      <div class="service-actions">
        <button type="button" id="caddy-logs-ensure-btn">${t('caddylogs.ensure_button')}</button>
      </div>
      <div class="action-msg" id="caddy-logs-msg"></div>
    </div>
  `;
}

function wireCaddyLogsSection() {
  const btn = document.getElementById('caddy-logs-ensure-btn');
  if (!btn) return;
  const msgEl = document.getElementById('caddy-logs-msg');
  btn.onclick = async () => {
    btn.disabled = true;
    msgEl.textContent = t('caddylogs.ensuring');
    msgEl.className = 'action-msg';
    try {
      const result = await api('POST', '/caddy/logs/ensure');
      msgEl.textContent = result.message || t('caddylogs.ensure_success');
      msgEl.className = 'action-msg success';
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
    } finally {
      btn.disabled = false;
    }
  };
}

async function wrapCaddyExtras(serviceHtml) {
  const turnstileHtml = await renderTurnstileSection();
  const perfHtml = await renderCaddyPerformanceSection();
  const caddyfileHtml = await renderCaddyfileViewerSection();
  return `
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
      <div style="flex:1 1 0;min-width:320px;">${serviceHtml}${renderCaddyLogsSection()}</div>
      <div style="flex:1 1 0;min-width:320px;">${turnstileHtml}</div>
    </div>
    <div style="margin-top:16px;">${perfHtml}</div>
    <div style="margin-top:16px;">${caddyfileHtml}</div>
  `;
}

async function wrapSshExtras(serviceHtml) {
  const portHtml = await renderSshPortSection();
  return `
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
      <div style="flex:1 1 0;min-width:320px;">${serviceHtml}</div>
      <div style="flex:1 1 0;min-width:320px;">${portHtml}</div>
    </div>
  `;
}

async function renderCronJobsCountSection() {
  try {
    const { total, byUser } = await api('GET', '/cron/jobs-count');
    const rows = byUser.length
      ? byUser.map((u) => `<tr><td>${escapeHtml(u.username)}</td><td>${u.count}</td></tr>`).join('')
      : `<tr><td colspan="2" style="text-align:center;color:var(--muted);">${t('cron.jobs_count_empty')}</td></tr>`;
    return `
      <div class="system-info-card">
        <div class="stat-label">${t('cron.jobs_count_label')}</div>
        <div class="stat-value">${total}</div>
        <div style="overflow-x:auto;overflow-y:auto;max-height:220px;">
          <table class="firewall-table">
            <thead>
              <tr>
                <th>${t('cron.jobs_count_col_user')}</th>
                <th>${t('cron.jobs_count_col_count')}</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;
  } catch (e) {
    return `<div class="system-info-card"><div class="empty-state">${escapeHtml(e.message)}</div></div>`;
  }
}

async function wrapCronExtras(serviceHtml) {
  const countHtml = await renderCronJobsCountSection();
  return `
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
      <div style="flex:1 1 0;min-width:320px;">${serviceHtml}</div>
      <div style="flex:1 1 0;min-width:320px;">${countHtml}</div>
    </div>
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

async function renderMariadbTestDbSection() {
  let status;
  try {
    status = await api('GET', '/mariadb/test-db');
  } catch (e) {
    return `<div class="system-info-card"><div class="empty-state">${escapeHtml(e.message)}</div></div>`;
  }
  return `
    <div class="system-info-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:4px;">
        <h3 style="margin:0;font-size:15px;">${t('testdb.title')}</h3>
        <span class="status-badge ${status.exists ? 'active' : 'inactive'}">${status.exists ? t('testdb.exists') : t('testdb.missing')}</span>
      </div>
      <p style="margin:0 0 16px;color:var(--muted);font-size:13px;">${t('testdb.description')}</p>
      <dl style="margin:0 0 16px;">
        <dt>${t('testdb.db_label')}</dt><dd style="font-family:monospace;">baza123</dd>
        <dt>${t('testdb.user_label')}</dt><dd style="font-family:monospace;">baza123</dd>
        <dt>${t('testdb.password_label')}</dt><dd style="font-family:monospace;">pass!123</dd>
        <dt>${t('testdb.host_label')}</dt><dd style="font-family:monospace;">localhost</dd>
      </dl>
      <button type="button" id="mariadb-testdb-create-btn" ${status.exists ? 'disabled' : ''}>${t('testdb.create_button')}</button>
      <button type="button" class="danger" id="mariadb-testdb-drop-btn" ${status.exists ? '' : 'disabled'}>${t('testdb.drop_button')}</button>
      <div class="action-msg" id="mariadb-testdb-msg"></div>
    </div>
  `;
}

function wireMariadbTestDbSection() {
  const createBtn = document.getElementById('mariadb-testdb-create-btn');
  const dropBtn = document.getElementById('mariadb-testdb-drop-btn');
  if (!createBtn || !dropBtn) return;
  const msgEl = document.getElementById('mariadb-testdb-msg');

  async function refresh() {
    const html = await renderMariadbTestDbSection();
    const container = createBtn.closest('.system-info-card');
    if (container) {
      container.outerHTML = html;
      applyTranslations();
      wireMariadbTestDbSection();
    }
  }

  createBtn.onclick = async () => {
    if (!window.confirm(t('testdb.confirm_create'))) return;
    createBtn.disabled = true;
    msgEl.textContent = t('testdb.working');
    msgEl.className = 'action-msg';
    try {
      await api('POST', '/mariadb/test-db/create');
      await refresh();
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
      createBtn.disabled = false;
    }
  };

  dropBtn.onclick = async () => {
    if (!window.confirm(t('testdb.confirm_drop'))) return;
    dropBtn.disabled = true;
    msgEl.textContent = t('testdb.working');
    msgEl.className = 'action-msg';
    try {
      await api('POST', '/mariadb/test-db/drop');
      await refresh();
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
      dropBtn.disabled = false;
    }
  };
}

async function wrapMariadbExtras(serviceHtml) {
  const [perfHtml, testDbHtml] = await Promise.all([
    renderMariadbPerformanceSection(),
    renderMariadbTestDbSection()
  ]);
  return `
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
      <div style="flex:1 1 0;min-width:320px;display:flex;flex-direction:column;gap:16px;">
        ${serviceHtml}
        ${testDbHtml}
      </div>
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

async function renderPostgresqlTestDbSection() {
  let status;
  try {
    status = await api('GET', '/postgresql/test-db');
  } catch (e) {
    return `<div class="system-info-card"><div class="empty-state">${escapeHtml(e.message)}</div></div>`;
  }
  return `
    <div class="system-info-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:4px;">
        <h3 style="margin:0;font-size:15px;">${t('testdb.title')}</h3>
        <span class="status-badge ${status.exists ? 'active' : 'inactive'}">${status.exists ? t('testdb.exists') : t('testdb.missing')}</span>
      </div>
      <p style="margin:0 0 16px;color:var(--muted);font-size:13px;">${t('testdb.description')}</p>
      <dl style="margin:0 0 16px;">
        <dt>${t('testdb.db_label')}</dt><dd style="font-family:monospace;">baza123</dd>
        <dt>${t('testdb.user_label')}</dt><dd style="font-family:monospace;">baza123</dd>
        <dt>${t('testdb.password_label')}</dt><dd style="font-family:monospace;">pass!123</dd>
        <dt>${t('testdb.host_label')}</dt><dd style="font-family:monospace;">localhost</dd>
      </dl>
      <button type="button" id="postgresql-testdb-create-btn" ${status.exists ? 'disabled' : ''}>${t('testdb.create_button')}</button>
      <button type="button" class="danger" id="postgresql-testdb-drop-btn" ${status.exists ? '' : 'disabled'}>${t('testdb.drop_button')}</button>
      <div class="action-msg" id="postgresql-testdb-msg"></div>
    </div>
  `;
}

function wirePostgresqlTestDbSection() {
  const createBtn = document.getElementById('postgresql-testdb-create-btn');
  const dropBtn = document.getElementById('postgresql-testdb-drop-btn');
  if (!createBtn || !dropBtn) return;
  const msgEl = document.getElementById('postgresql-testdb-msg');

  async function refresh() {
    const html = await renderPostgresqlTestDbSection();
    const container = createBtn.closest('.system-info-card');
    if (container) {
      container.outerHTML = html;
      applyTranslations();
      wirePostgresqlTestDbSection();
    }
  }

  createBtn.onclick = async () => {
    if (!window.confirm(t('testdb.confirm_create'))) return;
    createBtn.disabled = true;
    msgEl.textContent = t('testdb.working');
    msgEl.className = 'action-msg';
    try {
      await api('POST', '/postgresql/test-db/create');
      await refresh();
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
      createBtn.disabled = false;
    }
  };

  dropBtn.onclick = async () => {
    if (!window.confirm(t('testdb.confirm_drop'))) return;
    dropBtn.disabled = true;
    msgEl.textContent = t('testdb.working');
    msgEl.className = 'action-msg';
    try {
      await api('POST', '/postgresql/test-db/drop');
      await refresh();
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
      dropBtn.disabled = false;
    }
  };
}

async function wrapPostgresqlExtras(serviceHtml) {
  const [perfHtml, testDbHtml] = await Promise.all([
    renderPostgresqlPerformanceSection(),
    renderPostgresqlTestDbSection()
  ]);
  return `
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
      <div style="flex:1 1 0;min-width:320px;display:flex;flex-direction:column;gap:16px;">
        ${serviceHtml}
        ${testDbHtml}
      </div>
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

async function renderMongodbTestDbSection() {
  let status;
  try {
    status = await api('GET', '/mongodb/test-db');
  } catch (e) {
    return `<div class="system-info-card"><div class="empty-state">${escapeHtml(e.message)}</div></div>`;
  }
  return `
    <div class="system-info-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:4px;">
        <h3 style="margin:0;font-size:15px;">${t('testdb.title')}</h3>
        <span class="status-badge ${status.exists ? 'active' : 'inactive'}">${status.exists ? t('testdb.exists') : t('testdb.missing')}</span>
      </div>
      <p style="margin:0 0 16px;color:var(--muted);font-size:13px;">${t('testdb.description')}</p>
      <dl style="margin:0 0 16px;">
        <dt>${t('testdb.db_label')}</dt><dd style="font-family:monospace;">baza123</dd>
        <dt>${t('testdb.user_label')}</dt><dd style="font-family:monospace;">baza123</dd>
        <dt>${t('testdb.password_label')}</dt><dd style="font-family:monospace;">pass!123</dd>
        <dt>${t('testdb.host_label')}</dt><dd style="font-family:monospace;">localhost</dd>
      </dl>
      <button type="button" id="mongodb-testdb-create-btn" ${status.exists ? 'disabled' : ''}>${t('testdb.create_button')}</button>
      <button type="button" class="danger" id="mongodb-testdb-drop-btn" ${status.exists ? '' : 'disabled'}>${t('testdb.drop_button')}</button>
      <div class="action-msg" id="mongodb-testdb-msg"></div>
    </div>
  `;
}

function wireMongodbTestDbSection() {
  const createBtn = document.getElementById('mongodb-testdb-create-btn');
  const dropBtn = document.getElementById('mongodb-testdb-drop-btn');
  if (!createBtn || !dropBtn) return;
  const msgEl = document.getElementById('mongodb-testdb-msg');

  async function refresh() {
    const html = await renderMongodbTestDbSection();
    const container = createBtn.closest('.system-info-card');
    if (container) {
      container.outerHTML = html;
      applyTranslations();
      wireMongodbTestDbSection();
    }
  }

  createBtn.onclick = async () => {
    if (!window.confirm(t('testdb.confirm_create'))) return;
    createBtn.disabled = true;
    msgEl.textContent = t('testdb.working');
    msgEl.className = 'action-msg';
    try {
      await api('POST', '/mongodb/test-db/create');
      await refresh();
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
      createBtn.disabled = false;
    }
  };

  dropBtn.onclick = async () => {
    if (!window.confirm(t('testdb.confirm_drop'))) return;
    dropBtn.disabled = true;
    msgEl.textContent = t('testdb.working');
    msgEl.className = 'action-msg';
    try {
      await api('POST', '/mongodb/test-db/drop');
      await refresh();
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
      dropBtn.disabled = false;
    }
  };
}

async function wrapMongodbExtras(serviceHtml) {
  const [perfHtml, testDbHtml] = await Promise.all([
    renderMongodbPerformanceSection(),
    renderMongodbTestDbSection()
  ]);
  return `
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
      <div style="flex:1 1 0;min-width:320px;display:flex;flex-direction:column;gap:16px;">
        ${serviceHtml}
        ${testDbHtml}
      </div>
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

// Lista kont hostingowych, ktore SAME zalozyly sobie prywatna instancje
// Redis z panelu klienta (/user/ - Redis, server/services/hostingUserRedis.js)
// - NIE lista wszystkich kont, tylko tych faktycznie korzystajacych.
// Nowy, oddzielny rzad pod istniejacym rzedem status+wydajnosc (nie w tej
// samej kolumnie) - jeden kafelek do przegladu/edycji limitu RAM per
// user, drugi informacyjno/statystyczny.
function redisInstancesListCardHtml(instances) {
  const rows = instances.length
    ? instances.map((i) => `
        <tr>
          <td>${escapeHtml(i.username)}</td>
          <td><span class="status-badge ${i.running ? 'active' : 'inactive'}">${i.running ? t('services.active') : t('services.inactive')}</span></td>
          <td>${i.maxMemoryMb} MB</td>
          <td><button type="button" class="secondary" data-redis-edit="${escapeHtml(i.username)}" data-redis-current="${i.maxMemoryMb}">${t('redisadmin.edit_button')}</button></td>
        </tr>
      `).join('')
    : `<tr><td colspan="4" style="text-align:center;color:var(--muted);">${t('redisadmin.empty')}</td></tr>`;

  return `
    <h3>${t('redisadmin.list_title')}</h3>
    <div style="overflow-x:auto;">
      <table class="firewall-table">
        <thead>
          <tr>
            <th>${t('redisadmin.col_user')}</th>
            <th>${t('redisadmin.col_status')}</th>
            <th>${t('redisadmin.col_maxmemory')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function redisInstancesStatsCardHtml(instances) {
  const runningCount = instances.filter((i) => i.running).length;
  const totalMb = instances.reduce((sum, i) => sum + i.maxMemoryMb, 0);

  return `
    <h3>${t('redisadmin.stats_title')}</h3>
    <div class="info-grid">
      <div class="info-label">${t('redisadmin.stats_total')}</div><div class="info-value">${instances.length}</div>
      <div class="info-label">${t('redisadmin.stats_running')}</div><div class="info-value">${runningCount}</div>
      <div class="info-label">${t('redisadmin.stats_total_mb')}</div><div class="info-value">${totalMb} MB</div>
    </div>
  `;
}

async function renderRedisInstancesRow() {
  try {
    const instances = await api('GET', '/redis-instances');
    return `
      <div id="redis-instances-row" style="display:grid;grid-template-columns:minmax(0, 1fr) minmax(0, 1fr);gap:16px;width:100%;margin-top:16px;">
        <div class="system-info-card" style="max-width:none;width:100%;box-sizing:border-box;">
          ${redisInstancesListCardHtml(instances)}
        </div>
        <div class="system-info-card" style="max-width:none;width:100%;box-sizing:border-box;">
          ${redisInstancesStatsCardHtml(instances)}
        </div>
      </div>
    `;
  } catch (e) {
    return `<div id="redis-instances-row" class="system-info-card" style="margin-top:16px;"><div class="empty-state">${escapeHtml(e.message)}</div></div>`;
  }
}

async function refreshRedisInstancesRow() {
  const row = document.getElementById('redis-instances-row');
  if (!row) return;
  row.outerHTML = await renderRedisInstancesRow();
  wireRedisInstancesSection();
}

function wireRedisInstancesSection() {
  document.querySelectorAll('[data-redis-edit]').forEach((btn) => {
    btn.onclick = async () => {
      const username = btn.dataset.redisEdit;
      const input = window.prompt(t('redisadmin.prompt_maxmemory', { user: username }), btn.dataset.redisCurrent);
      if (input === null) return;
      const mb = parseInt(input, 10);
      if (!Number.isInteger(mb) || mb < 1) {
        window.alert(t('redisadmin.invalid_maxmemory'));
        return;
      }
      btn.disabled = true;
      try {
        await api('PUT', `/redis-instances/${username}/max-memory`, { maxMemoryMb: mb });
        await refreshRedisInstancesRow();
      } catch (e) {
        window.alert(e.message);
        btn.disabled = false;
      }
    };
  });
}

async function wrapRedisExtras(serviceHtml) {
  const perfHtml = await renderRedisPerformanceSection();
  const instancesRowHtml = await renderRedisInstancesRow();
  return `
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
      <div style="flex:1 1 0;min-width:320px;">${serviceHtml}</div>
      <div style="flex:1 1 0;min-width:320px;">${perfHtml}</div>
    </div>
    ${instancesRowHtml}
  `;
}

function timezoneOptionsHtml(selected) {
  let zones;
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = null;
  }
  if (!zones || !zones.length) return null;
  return zones.map((z) => `<option value="${escapeHtml(z)}"${z === selected ? ' selected' : ''}>${escapeHtml(z)}</option>`).join('');
}

function withSuggested(hintKey, value) {
  return `${t(hintKey)} ${t('phpsettings.suggested_value', { value })}`;
}

async function renderPhpSettingsSection(id) {
  let current = {};
  let readFailed = false;
  try {
    current = await api('GET', `/php/${id}/settings`);
  } catch (e) {
    current = {};
    readFailed = true;
    console.error('GET /php/' + id + '/settings failed:', e.message);
  }

  let detectedTz = 'UTC';
  try {
    detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    // zostaje UTC
  }
  const currentTz = current.timezone || detectedTz;
  const tzOptions = timezoneOptionsHtml(currentTz);
  const tzField = tzOptions
    ? `<select id="phpsettings-timezone-${id}" style="width:100%;margin-bottom:4px;">${tzOptions}</select>`
    : `<input type="text" id="phpsettings-timezone-${id}" value="${escapeHtml(currentTz)}" placeholder="np. Europe/Warsaw" style="width:100%;margin-bottom:4px;">`;

  const memoryLimitMb = current.memoryLimitMb ?? 256;
  const uploadMaxMb = current.uploadMaxMb ?? 64;
  const maxExecutionTime = current.maxExecutionTime ?? 60;
  const maxInputTime = current.maxInputTime ?? 60;
  const maxInputVars = current.maxInputVars ?? 5000;
  const maxFileUploads = current.maxFileUploads ?? 50;
  const exposePhp = current.exposePhp ?? false;
  const readFailedBanner = readFailed
    ? `<div class="action-msg error" style="margin-bottom:14px;">${t('phpsettings.read_failed')}</div>`
    : '';

  return `
    <div class="system-info-card">
      <h3 style="margin:0 0 4px;font-size:15px;">${t('phpsettings.title')}</h3>
      ${readFailedBanner}
      <p style="margin:0 0 16px;color:var(--muted);font-size:13px;">${t('phpsettings.description')}</p>

      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('phpsettings.timezone_label')}</label>
      ${tzField}
      <div style="font-size:11px;color:var(--muted);margin-bottom:14px;">${t('phpsettings.timezone_hint')}</div>

      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('phpsettings.memory_limit_label')}</label>
      <input type="number" id="phpsettings-memory-${id}" value="${memoryLimitMb}" min="16" style="width:100%;margin-bottom:4px;">
      <div style="font-size:11px;color:var(--muted);margin-bottom:14px;">${withSuggested('phpsettings.memory_limit_hint', '256 MB')}</div>

      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('phpsettings.upload_max_label')}</label>
      <input type="number" id="phpsettings-upload-${id}" value="${uploadMaxMb}" min="1" style="width:100%;margin-bottom:4px;">
      <div style="font-size:11px;color:var(--muted);margin-bottom:16px;">${withSuggested('phpsettings.upload_max_hint', '64 MB')}</div>

      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('phpsettings.max_execution_time_label')}</label>
      <input type="number" id="phpsettings-max-execution-time-${id}" value="${maxExecutionTime}" min="1" style="width:100%;margin-bottom:4px;">
      <div style="font-size:11px;color:var(--muted);margin-bottom:14px;">${withSuggested('phpsettings.max_execution_time_hint', '60 s')}</div>

      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('phpsettings.max_input_time_label')}</label>
      <input type="number" id="phpsettings-max-input-time-${id}" value="${maxInputTime}" min="1" style="width:100%;margin-bottom:4px;">
      <div style="font-size:11px;color:var(--muted);margin-bottom:14px;">${withSuggested('phpsettings.max_input_time_hint', '60 s')}</div>

      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('phpsettings.max_input_vars_label')}</label>
      <input type="number" id="phpsettings-max-input-vars-${id}" value="${maxInputVars}" min="100" style="width:100%;margin-bottom:4px;">
      <div style="font-size:11px;color:var(--muted);margin-bottom:14px;">${withSuggested('phpsettings.max_input_vars_hint', '5000')}</div>

      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('phpsettings.max_file_uploads_label')}</label>
      <input type="number" id="phpsettings-max-file-uploads-${id}" value="${maxFileUploads}" min="1" style="width:100%;margin-bottom:4px;">
      <div style="font-size:11px;color:var(--muted);margin-bottom:16px;">${withSuggested('phpsettings.max_file_uploads_hint', '50')}</div>

      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('phpsettings.expose_php_label')}</label>
      <select id="phpsettings-expose-php-${id}" style="width:100%;margin-bottom:4px;">
        <option value="off"${!exposePhp ? ' selected' : ''}>Off</option>
        <option value="on"${exposePhp ? ' selected' : ''}>On</option>
      </select>
      <div style="font-size:11px;color:var(--muted);margin-bottom:16px;">${withSuggested('phpsettings.expose_php_hint', 'Off')}</div>

      <button type="button" id="phpsettings-save-btn-${id}">${t('phpsettings.save_button')}</button>
      <div class="action-msg" id="phpsettings-msg-${id}"></div>
    </div>
  `;
}

function wirePhpSettingsSection(id) {
  const btn = document.getElementById(`phpsettings-save-btn-${id}`);
  if (!btn) return;
  const msgEl = document.getElementById(`phpsettings-msg-${id}`);

  btn.onclick = async () => {
    const timezone = document.getElementById(`phpsettings-timezone-${id}`).value.trim();
    const memoryLimitMb = parseInt(document.getElementById(`phpsettings-memory-${id}`).value, 10);
    const uploadMaxMb = parseInt(document.getElementById(`phpsettings-upload-${id}`).value, 10);
    const maxExecutionTime = parseInt(document.getElementById(`phpsettings-max-execution-time-${id}`).value, 10);
    const maxInputTime = parseInt(document.getElementById(`phpsettings-max-input-time-${id}`).value, 10);
    const maxInputVars = parseInt(document.getElementById(`phpsettings-max-input-vars-${id}`).value, 10);
    const maxFileUploads = parseInt(document.getElementById(`phpsettings-max-file-uploads-${id}`).value, 10);
    const exposePhp = document.getElementById(`phpsettings-expose-php-${id}`).value === 'on';

    if (!timezone || ![memoryLimitMb, uploadMaxMb, maxExecutionTime, maxInputTime, maxInputVars, maxFileUploads].every(Number.isInteger)) {
      msgEl.textContent = t('phpsettings.invalid_values');
      msgEl.className = 'action-msg error';
      return;
    }
    if (!window.confirm(t('phpsettings.confirm_save'))) return;

    btn.disabled = true;
    msgEl.textContent = t('phpsettings.saving');
    msgEl.className = 'action-msg';
    try {
      await api('POST', `/php/${id}/settings`, {
        timezone, memoryLimitMb, uploadMaxMb, maxExecutionTime, maxInputTime, maxInputVars, maxFileUploads, exposePhp
      });
      msgEl.textContent = t('phpsettings.save_success');
      msgEl.className = 'action-msg success';
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
    } finally {
      btn.disabled = false;
    }
  };
}

async function renderPhpOpcacheSection(id) {
  let current = {};
  let readFailed = false;
  try {
    current = await api('GET', `/php/${id}/opcache`);
  } catch (e) {
    current = {};
    readFailed = true;
    console.error('GET /php/' + id + '/opcache failed:', e.message);
  }

  const memoryConsumptionMb = current.memoryConsumptionMb ?? 256;
  const internedStringsBufferMb = current.internedStringsBufferMb ?? 32;
  const maxAcceleratedFiles = current.maxAcceleratedFiles ?? 50000;
  const revalidateFreqSec = current.revalidateFreqSec ?? 2;
  const validateTimestamps = current.validateTimestamps ?? true;
  const readFailedBanner = readFailed
    ? `<div class="action-msg error" style="margin-bottom:14px;">${t('phpopcache.read_failed')}</div>`
    : '';

  return `
    <div class="system-info-card">
      <h3 style="margin:0 0 4px;font-size:15px;">${t('phpopcache.title')}</h3>
      ${readFailedBanner}
      <p style="margin:0 0 16px;color:var(--muted);font-size:13px;">${t('phpopcache.description')}</p>

      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('phpopcache.memory_label')}</label>
      <input type="number" id="phpopcache-memory-${id}" value="${memoryConsumptionMb}" min="16" style="width:100%;margin-bottom:4px;">
      <div style="font-size:11px;color:var(--muted);margin-bottom:14px;">${withSuggested('phpopcache.memory_hint', '256 MB')}</div>

      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('phpopcache.interned_strings_label')}</label>
      <input type="number" id="phpopcache-interned-${id}" value="${internedStringsBufferMb}" min="4" style="width:100%;margin-bottom:4px;">
      <div style="font-size:11px;color:var(--muted);margin-bottom:14px;">${withSuggested('phpopcache.interned_strings_hint', '32 MB')}</div>

      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('phpopcache.max_files_label')}</label>
      <input type="number" id="phpopcache-max-files-${id}" value="${maxAcceleratedFiles}" min="1000" style="width:100%;margin-bottom:4px;">
      <div style="font-size:11px;color:var(--muted);margin-bottom:14px;">${withSuggested('phpopcache.max_files_hint', '50000')}</div>

      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${t('phpopcache.revalidate_freq_label')}</label>
      <input type="number" id="phpopcache-revalidate-${id}" value="${revalidateFreqSec}" min="0" style="width:100%;margin-bottom:4px;">
      <div style="font-size:11px;color:var(--muted);margin-bottom:14px;">${withSuggested('phpopcache.revalidate_freq_hint', '2 s')}</div>

      <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:4px;">
        <input type="checkbox" id="phpopcache-validate-timestamps-${id}"${validateTimestamps ? ' checked' : ''}>
        ${t('phpopcache.validate_timestamps_label')}
      </label>
      <div style="font-size:11px;color:var(--muted);margin-bottom:16px;">${t('phpopcache.validate_timestamps_hint')}</div>

      <button type="button" id="phpopcache-save-btn-${id}">${t('phpopcache.save_button')}</button>
      <div class="action-msg" id="phpopcache-msg-${id}"></div>
    </div>
  `;
}

function wirePhpOpcacheSection(id) {
  const btn = document.getElementById(`phpopcache-save-btn-${id}`);
  if (!btn) return;
  const msgEl = document.getElementById(`phpopcache-msg-${id}`);

  btn.onclick = async () => {
    const memoryConsumptionMb = parseInt(document.getElementById(`phpopcache-memory-${id}`).value, 10);
    const internedStringsBufferMb = parseInt(document.getElementById(`phpopcache-interned-${id}`).value, 10);
    const maxAcceleratedFiles = parseInt(document.getElementById(`phpopcache-max-files-${id}`).value, 10);
    const revalidateFreqSec = parseInt(document.getElementById(`phpopcache-revalidate-${id}`).value, 10);
    const validateTimestamps = document.getElementById(`phpopcache-validate-timestamps-${id}`).checked;

    if (![memoryConsumptionMb, internedStringsBufferMb, maxAcceleratedFiles, revalidateFreqSec].every(Number.isInteger)) {
      msgEl.textContent = t('phpopcache.invalid_values');
      msgEl.className = 'action-msg error';
      return;
    }
    if (!window.confirm(t('phpopcache.confirm_save'))) return;

    btn.disabled = true;
    msgEl.textContent = t('phpopcache.saving');
    msgEl.className = 'action-msg';
    try {
      await api('POST', `/php/${id}/opcache`, {
        memoryConsumptionMb, internedStringsBufferMb, maxAcceleratedFiles, revalidateFreqSec, validateTimestamps
      });
      msgEl.textContent = t('phpopcache.save_success');
      msgEl.className = 'action-msg success';
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = 'action-msg error';
    } finally {
      btn.disabled = false;
    }
  };
}

// Ladne etykiety dla najczestszych modulow - lista modulow sama w sobie
// jest teraz w pelni dynamiczna (odkrywana z Remi, nie ograniczona do
// tych ponizej), wiec to tylko kosmetyka dla znanych nazw; wszystko inne
// dostaje humanizePhpModuleKey() jako fallback.
const PHP_MODULE_LABELS = {
  opcache: 'OPcache', pdo: 'PDO', mysqlnd: 'MySQL (mysqlnd)', pgsql: 'PostgreSQL',
  mbstring: 'Mbstring', xml: 'XML', curl: 'cURL', gd: 'GD', 'pecl-imagick': 'Imagick',
  intl: 'Intl', zip: 'ZIP', bcmath: 'BCMath', sodium: 'Sodium', exif: 'EXIF',
  soap: 'SOAP', 'pecl-redis': 'Redis', process: 'Process (pcntl/posix)'
};

function humanizePhpModuleKey(key) {
  if (PHP_MODULE_LABELS[key]) return PHP_MODULE_LABELS[key];
  return key.replace(/^pkg-/, '').replace(/^pecl-/, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Dwa osobne poziomy z oficjalnej dokumentacji WordPressa
// (make.wordpress.org/hosting/handbook/server-environment/), zweryfikowane
// na zywo z tej strony, nie zgadywane. Celowo NIE laczymy ich w jeden
// badge - strona sama rozroznia 4 kategorie modulow, wiec panel pokazuje
// je wszystkie osobno i jawnie (na wyrazne zyczenie - nic nie ma byc
// pomijane): REQUIRED, HIGHLY RECOMMENDED, "Recommended (cache) -
// wystarczy jedno z wielu" (opcache/redis/apcu/memcached) i "Optional/
// fallback" (sodium, iconv, bcmath, filter, shmop, simplexml, xmlreader,
// zlib, timezonedb, ssh2, ftp, sockets).
// Kilka wariantow nazw pakietow na kazdy modul, bo dokladny sufiks
// zalezy od konkretnego builda Remi (potwierdzone na zywym serwerze
// 2026-08-09: ta instalacja ma np. "pecl-zip" nie "zip", i
// "pecl-imagick-im7" nie "pecl-imagick" - stad kilka wariantow, nie
// jeden zgadywany).
const WORDPRESS_REQUIRED_MODULES = new Set(['json', 'mysqli', 'mysqlnd']);
const WORDPRESS_RECOMMENDED_MODULES = new Set([
  'curl', 'dom', 'exif', 'fileinfo', 'hash',
  'igbinary', 'pecl-igbinary',
  'imagick', 'pecl-imagick', 'pecl-imagick-im6', 'pecl-imagick-im7',
  'intl', 'mbstring', 'openssl', 'xml',
  'zip', 'pecl-zip'
]);
const WORDPRESS_CACHING_MODULES = new Set([
  'opcache',
  'redis', 'pecl-redis', 'pecl-redis5', 'pecl-redis6',
  'apcu', 'pecl-apcu',
  'memcached', 'pecl-memcached'
]);
const WORDPRESS_OPTIONAL_MODULES = new Set([
  'sodium',
  'iconv',
  'bc', 'bcmath',
  'filter',
  'shmop',
  'simplexml',
  'xmlreader',
  'zlib',
  'timezonedb', 'pecl-timezonedb',
  'ssh2', 'pecl-ssh2',
  'ftp',
  'sockets'
]);

function wordpressBadgeHtml(moduleKey) {
  if (WORDPRESS_REQUIRED_MODULES.has(moduleKey)) {
    return `<span title="${escapeHtml(t('phpmodules.wordpress_required_title'))}" style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:10px;border:1px solid var(--danger);color:var(--danger);font-size:10px;white-space:nowrap;">${t('phpmodules.wordpress_required')}</span>`;
  }
  if (WORDPRESS_RECOMMENDED_MODULES.has(moduleKey)) {
    return `<span title="${escapeHtml(t('phpmodules.wordpress_recommended_title'))}" style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:10px;border:1px solid var(--accent);color:var(--accent);font-size:10px;white-space:nowrap;">${t('phpmodules.wordpress_recommended')}</span>`;
  }
  if (WORDPRESS_CACHING_MODULES.has(moduleKey)) {
    return `<span title="${escapeHtml(t('phpmodules.wordpress_caching_title'))}" style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:10px;border:1px solid var(--warning, #d19a1c);color:var(--warning, #d19a1c);font-size:10px;white-space:nowrap;">${t('phpmodules.wordpress_caching')}</span>`;
  }
  if (WORDPRESS_OPTIONAL_MODULES.has(moduleKey)) {
    return `<span title="${escapeHtml(t('phpmodules.wordpress_optional_title'))}" style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:10px;border:1px solid var(--muted);color:var(--muted);font-size:10px;white-space:nowrap;">${t('phpmodules.wordpress_optional')}</span>`;
  }
  return '';
}

// Musi byc identyczna z PROTECTED_MODULES w server/runtime-manager/routes/php.js
// (i z case'em w php-toggle-module.sh) - te pakiety sa POKAZYWANE w
// tabeli (user chcial widziec wszystkie php84-* bez wyjatku), ale bez
// przycisku Dodaj/Usun, bo to fundament/rusztowanie SCL, nie "modul".
const PHP_PROTECTED_MODULE_KEYS = new Set(['fpm', 'cli', 'common', 'pkg-php', 'pkg-build', 'pkg-runtime', 'pkg-scldevel', 'pkg-syspaths']);

async function renderPhpModulesSection(id) {
  let modules;
  try {
    modules = (await api('GET', `/php/${id}/modules`)).modules;
  } catch (e) {
    return `<div class="system-info-card"><div class="empty-state">${escapeHtml(e.message)}</div></div>`;
  }

  const rows = modules.map((m) => {
    const label = m.package;
    const wpBadge = wordpressBadgeHtml(m.key);
    const isProtected = PHP_PROTECTED_MODULE_KEYS.has(m.key);
    const actionButton = isProtected
      ? `<span class="status-badge" style="opacity:0.6;">${t('phpmodules.protected')}</span>`
      : (m.enabled
        ? `<button type="button" class="danger" data-module="${escapeHtml(m.key)}" data-module-action="remove">${t('phpmodules.remove_button')}</button>`
        : `<button type="button" data-module="${escapeHtml(m.key)}" data-module-action="install">${t('phpmodules.add_button')}</button>`);
    return `
      <tr>
        <td>${escapeHtml(label)}${wpBadge}</td>
        <td><span class="status-badge ${m.enabled ? 'active' : 'inactive'}">${m.enabled ? t('phpmodules.enabled') : t('phpmodules.disabled')}</span></td>
        <td>${actionButton}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="system-info-card">
      <h3 style="margin:0 0 4px;font-size:15px;">${t('phpmodules.title')}</h3>
      <p style="margin:0 0 16px;color:var(--muted);font-size:13px;">${t('phpmodules.description')}</p>
      <table class="firewall-table php-modules-table">
        <thead>
          <tr>
            <th>${t('phpmodules.column_module')}</th>
            <th>${t('phpmodules.column_status')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="phpmodules-tbody-${id}">${rows}</tbody>
      </table>
      <div class="action-msg" id="phpmodules-msg-${id}"></div>
    </div>
  `;
}

function wirePhpModulesSection(id) {
  const tbody = document.getElementById(`phpmodules-tbody-${id}`);
  if (!tbody) return;
  const msgEl = document.getElementById(`phpmodules-msg-${id}`);

  tbody.querySelectorAll('button[data-module]').forEach((btn) => {
    btn.onclick = async () => {
      const moduleKey = btn.dataset.module;
      const action = btn.dataset.moduleAction;
      const label = humanizePhpModuleKey(moduleKey);
      const confirmMsg = action === 'install'
        ? t('phpmodules.confirm_add', { module: label })
        : t('phpmodules.confirm_remove', { module: label });
      if (!window.confirm(confirmMsg)) return;

      tbody.querySelectorAll('button[data-module]').forEach((b) => { b.disabled = true; });
      msgEl.textContent = t('phpmodules.working');
      msgEl.className = 'action-msg';
      try {
        await api('POST', `/php/${id}/modules/${moduleKey}/${action}`);
        const sectionHtml = await renderPhpModulesSection(id);
        const card = tbody.closest('.system-info-card');
        card.outerHTML = sectionHtml;
        wirePhpModulesSection(id);
        const successEl = document.getElementById(`phpmodules-msg-${id}`);
        if (successEl) {
          successEl.textContent = t('phpmodules.success');
          successEl.className = 'action-msg success';
        }
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'action-msg error';
        tbody.querySelectorAll('button[data-module]').forEach((b) => { b.disabled = false; });
      }
    };
  });
}

async function wrapPhpExtras(serviceHtml, id) {
  // Kolumna 1 to WLASNY flex-column (usluga + OPcache uloz jeden pod
  // drugim), nie osobny "rzad" pod calym wierszem - inaczej OPcache
  // ladowal sie pod calym rzedem 1 (czyli pod wyzsza z dwoch kolumn,
  // formularz ustawien), zostawiajac widoczna dziure pod krotszym boxem
  // usługi zamiast byc bezposrednio pod nim.
  const [opcacheHtml, settingsHtml, modulesHtml] = await Promise.all([
    renderPhpOpcacheSection(id),
    renderPhpSettingsSection(id),
    renderPhpModulesSection(id)
  ]);
  const columns = `
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
      <div style="flex:1 1 0;min-width:320px;display:flex;flex-direction:column;gap:16px;">
        ${serviceHtml}
        ${opcacheHtml}
      </div>
      <div style="flex:1 1 0;min-width:320px;">${settingsHtml}</div>
    </div>
  `;
  const modulesRow = `<div style="margin-top:16px;">${modulesHtml}</div>`;
  return columns + modulesRow;
}

function confirmMessageFor(key, action) {
  if (action === 'stop' && key === 'ssh') return t('services.confirm_stop_ssh');
  if (action === 'stop' && key === 'firewall') return t('services.confirm_stop_firewall');
  if (action === 'stop' && key === 'caddy') return t('services.confirm_stop_caddy');
  return t('services.confirm_action', { action: t('services.action_' + action) });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Caddy jest reverse proxy CALEGO panelu (panel.20z.eu -> Caddy ->
// 127.0.0.1:PORT) - kiedy ta akcja to restart/stop/start Caddy, samo
// polaczenie przegladarki, ktorym leci ta prosba, przechodzi PRZEZ
// Caddy. `systemctl restart` najpierw zabija proces (zrywajac to
// polaczenie), dopiero potem go podnosi - przegladarka dostaje siecowy
// blad (np. "Failed to fetch" w Chrome), NIE odpowiedz HTTP, mimo ze
// akcja najpewniej sie udala. Zamiast pokazywac to od razu jako blad,
// odczekaj chwile (kilka prob, Caddy zwykle wraca w ulamku sekundy) i
// sprawdz prawdziwy status jeszcze raz, zanim uznasz, ze naprawde sie
// nie udalo.
async function waitForServiceStatus(key, { attempts = 4, delayMs = 1500 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    await sleep(delayMs);
    try {
      return await api('GET', `/services/${key}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
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

      const applySuccess = async (svc) => {
        const phpMatch = /^php(\d{2})$/.exec(key);
        let html = serviceDetailHtml(svc, serviceTitleFor(svc));
        if (key === 'ssh' && svc.found) html = await wrapSshExtras(html);
        if (key === 'cron' && svc.found) html = await wrapCronExtras(html);
        if (key === 'firewall' && svc.found) html += `<div class="system-info-card" id="fw-section-container">${await renderFirewallSection()}</div>`;
        if (key === 'fail2ban' && svc.found) html += `<div class="system-info-card">${await renderFail2banSection()}</div>`;
        if (key === 'caddy' && svc.found) html = await wrapCaddyExtras(html);
        if (key === 'mariadb' && svc.found) html = await wrapMariadbExtras(html);
        if (key === 'postgresql' && svc.found) html = await wrapPostgresqlExtras(html);
        if (key === 'mongodb' && svc.found) html = await wrapMongodbExtras(html);
        if (key === 'redis' && svc.found) html = await wrapRedisExtras(html);
        if (phpMatch && svc.found) html = await wrapPhpExtras(html, phpMatch[1]);
        document.getElementById('content').innerHTML = html;
        applyTranslations();
        wireServiceActions(key);
        if (key === 'ssh' && svc.found) wireSshPortSection();
        if (key === 'firewall' && svc.found) wireFirewallSection();
        if (key === 'fail2ban' && svc.found) wireFail2banSection();
        if (key === 'caddy' && svc.found) { wireTurnstileSection(); wireCaddyPerformanceSection(); wireCaddyLogsSection(); }
        if (key === 'mariadb' && svc.found) wireMariadbPerformanceSection();
        if (key === 'postgresql' && svc.found) wirePostgresqlPerformanceSection();
        if (key === 'mongodb' && svc.found) { wireMongodbPerformanceSection(); wireMongodbTestDbSection(); }
        if (key === 'redis' && svc.found) { wireRedisPerformanceSection(); wireRedisInstancesSection(); }
        if (phpMatch && svc.found) {
          wirePhpSettingsSection(phpMatch[1]);
          wirePhpOpcacheSection(phpMatch[1]);
          wirePhpModulesSection(phpMatch[1]);
        }
        const successEl = document.getElementById(`${key}-action-msg`);
        successEl.textContent = t('services.action_success');
        successEl.className = 'action-msg success';
      };

      try {
        const svc = await api('POST', `/services/${key}/${action}`);
        await applySuccess(svc);
      } catch (e) {
        if (key === 'caddy') {
          try {
            const svc = await waitForServiceStatus(key);
            await applySuccess(svc);
            return;
          } catch {
            // dalej sie nie udalo - pokaz oryginalny blad ponizej
          }
        }
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
    if (key === 'phpmyadmin') {
      const status = await api('GET', '/phpmyadmin');
      const gateHtml = await renderPhpmyadminGateSection(status);
      content.innerHTML = `
        <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
          <div style="flex:1 1 0;min-width:320px;">${phpmyadminInfoCardHtml(status, true, false)}</div>
          <div style="flex:1 1 0;min-width:320px;">${gateHtml}</div>
        </div>
      `;
      applyTranslations();
      wirePhpmyadminInstallTile();
      wirePhpmyadminGateSection(status);
      return;
    }
    if (key === 'adminer') {
      const status = await api('GET', '/adminer');
      const gateHtml = await renderAdminerGateSection(status);
      content.innerHTML = `
        <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
          <div style="flex:1 1 0;min-width:320px;">${adminerInfoCardHtml(status, true, false)}</div>
          <div style="flex:1 1 0;min-width:320px;">${gateHtml}</div>
        </div>
      `;
      applyTranslations();
      wireAdminerInstallTile();
      wireAdminerGateSection(status);
      return;
    }
    if (key === 'roundcube') {
      const status = await api('GET', '/roundcube');
      content.innerHTML = await renderRoundcubeInstallPageHtml(status);
      applyTranslations();
      wireRoundcubeInstallTile();
      wireRoundcubeGateSection(status);
      return;
    }
    const svc = await api('GET', `/services/${key}`);
    const phpMatch = /^php(\d{2})$/.exec(key);
    let html = serviceDetailHtml(svc, serviceTitleFor(svc));
    if (key === 'ssh' && svc.found) html = await wrapSshExtras(html);
    if (key === 'cron' && svc.found) html = await wrapCronExtras(html);
    if (key === 'firewall' && svc.found) html += `<div class="system-info-card" id="fw-section-container">${await renderFirewallSection()}</div>`;
    if (key === 'fail2ban' && svc.found) html += `<div class="system-info-card">${await renderFail2banSection()}</div>`;
    if (key === 'caddy' && svc.found) html = await wrapCaddyExtras(html);
    if (key === 'mariadb' && svc.found) html = await wrapMariadbExtras(html);
    if (key === 'postgresql' && svc.found) html = await wrapPostgresqlExtras(html);
    if (key === 'mongodb' && svc.found) html = await wrapMongodbExtras(html);
    if (key === 'redis' && svc.found) html = await wrapRedisExtras(html);
    if (phpMatch && svc.found) html = await wrapPhpExtras(html, phpMatch[1]);
    content.innerHTML = html;
    applyTranslations();
    wireServiceActions(key);
    if (key === 'ssh' && svc.found) wireSshPortSection();
    if (key === 'firewall' && svc.found) wireFirewallSection();
    if (key === 'fail2ban' && svc.found) wireFail2banSection();
    if (key === 'caddy' && svc.found) { wireTurnstileSection(); wireCaddyPerformanceSection(); wireCaddyLogsSection(); }
    if (key === 'mariadb' && svc.found) { wireMariadbPerformanceSection(); wireMariadbTestDbSection(); }
    if (key === 'postgresql' && svc.found) { wirePostgresqlPerformanceSection(); wirePostgresqlTestDbSection(); }
    if (key === 'mongodb' && svc.found) { wireMongodbPerformanceSection(); wireMongodbTestDbSection(); }
    if (key === 'redis' && svc.found) { wireRedisPerformanceSection(); wireRedisInstancesSection(); }
    if (phpMatch && svc.found) {
      wirePhpSettingsSection(phpMatch[1]);
      wirePhpOpcacheSection(phpMatch[1]);
      wirePhpModulesSection(phpMatch[1]);
    }
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
