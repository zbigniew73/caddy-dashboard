import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import phpRoutes from './routes/php.js';
import { secureSocket } from './socketPermissions.js';

// Ten proces to Runtime Manager - osobny daemon dzialajacy jako root,
// NIEZALEZNY od glownego panelu (server/index.js, dziala jako cdadmin).
// Panel laczy sie z nim po unix sockecie (nie TCP - tak samo jak PHP-FPM/
// FrankenPHP w docelowej architekturze), a socket jest zawezony do grupy
// cdadmin (patrz socketPermissions.js). Dzieki temu panel WWW nie
// potrzebuje bezposrednich uprawnien root do dnf/systemctl/systemowych
// katalogow dla funkcji PHP - ten proces juz jest rootem, wiec zaden
// sudo/sudoers wewnatrz niego nie jest potrzebny (patrz komentarz w
// server/scripts/write-sudoers.sh).

const SOCKET_PATH = process.env.RUNTIME_SOCKET_PATH || '/run/caddy-dashboard-runtime.sock';
const SOCKET_GROUP = process.env.RUNTIME_SOCKET_GROUP || 'cdadmin';

if (fs.existsSync(SOCKET_PATH)) {
  fs.unlinkSync(SOCKET_PATH);
}

const app = express();
app.use(express.json({ limit: '1mb' }));

app.use('/php', phpRoutes);

app.use((err, req, res, next) => {
  console.error('[BLAD]', err);
  res.status(err.status || 500).json({ error: err.message || 'Blad wewnetrzny' });
});

app.listen(SOCKET_PATH, () => {
  try {
    secureSocket(SOCKET_PATH, SOCKET_GROUP);
  } catch (e) {
    console.error(`\n[BLAD] ${e.message}\n`);
    process.exit(1);
  }
  console.log(`\nRuntime Manager dziala na sockecie ${SOCKET_PATH} (grupa: ${SOCKET_GROUP})`);
});
