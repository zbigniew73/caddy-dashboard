import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.js';
import apiRoutes from './routes/api.js';
import userApiRoutes from './routes/userApi.js';
import pmaGateRoutes from './routes/pmaGate.js';
import admGateRoutes from './routes/admGate.js';
import rcGateRoutes from './routes/rcGate.js';
import { requireAuth, requireUserAuth, getAllowedUsers, isSameOrigin } from './services/auth.js';
import { APP_VERSION } from './version.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOST = process.env.HOST || '127.0.0.1';
const PORT = parseInt(process.env.PORT || '4300', 10);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN;
const EXPOSURE = process.env.EXPOSURE || 'local';

const isLoopbackHost = HOST === '127.0.0.1' || HOST === 'localhost';

if (!['local', 'lan', 'world'].includes(EXPOSURE)) {
  console.error(`\n[BLAD] EXPOSURE musi byc "local", "lan" albo "world" (jest: "${EXPOSURE}")\n`);
  process.exit(1);
}

if (EXPOSURE === 'local' && !isLoopbackHost) {
  console.error(
    `\n[BLAD] EXPOSURE=local wymaga HOST=127.0.0.1 (jest: "${HOST}").\n` +
    'Jesli chcesz dostep z sieci lokalnej, ustaw EXPOSURE=lan.\n'
  );
  process.exit(1);
}

if (EXPOSURE === 'lan' && isLoopbackHost) {
  console.error(
    '\n[BLAD] EXPOSURE=lan wymaga realnego adresu w Twojej sieci lokalnej jako HOST\n' +
    '(np. 192.168.1.100), nie 127.0.0.1. Sprawdz: `ip addr` / `hostname -I`.\n'
  );
  process.exit(1);
}

if (EXPOSURE === 'world' && !isLoopbackHost) {
  console.error(
    '\n[BLAD] EXPOSURE=world wymaga HOST=127.0.0.1 - node ma nasluchiwac WYLACZNIE\n' +
    'lokalnie, a ruch z internetu ma przychodzic przez Caddy (reverse proxy + TLS).\n' +
    'Nigdy nie wystawiaj node\'a bezposrednio pod publiczny adres.\n'
  );
  process.exit(1);
}

const allowedUsers = getAllowedUsers();

const authRequired = EXPOSURE !== 'local' || allowedUsers.length > 0;

if (authRequired) {
  if (allowedUsers.length === 0) {
    console.error(
      `\n[BLAD] EXPOSURE=${EXPOSURE} wymaga ustawienia AUTH_USERS w .env (lista kont systemowych\n` +
      'oddzielonych przecinkiem, np. AUTH_USERS=zibi,drugi_user).\n' +
      'Bez tego kazdy kto trafi na ten adres/domene mialby pelny dostep bez logowania.\n'
    );
    process.exit(1);
  }
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    console.error('\n[BLAD] SESSION_SECRET nie jest ustawiony lub jest za krotki (min. 32 znaki).');
    console.error('Wygeneruj: openssl rand -hex 32\n');
    process.exit(1);
  }
}

const app = express();
app.disable('x-powered-by');

app.use(
  cors({
    origin: ALLOWED_ORIGIN || false,
    credentials: true
  })
);

if (EXPOSURE === 'world') {
  app.set('trust proxy', 1);
}

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (!isSameOrigin(req)) {
    return res.status(403).json({ error: 'Zadanie z obcego originu zostalo odrzucone' });
  }
  next();
});

app.use('/api/auth', authRoutes);
// Musi byc PRZED '/api' ponizej (Express dopasowuje middleware po
// kolejnosci rejestracji, nie po dlugosci prefiksu) - inaczej
// /api/user/* zostaloby przechwycone przez requireAuth (sesja admina) i
// nigdy nie doszloby do requireUserAuth.
app.use('/api/user', authRequired ? requireUserAuth : (req, res, next) => next(), userApiRoutes);
app.use('/api', authRequired ? requireAuth : (req, res, next) => next(), apiRoutes);

