import { Router } from 'express';
import { sign, verifyRaw } from '../services/auth.js';
import { getPublicConfig as getTurnstilePublicConfig, getSecretKey, verifyWithCloudflare } from '../services/turnstile.js';
import { isGateEnabled } from '../services/phpmyadminGate.js';

const router = Router();

const GATE_COOKIE = 'cd_pma_gate';
const GATE_TTL_MS = 24 * 60 * 60 * 1000;

// Bramka jest reachable BEZ sesji panelu (odwiedzajacy phpMyAdmin nigdy
// sie do panelu nie logowal) - stad ten router jest zamontowany POZA
// `/api` (ktory w server/index.js jest w calosci za requireAuth), patrz
// server/index.js. Zero uprawnien sudo/Runtime Managera tutaj - to tylko
// HTTP + podpisane ciasteczko, ten sam mechanizm co sesja panelu
// (server/services/auth.js sign()/verifyRaw()), ale WLASNE ciasteczko
// (nie cd_session) i BEZ sprawdzania allowlisty username - verifyRaw()
// (nie verify()) celowo pomija ta warstwe, bramka nie wie nic o kontach
// systemowych.

const attempts = new Map();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 5 * 60 * 1000;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

function challengePageHtml(siteKey) {
  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Weryfikacja</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; background:#0f1115; color:#e6e8eb; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
  .card { background:#171a21; border:1px solid #2a2f3a; border-radius:10px; padding:32px; max-width:360px; text-align:center; }
  h1 { font-size:16px; margin:0 0 8px; }
  p { color:#8b93a1; font-size:13px; margin:0 0 20px; }
  #err { color:#e5484d; font-size:13px; margin-top:12px; min-height:16px; }
</style>
</head>
<body>
  <div class="card">
    <h1>Weryfikacja bezpieczenstwa</h1>
    <p>Potwierdz, ze nie jestes botem, zeby przejsc dalej.</p>
    <div id="turnstile-container"></div>
    <div id="err"></div>
  </div>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  <script>
    window.__pmaGateCallback = async function(token) {
      var errEl = document.getElementById('err');
      errEl.textContent = 'Weryfikuje...';
      try {
        var res = await fetch('/pma-gate/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ token: token })
        });
        if (res.ok) {
          window.location.reload();
          return;
        }
        var data = await res.json().catch(function() { return {}; });
        errEl.textContent = data.error || 'Weryfikacja nie powiodla sie - sprobuj ponownie.';
      } catch (e) {
        errEl.textContent = 'Blad polaczenia - sprobuj ponownie.';
      }
    };
    (function poll() {
      if (window.turnstile) {
        window.turnstile.render('#turnstile-container', {
          sitekey: ${JSON.stringify(siteKey)},
          theme: 'auto',
          callback: window.__pmaGateCallback,
          'error-callback': function() {
            document.getElementById('err').textContent = 'Widget zwrocil blad - odswiez strone.';
          }
        });
      } else {
        setTimeout(poll, 100);
      }
    })();
  </script>
</body>
</html>`;
}

router.get('/check', (req, res) => {
  if (!isGateEnabled()) {
    res.status(204).end();
    return;
  }

  const token = req.cookies?.[GATE_COOKIE];
  const payload = token ? verifyRaw(token) : null;
  if (payload) {
    res.status(204).end();
    return;
  }

  const { siteKey, enabled: turnstileEnabled } = getTurnstilePublicConfig();
  if (!turnstileEnabled || !siteKey) {
    // Bramka wlaczona w panelu, ale Turnstile sam w sobie nie jest
    // skonfigurowany/wlaczony - blokujemy jawnym bledem zamiast pokazywac
    // pusty/zepsuty widget, admin musi to widziec jako "do naprawy", nie
    // "dziala".
    res.status(503).send('Bramka Turnstile jest wlaczona w panelu, ale Turnstile nie jest skonfigurowany - skonfiguruj go w panelu (Uslugi -> Caddy) albo wylacz bramke.');
    return;
  }

  // Nadpisuje globalna CSP (server/index.js) TYLKO dla tej odpowiedzi -
  // globalna CSP nie dopuszcza inline <script>, a ta samodzielna strona
  // (nie czesc SPA) potrzebuje malego inline-owego callbacku Turnstile;
  // ograniczone do tej jednej odpowiedzi, nie do calej aplikacji.
  res.set('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
    "style-src 'unsafe-inline'",
    "connect-src 'self' https://challenges.cloudflare.com",
    "frame-src https://challenges.cloudflare.com",
    "frame-ancestors 'none'",
    "base-uri 'none'"
  ].join('; '));
  res.status(401).set('Content-Type', 'text/html; charset=utf-8').send(challengePageHtml(siteKey));
});

router.post('/verify', async (req, res) => {
  if (!isGateEnabled()) {
    res.status(204).end();
    return;
  }

  if (isRateLimited(req.ip)) {
    res.status(429).json({ error: 'Zbyt wiele prob - sprobuj ponownie za kilka minut.' });
    return;
  }

  const { token } = req.body || {};
  if (!token) {
    res.status(400).json({ error: 'Brak tokenu Turnstile.' });
    return;
  }

  const secretKey = getSecretKey();
  if (!secretKey) {
    res.status(503).json({ error: 'Turnstile nie jest skonfigurowany.' });
    return;
  }

  const cfResult = await verifyWithCloudflare(secretKey, token, req.ip).catch(() => ({ success: false }));
  if (!cfResult.success) {
    res.status(401).json({ error: 'Weryfikacja Turnstile nie powiodla sie - sprobuj ponownie.' });
    return;
  }

  const cookieToken = sign({ exp: Date.now() + GATE_TTL_MS });
  const secure = (process.env.EXPOSURE || 'local') === 'world';
  res.cookie(GATE_COOKIE, cookieToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: GATE_TTL_MS,
    path: '/'
  });
  res.json({ success: true });
});

export default router;
