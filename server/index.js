import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.js';
import apiRoutes from './routes/api.js';
import { requireAuth, getAllowedUsers, isSameOrigin } from './services/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { version: APP_VERSION } = JSON.parse(readFileSync(path.join(__dirname, '../package.json'), 'utf-8'));

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
app.use('/api', authRequired ? requireAuth : (req, res, next) => next(), apiRoutes);

app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "object-src 'none'"
    ].join('; ')
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.use(express.static(path.join(__dirname, '../web')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../web/index.html'));
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
