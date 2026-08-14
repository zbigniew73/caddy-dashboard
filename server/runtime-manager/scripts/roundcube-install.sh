#!/usr/bin/env bash
#
# Instaluje Roundcube (webmail) do /opt/webmail - SWIADOMIE odizolowane od
# /opt/caddy-dashboard (inny katalog niz phpMyAdmin/Adminer), zeby
# instalacja/deinstalacja Roundcube nigdy nie dotykala plikow panelu.
# Wlasny dedykowany pool PHP-FPM na PHP 8.4 (w odroznieniu od phpMyAdmin,
# ktory wymaga 8.3 - najnowszy Roundcube deklaruje wsparcie do 8.4
# WLACZNIE, wiec nie ma tu tego samego ograniczenia - niezweryfikowane na
# zywo, sprawdz przy pierwszej realnej instalacji).
#
# Silnik bazy danych jest WYBOREM ADMINA (nie zaszyty na sztywno) -
# pierwszy argument, "mysql" albo "sqlite":
#   mysql  - wymaga juz zainstalowanej MariaDB (root haslo w
#            /root/.mariadb, ten sam plik co kazda inna funkcja tego
#            projektu dotykajaca MariaDB). Tworzy dedykowana baze+usera
#            "roundcube" z wygenerowanym haslem (ten sam wzorzec co
#            hosting-db-mariadb.sh).
#   sqlite - zero zaleznosci od innych uslug, plik bazy w
#            /opt/webmail/db/roundcube.sqlite. Wymaga pakietu
#            php84-php-pdo-sqlite (doinstalowywanego tutaj) - DOKLADNA
#            nazwa pakietu w repozytorium Remi NIE byla weryfikowana na
#            zywo, jesli dnf install zwroci blad "brak pakietu", sprawdz
#            prawdziwa nazwe w Remi dla PHP 8.4 i popraw ta linie.
#
# Wersja Roundcube pobierana dynamicznie z GitHub Releases (najnowszy tag),
# NIE zaszyta na sztywno - identyczny powod co w phpmyadmin-install.sh.
# Nazwa archiwum (roundcubemail-<wersja>-complete.tar.gz) to stabilna,
# udokumentowana konwencja release'ow Roundcube od lat, ale tak samo jak
# powyzej: NIEZWERYFIKOWANE zywym pobraniem w tym srodowisku deweloperskim
# (offline) - pierwsza prawdziwa instalacja na VPS to faktyczny test.
#
# Nie jest to instalacja "w miejsce" - jesli DOCROOT juz istnieje, blad
# (jawnie, bez cichego nadpisywania), tak samo jak phpmyadmin-install.sh.

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

PHP_ID="84"
PHP_VERSION_LABEL="8.4"
DB_ENGINE="${1:-}"
DOCROOT="/opt/webmail"
WEBROOT="${DOCROOT}/public_html"
RUN_DIR="${DOCROOT}/run"
SOCKET_PATH="${RUN_DIR}/roundcube.sock"
POOL_FILE="/etc/opt/remi/php${PHP_ID}/php-fpm.d/roundcube.conf"
FPM_SERVICE="php${PHP_ID}-php-fpm"
GITHUB_API_URL="https://api.github.com/repos/roundcube/roundcubemail/releases/latest"
MARIADB_PWFILE="/root/.mariadb"

[ "$DB_ENGINE" = "mysql" ] || [ "$DB_ENGINE" = "sqlite" ] \
  || err "Nieprawidlowy silnik bazy danych: '${DB_ENGINE}' (oczekiwano mysql albo sqlite)."

rpm -q "php${PHP_ID}" >/dev/null 2>&1 \
  || err "PHP ${PHP_VERSION_LABEL} nie jest zainstalowany - zainstaluj go najpierw z kafelka PHP-FPM."

[ -e "$DOCROOT" ] && err "${DOCROOT} juz istnieje - Roundcube wyglada na juz zainstalowany (albo katalog zajety przez cos innego). Usun najpierw przez przycisk 'Usun' w panelu, jesli to nieudana poprzednia instalacja."

if [ "$DB_ENGINE" = "mysql" ]; then
  command -v mariadb >/dev/null 2>&1 || err "Wybrano MySQL/MariaDB, ale polecenie 'mariadb' nie jest dostepne - zainstaluj MariaDB najpierw z kafelka MariaDB."
  [ -f "$MARIADB_PWFILE" ] || err "Wybrano MySQL/MariaDB, ale brak ${MARIADB_PWFILE} - haslo root MariaDB nieznane (MariaDB nie zostala zainstalowana przez ten panel?)."
fi

command -v curl >/dev/null 2>&1 || err "Brak polecenia curl."
command -v tar >/dev/null 2>&1 || err "Brak polecenia tar."
command -v openssl >/dev/null 2>&1 || err "Brak polecenia openssl (potrzebne do wygenerowania des_key)."

