import dns from 'dns';
import tls from 'tls';
import { promisify } from 'util';

const resolve4 = promisify(dns.resolve4);
const resolve6 = promisify(dns.resolve6);
const resolveMx = promisify(dns.resolveMx);
const resolveTxt = promisify(dns.resolveTxt);
const resolveNs = promisify(dns.resolveNs);
const resolveCname = promisify(dns.resolveCname);

const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

// Narzedzia (DNS/SSL checker) - w odroznieniu od reszty panelu usera
// (Poczta/Strony/Bazy...) CELOWO bez sprawdzania wlasnosci domeny -
// admin i pozostale sekcje pilnuja "czy TA domena nalezy do TEGO
// konta", ale sprawdzanie DNS/SSL dowolnej domeny (np. wlasnej, jeszcze
// PRZED dodaniem jej do panelu, zeby zobaczyc czy propagacja juz
// przeszla) jest z definicji operacja tylko-do-odczytu na PUBLICZNYCH
// danych (DNS/certyfikat serwowany publicznie) - taka sama jak
// dowolna zewnetrzna strona typu "dns checker".
function assertValidDomain(domainRaw) {
  const domain = String(domainRaw || '').trim().toLowerCase();
  if (!DOMAIN_RE.test(domain)) {
    throw Object.assign(new Error('Nieprawidlowa domena.'), { status: 400 });
  }
  return domain;
}

async function safeResolve(fn, domain) {
  try {
    return await fn(domain);
  } catch {
    return [];
  }
}

async function checkDns(domainRaw) {
  const domain = assertValidDomain(domainRaw);
  const [a, aaaa, mx, txt, ns, cname] = await Promise.all([
    safeResolve(resolve4, domain),
    safeResolve(resolve6, domain),
    safeResolve(resolveMx, domain),
    safeResolve(resolveTxt, domain),
    safeResolve(resolveNs, domain),
    safeResolve(resolveCname, domain)
  ]);
  return {
    domain,
    a,
    aaaa,
    cname,
    mx: mx.map((m) => `${m.exchange} (priorytet ${m.priority})`),
    txt: txt.map((t) => t.join('')),
    ns
  };
}

// tls.connect na porcie 443 WYLACZNIE (nie przyjmujemy portu od klienta) -
// to jedyny port, na ktorym publiczny SSL checker ma sens, i celowo
// zapobiega uzyciu tego endpointu jako furtki do skanowania innych
// portow/hostow z serwera panelu (SSRF-podobne ryzyko, gdyby port byl
// dowolny). Timeout 5s - zewnetrzny host moze nie odpowiadac wcale.
function checkSsl(domainRaw) {
  const domain = assertValidDomain(domainRaw);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const socket = tls.connect(443, domain, { servername: domain, timeout: 5000 }, () => {
      const cert = socket.getPeerCertificate();
      const authorized = socket.authorized;
      const authorizationError = socket.authorizationError;
      socket.end();
      if (!cert || !Object.keys(cert).length) {
        finish({ domain, ok: false, error: 'Serwer nie zwrocil certyfikatu.' });
        return;
      }
      const daysRemaining = Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86400000);
      finish({
        domain,
        ok: true,
        authorized,
        authorizationError: authorized ? null : String(authorizationError || ''),
        issuer: cert.issuer?.O || cert.issuer?.CN || null,
        subject: cert.subject?.CN || null,
        validFrom: cert.valid_from,
        validTo: cert.valid_to,
        daysRemaining
      });
    });
    socket.on('timeout', () => {
      socket.destroy();
      finish({ domain, ok: false, error: 'Przekroczono czas polaczenia (port 443 nie odpowiada).' });
    });
    socket.on('error', (e) => {
      finish({ domain, ok: false, error: e.message });
    });
  });
}

export { checkDns, checkSsl };
