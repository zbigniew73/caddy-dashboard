import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import phpRoutes from './routes/php.js';

// Ten proces to Runtime Manager - osobna usluga systemd
// (caddy-dashboard-runtime.service) obok glownego panelu
// (caddy-dashboard.service), dzialajaca jako TEN SAM SVC_USER (cdadmin) -
// nie root. Osobny proces = awaria/bug w logice instalacji PHP nie
// przewraca panelu WWW (i odwrotnie), a systemd moze restartowac je
// niezaleznie. Uprzywilejowane operacje (dnf/systemctl/pisanie do
// /usr/local/bin) ida przez `sudo -n <skrypt>`, dokladnie tak samo jak
// dla MariaDB/PostgreSQL/Redis w server/services/ - patrz
// server/scripts/write-sudoers.sh (Cmnd_Alias CDDASH_PHP_*).
//
// Panel laczy sie z tym procesem po unix sockecie (nie TCP), zawezonym
// do samego wlasciciela (chmod 600) - skoro oba procesy dzialaja jako
// ten sam user, socket nie potrzebuje osobnej grupy/wlasciciela.

const SOCKET_PATH = process.env.RUNTIME_SOCKET_PATH || '/run/caddy-dashboard-runtime.sock';

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
  fs.chmodSync(SOCKET_PATH, 0o600);
  console.log(`\nRuntime Manager dziala na sockecie ${SOCKET_PATH}`);
});