RELEASE_JSON="$(curl -fsSL --max-time 20 "$GITHUB_API_URL")" \
  || err "Nie udalo sie pobrac ${GITHUB_API_URL} (sprawdz polaczenie wychodzace serwera)."
RC_VERSION="$(printf '%s' "$RELEASE_JSON" | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')"
[[ "$RC_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || err "Nie udalo sie odczytac numeru wersji z ${GITHUB_API_URL} (odpowiedz: ${RELEASE_JSON:0:200})."

TARBALL_URL="https://github.com/roundcube/roundcubemail/releases/download/${RC_VERSION}/roundcubemail-${RC_VERSION}-complete.tar.gz"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

curl -fsSL --max-time 180 -o "${TMPDIR}/roundcube.tar.gz" "$TARBALL_URL" \
  || err "Pobranie ${TARBALL_URL} nie powiodlo sie."

tar -xzf "${TMPDIR}/roundcube.tar.gz" -C "$TMPDIR" \
  || err "Rozpakowanie archiwum Roundcube nie powiodlo sie."

EXTRACTED_DIR="$(find "$TMPDIR" -mindepth 1 -maxdepth 1 -type d -name 'roundcubemail-*')"
[ -n "$EXTRACTED_DIR" ] && [ -d "$EXTRACTED_DIR" ] \
  || err "Nie znaleziono rozpakowanego katalogu roundcubemail-* w archiwum."

mv "$EXTRACTED_DIR" "$DOCROOT" || err "Przeniesienie plikow Roundcube do ${DOCROOT} nie powiodlo sie."
echo "$RC_VERSION" > "${DOCROOT}/.cddash-version"
echo "$DB_ENGINE" > "${DOCROOT}/.cddash-db-engine"

[ -d "$WEBROOT" ] || err "Rozpakowane archiwum nie ma katalogu public_html - nieoczekiwany uklad wydania ${RC_VERSION}."

OWNER="$(stat -c '%U:%G' /opt/caddy-dashboard)"

mkdir -p "${DOCROOT}/logs" "${DOCROOT}/temp"

# --- Baza danych ---
DB_DSNW=""
if [ "$DB_ENGINE" = "mysql" ]; then
  source "$(dirname "${BASH_SOURCE[0]}")/../../scripts/lib-gen-password.sh"
  ROOT_PASS="$(cat "$MARIADB_PWFILE")"
  DB_PASS="$(gen_password)"
  mariadb -u root -p"${ROOT_PASS}" <<SQL || err "Utworzenie bazy 'roundcube' nie powiodlo sie."
CREATE DATABASE IF NOT EXISTS \`roundcube\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
CREATE USER IF NOT EXISTS 'roundcube'@'localhost' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON \`roundcube\`.* TO 'roundcube'@'localhost';
FLUSH PRIVILEGES;
SQL
  DB_DSNW="mysql://roundcube:${DB_PASS}@localhost/roundcube"
else
  dnf install -y "php${PHP_ID}-php-pdo-sqlite" \
    || err "Instalacja php${PHP_ID}-php-pdo-sqlite nie powiodla sie - sprawdz prawdziwa nazwe pakietu sqlite dla PHP ${PHP_VERSION_LABEL} w repozytorium Remi i popraw ta linie w roundcube-install.sh."
  mkdir -p "${DOCROOT}/db"
  : > "${DOCROOT}/db/roundcube.sqlite"
  DB_DSNW="sqlite:////opt/webmail/db/roundcube.sqlite"
fi

# --- Config ---
# des_key musi miec DOKLADNIE 24 znaki (szyfrowanie hasla IMAP w
# sesji/ciasteczku, domyslny szyfr 3DES) - ten sam wymog dlugosci co
# blowfish_secret phpMyAdmin (tam 32), ale INNA liczba znakow, bo to inny
# mechanizm/szyfr. 18 surowych bajtow -> base64 bez paddingu daje 24 znaki.
DES_KEY="$(openssl rand -base64 18 | tr -d '\n')"

# TLS do Postfixa/Dovecota na 'localhost' z WYLACZONA weryfikacja
# certyfikatu - Faza 1 (patrz mail-install.sh) uzywa certyfikatu
# tymczasowego self-signed, wiec strict verify na 'localhost' i tak by nie
# pasowal do CN certyfikatu. Podmiana na prawdziwy cert (mail.<domena>,
# patrz roundcube-caddy-config.sh) to OSOBNY, PRZYSZLY krok - wtedy warto
# tu wlaczyc verify_peer z powrotem.
cat > "${DOCROOT}/config/config.inc.php" <<PHPCONF
<?php
declare(strict_types=1);

\$config = [];
\$config['db_dsnw'] = '${DB_DSNW}';
\$config['default_host'] = 'ssl://localhost';
\$config['default_port'] = 993;
\$config['smtp_server'] = 'ssl://localhost';
\$config['smtp_port'] = 465;
\$config['smtp_user'] = '%u';
\$config['smtp_pass'] = '%p';
\$config['imap_conn_options'] = [
    'ssl' => ['verify_peer' => false, 'verify_peer_name' => false, 'allow_self_signed' => true],
];
\$config['smtp_conn_options'] = [
    'ssl' => ['verify_peer' => false, 'verify_peer_name' => false, 'allow_self_signed' => true],
];
\$config['des_key'] = '${DES_KEY}';
\$config['product_name'] = 'Webmail';
\$config['plugins'] = ['archive'];
\$config['temp_dir'] = '${DOCROOT}/temp';
\$config['log_dir'] = '${DOCROOT}/logs';
\$config['session_lifetime'] = 30;
PHPCONF
chmod 640 "${DOCROOT}/config/config.inc.php"

PHP_CLI="/usr/local/bin/php${PHP_ID}"
[ -x "$PHP_CLI" ] || err "Nie znaleziono wrappera CLI ${PHP_CLI} - PHP ${PHP_VERSION_LABEL} nie wyglada na poprawnie zainstalowany."

(cd "$DOCROOT" && "$PHP_CLI" bin/initdb.sh --dir=SQL) \
  || err "Inicjalizacja schematu bazy Roundcube (bin/initdb.sh) nie powiodla sie."

chown -R "$OWNER" "$DOCROOT"
chmod 640 "${DOCROOT}/config/config.inc.php"
[ "$DB_ENGINE" = "sqlite" ] && chmod 660 "${DOCROOT}/db/roundcube.sqlite"

mkdir -p "$RUN_DIR"
chown "$OWNER" "$RUN_DIR"

[ -d "$(dirname "$POOL_FILE")" ] \
  || err "Katalog $(dirname "$POOL_FILE") nie istnieje - php${PHP_ID}-php-fpm nie wyglada na poprawnie zainstalowany mimo ze rpm -q php${PHP_ID} przeszlo."

# Grupa Caddy, ta sama uwaga co phpmyadmin-install.sh - socket musi byc
# czytelny dla usera pod ktorym dziala Caddy (laczy sie jako klient
# reverse proxy), nie tylko dla OWNER.
CADDY_GROUP="$(id -gn caddy 2>/dev/null)"
[ -n "$CADDY_GROUP" ] || err "Nie udalo sie ustalic grupy systemowej usera 'caddy' (id -gn caddy) - czy Caddy jest zainstalowany?"

POOL_FILE_BACKUP=""
if [ -f "$POOL_FILE" ]; then
  POOL_FILE_BACKUP="${POOL_FILE}.bak-$(date +%Y%m%d%H%M%S)"
  cp -p "$POOL_FILE" "$POOL_FILE_BACKUP"
fi

cat > "$POOL_FILE" <<POOLCONF || err "Zapisanie ${POOL_FILE} nie powiodlo sie."
[roundcube]
user = ${OWNER%%:*}
group = ${OWNER##*:}
listen = ${SOCKET_PATH}
listen.owner = ${OWNER%%:*}
listen.group = ${CADDY_GROUP}
listen.mode = 0660
pm = ondemand
pm.max_children = 5
pm.process_idle_timeout = 30s
php_admin_value[open_basedir] = ${DOCROOT}:/tmp
php_admin_value[upload_tmp_dir] = /tmp
php_admin_value[session.save_path] = /tmp
POOLCONF
[ -s "$POOL_FILE" ] || err "Zapisanie ${POOL_FILE} nie powiodlo sie (plik pusty lub brak)."

rollback_pool_file() {
  if [ -n "$POOL_FILE_BACKUP" ]; then
    cp -p "$POOL_FILE_BACKUP" "$POOL_FILE"
  else
    rm -f "$POOL_FILE"
  fi
  systemctl reload "$FPM_SERVICE" >/dev/null 2>&1 || true
}

if ! systemctl reload "$FPM_SERVICE" 2>/tmp/roundcube-install.err; then
  ERR_MSG="$(cat /tmp/roundcube-install.err 2>/dev/null)"
  rm -f /tmp/roundcube-install.err
  rollback_pool_file
  err "Przeladowanie ${FPM_SERVICE} z nowym poolem roundcube nie powiodlo sie: ${ERR_MSG} - przywrocono poprzedni stan poola (pliki Roundcube w ${DOCROOT} pozostaly, ale pool nie dziala)."
fi
rm -f /tmp/roundcube-install.err

LIVE=""
for _ in 1 2 3 4 5; do
  if systemctl is-active --quiet "$FPM_SERVICE"; then
    LIVE=1
    break
  fi
  sleep 1
done
if [ -z "$LIVE" ]; then
  rollback_pool_file
  err "${FPM_SERVICE} nie dziala poprawnie po dodaniu poola roundcube - przywrocono poprzedni stan."
fi

echo "OK: Roundcube ${RC_VERSION} zainstalowany w ${DOCROOT} (baza: ${DB_ENGINE}), pool PHP-FPM na ${SOCKET_PATH} (${FPM_SERVICE})."