// JEDYNE miejsce ustawiajace naglowki bezpieczenstwa panelu - CELOWO.
// template/caddy/reverse-proxy.Caddyfile (szablon do wystawienia panelu
// przez Caddy) NIE dubluje ich - kiedys dublowal (X-Frame-Options,
// Referrer-Policy, X-Content-Type-Options ustawiane NIEZALEZNIE i po
// Caddy stronie, i po Express stronie, z roznymi wartosciami - Caddy
// dokladal swoje na wierzch tego co juz wyslal Express, klient widzial
// dwie wartosci tego samego naglowka naraz). Trzymanie tego wylacznie tu
// dziala tak samo bez wzgledu na to, czy/jak admin skonfigurowal reverse
// proxy (dziala tez przy bezposrednim dostepie do samego Node, np.
// EXPOSURE=local). Jesli dodajesz/zmieniasz naglowek bezpieczenstwa -
// TYLKO tutaj, nigdy w szablonie Caddy.
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self' https://challenges.cloudflare.com",
      "frame-src https://challenges.cloudflare.com",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "object-src 'none'"
    ].join('; ')
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // Panel nie korzysta z zadnego z tych API - odmawiamy wszystkim, nie
  // tylko obcym originom ("()" = nikomu, wlacznie z 'self').
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  // Bez efektu na zwyklym HTTP (przegladarki ignoruja HSTS spoza HTTPS),
  // wiec bezpieczne do wysylania zawsze, tez w EXPOSURE=local/lan.
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  // same-origin-allow-popups (nie 'same-origin') - zeby popup Cloudflare
  // Turnstile (challenges.cloudflare.com) mial dzialajace window.opener.
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  // 'unsafe-none' to wartosc DOMYSLNA (brak wymuszenia) - jawnie
  // wypisana dla czytelnosci/audytu, nie zmienia faktycznego zachowania.
  res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
  next();
});

// Bez sesji panelu (odwiedzajacy phpMyAdmin nigdy sie do panelu nie
// logowal) - celowo POZA /api (ktory jest w calosci za requireAuth
// powyzej), patrz server/routes/pmaGate.js.
app.use('/pma-gate', pmaGateRoutes);
app.use('/adm-gate', admGateRoutes);
app.use('/rc-gate', rcGateRoutes);

// Cache-Control: no-cache (NIE "no-store") - przegladarka nadal moze
// trzymac plik lokalnie, ale MUSI za kazdym razem zweryfikowac go z
// serwerem (ETag/If-None-Match) przed uzyciem, zamiast ufac wlasnej
// heurystyce swiezosci. Bez tego (domyslne express.static) niektore
// przegladarki potrafily serwowac STARA wersje web/app.js/web/user/app.js
// z lokalnego cache'u nawet po `git pull` + restarcie uslugi na serwerze -
// user zglosil realny przypadek 2026-08-16 (nowe przyciski "Kopiuj" w
// panelu usera niewidoczne mimo poprawnego kodu, zweryfikowanego lokalna
// symulacja renderowania).
app.use(express.static(path.join(__dirname, '../web'), {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache');
  }
}));
// Te dwa route'y NIE ida przez express.static wyzej (to sa SPA fallbacki,
// `res.sendFile` bezposrednio) - bez wlasnego Cache-Control dostawaly
// domyslne zachowanie `send` (brak jawnego max-age, ale tez brak "no-cache",
// wiec przegladarka mogla zastosowac wlasna heurystyke swiezosci i
// serwowac STARY index.html - a wtedy nawet wersjonowane query stringi
// przy <script src="app.js?v=..."> WEWNATRZ tego pliku nigdy by sie nie
// zmienily w oczach przegladarki, bo sam plik HTML nigdy by nie zostal
// ponownie pobrany). Ten sam powod co Cache-Control przy express.static
// wyzej - potwierdzone na zywym serwerze 2026-08-16, powtarzajacy sie
// problem z niewidocznymi zmianami po deployu.
const NO_CACHE_HEADERS = { headers: { 'Cache-Control': 'no-cache' } };
// SPA fallback dla panelu klienta (/user/*) - MUSI byc przed catch-allem
// panelu admina ponizej, inaczej kazda podstrona /user/... (np. po
// odswiezeniu) dostalaby index.html admina zamiast web/user/index.html.
app.get(['/user', '/user/*'], (req, res) => {
  res.sendFile(path.join(__dirname, '../web/user/index.html'), NO_CACHE_HEADERS);
});
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../web/index.html'), NO_CACHE_HEADERS);
});

app.listen(PORT, HOST, () => {
  const modeLabel = { local: 'LOCAL (tylko ta maszyna)', lan: 'LAN (Twoja siec lokalna)', world: 'WORLD (za Caddy, z internetu)' }[EXPOSURE];
  console.log(`\nCaddy Dashboard v${APP_VERSION} dziala na http://${HOST}:${PORT}`);
  console.log(`Tryb: ${modeLabel}`);
  console.log(
    authRequired
      ? `Autoryzacja: WLACZONA (konta systemowe: ${allowedUsers.join(', ')})`
      : 'Autoryzacja: WYLACZONA (dostep tylko z tej maszyny)'
  );
  if (EXPOSURE === 'world') {
    console.log('Upewnij sie, ze Caddy proxyuje do tego adresu i port nie jest otwarty bezposrednio na firewallu.');
  }
  console.log('');
});
