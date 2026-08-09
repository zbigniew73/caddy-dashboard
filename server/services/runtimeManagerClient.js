import http from 'http';

// Klient panelu (dziala jako cdadmin) do Runtime Managera (osobny daemon,
// dziala jako root, server/runtime-manager/) - komunikacja wylacznie po
// unix sockecie, nigdy po sieci. Socket jest zawezony do grupy cdadmin
// przez sam daemon (patrz server/runtime-manager/socketPermissions.js),
// wiec brak dodatkowego tokenu tutaj jest celowy, nie przeoczeniem.
const SOCKET_PATH = process.env.RUNTIME_SOCKET_PATH || '/run/caddy-dashboard-runtime.sock';

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

export { getAvailablePhp, getInstalledPhp, installPhp };
