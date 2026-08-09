import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import phpRoutes from './routes/php.js';
import frankenphpRoutes from './routes/frankenphp.js';

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
//
// Domyslna sciezka jest WZGLEDNA (nie /run/...) i celowo - /run jest
// zapisywalny tylko dla roota (0755, root:root), a ten proces dziala
// jako cdadmin. Wzgledna sciezka rozwiazuje sie wzgledem CWD, ktore
// zarowno systemd (WorkingDirectory=/opt/caddy-dashboard w
// caddy-dashboard-runtime.service), jak i reczne uruchomienie (`cd
// /opt/caddy-dashboard && node server/runtime-manager/index.js`) ustawia
// na katalog instalacji - a ten cdadmin juz posiada (install.sh robi
// `chown -R SVC_USER INSTALL_DIR`), wiec zadnych dodatkowych uprawnien
// nie trzeba.

const SOCKET_PATH = process.env.RUNTIME_SOCKET_PATH || 'caddy-dashboard-runtime.sock';

if (fs.existsSync(SOCKET_PATH)) {
  fs.unlinkSync(SOCKET_PATH);
}

const app = express();
app.use(express.json({ limit: '1mb' }));

app.use('/php', phpRoutes);
app.use('/frankenphp', frankenphpRoutes);

app.use((err, req, res, next) => {
  console.error('[BLAD]', err);
  res.status(err.status || 500).json({ error: err.message || 'Blad wewnetrzny' });
});

const server = app.listen(SOCKET_PATH, () => {
  fs.chmodSync(SOCKET_PATH, 0o600);
  console.log(`\nRuntime Manager dziala na sockecie ${SOCKET_PATH}`);
});

server.on('error', (e) => {
  console.error(`\n[BLAD] Nie udalo sie nasluchiwac na ${SOCKET_PATH}: ${e.message}\n`);
  process.exit(1);
});
