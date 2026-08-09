import http from 'http';

// Klient panelu do Runtime Managera (osobny proces, server/runtime-manager/,
// dziala jako TEN SAM SVC_USER co panel - patrz komentarz w
// server/runtime-manager/index.js) - komunikacja wylacznie po unix
// sockecie, nigdy po sieci. Skoro oba procesy dzialaja jako ten sam user,
// socket (chmod 600) nie potrzebuje dodatkowego tokenu ani grupy.
//
// Domyslna sciezka jest wzgledna (patrz index.js - /run wymagaloby
// roota), wiec musi sie zgadzac z domyslem w server/runtime-manager/
// index.js ORAZ z tym, ze oba procesy maja to samo WorkingDirectory
// (/opt/caddy-dashboard) - jesli jeden z tych zalozen kiedys przestanie
// byc prawdziwe, trzeba ustawic RUNTIME_SOCKET_PATH jawnie w .env.
const SOCKET_PATH = process.env.RUNTIME_SOCKET_PATH || 'caddy-dashboard-runtime.sock';

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        socketPath: SOCKET_PATH,
        path,
        method,
        headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let parsed;
          try {
            parsed = data ? JSON.parse(data) : {};
          } catch {
            reject(Object.assign(new Error('Nieprawidlowa odpowiedz Runtime Managera'), { status: 502 }));
            return;
          }
          if (res.statusCode >= 400) {
            reject(Object.assign(new Error(parsed.error || `Runtime Manager zwrocil blad ${res.statusCode}`), { status: res.statusCode }));
            return;
          }
          resolve(parsed);
        });
      }
    );

    req.on('error', (e) => {
      if (e.code === 'ENOENT' || e.code === 'ECONNREFUSED') {
        reject(Object.assign(
          new Error('Runtime Manager nie dziala (socket niedostepny) - sprawdz: systemctl status caddy-dashboard-runtime'),
          { status: 503 }
        ));
        return;
      }
      reject(Object.assign(new Error(e.message), { status: 500 }));
    });

    if (payload) req.write(payload);
    req.end();
  });
}

async function getAvailablePhp() {
  const { versions } = await request('GET', '/php/available');
  return versions;
}

async function getInstalledPhp() {
  const { installed } = await request('GET', '/php');
  return installed;
}

async function installPhp(id) {
  return request('POST', `/php/${encodeURIComponent(id)}/install`);
}

async function getPhpSettings(id) {
  return request('GET', `/php/${encodeURIComponent(id)}/settings`);
}

async function applyPhpSettings(id, { timezone, memoryLimitMb, uploadMaxMb, maxExecutionTime, maxInputTime, maxInputVars, maxFileUploads, exposePhp }) {
  return request('POST', `/php/${encodeURIComponent(id)}/settings`, {
    timezone, memoryLimitMb, uploadMaxMb, maxExecutionTime, maxInputTime, maxInputVars, maxFileUploads, exposePhp
  });
}

async function getPhpOpcache(id) {
  return request('GET', `/php/${encodeURIComponent(id)}/opcache`);
}

async function applyPhpOpcache(id, { memoryConsumptionMb, internedStringsBufferMb, maxAcceleratedFiles, revalidateFreqSec, validateTimestamps }) {
  return request('POST', `/php/${encodeURIComponent(id)}/opcache`, {
    memoryConsumptionMb, internedStringsBufferMb, maxAcceleratedFiles, revalidateFreqSec, validateTimestamps
  });
}

async function getPhpModules(id) {
  const { modules } = await request('GET', `/php/${encodeURIComponent(id)}/modules`);
  return modules;
}

async function togglePhpModule(id, moduleKey, action) {
  return request('POST', `/php/${encodeURIComponent(id)}/modules/${encodeURIComponent(moduleKey)}/${encodeURIComponent(action)}`);
}

async function getAvailableFrankenphp() {
  const { versions } = await request('GET', '/frankenphp/available');
  return versions;
}

async function getFrankenphpStatus() {
  return request('GET', '/frankenphp');
}

async function installFrankenphp(version) {
  return request('POST', `/frankenphp/${encodeURIComponent(version)}/install`);
}

async function getPhpmyadminStatus() {
  return request('GET', '/phpmyadmin');
}

async function installPhpmyadmin() {
  return request('POST', '/phpmyadmin/install');
}

async function uninstallPhpmyadmin() {
  return request('POST', '/phpmyadmin/uninstall');
}

async function getAdminerStatus() {
  return request('GET', '/adminer');
}

async function installAdminer() {
  return request('POST', '/adminer/install');
}

async function uninstallAdminer() {
  return request('POST', '/adminer/uninstall');
}

export {
  getAvailablePhp, getInstalledPhp, installPhp, getPhpSettings, applyPhpSettings,
  getPhpOpcache, applyPhpOpcache, getPhpModules, togglePhpModule,
  getAvailableFrankenphp, getFrankenphpStatus, installFrankenphp,
  getPhpmyadminStatus, installPhpmyadmin, uninstallPhpmyadmin,
  getAdminerStatus, installAdminer, uninstallAdminer
};
