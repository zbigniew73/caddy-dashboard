#!/usr/bin/env bash
#
# Instaluje phpMyAdmin (paczka -english, tylko jezyk angielski - swiadomy
# wybor usera, "aby nie ryzykowac" niekompletnych tlumaczen jako zrodla
# bledow UI) do /opt/caddy-dashboard/phpmyadmin, z dedykowanym poolem
# PHP-FPM na sockecie /opt/caddy-dashboard/run/phpmyadmin.sock.
#
# Wymaga PHP 8.3 (nie 8.4!) - zweryfikowane na zywo (2026-08-09) z
# https://www.phpmyadmin.net/home_page/version.json: najnowszy phpMyAdmin
# (5.2.3) deklaruje "php_versions": ">=7.2,<8.4" - PHP 8.4 NIE jest
# wspierane. PHP 8.4 zostaje nietkniete dla innych site'ow.
#
# Wersja pobierana dynamicznie z version.json, nie zaszyta na sztywno -
# zeby nie stawac sie nieaktualna. URL pobierania zweryfikowany na zywo
# (2026-08-09): https://files.phpmyadmin.net/phpMyAdmin/{wersja}/
# phpMyAdmin-{wersja}-english.tar.gz
#
# Nie jest to instalacja "w miejsce" - jesli DOCROOT juz istnieje, blad
# (jawnie, bez cichego nadpisywania) - upgrade-in-place poza zakresem
# tego etapu.
#
# Auth w config.inc.php: tryb "cookie" - admin loguje sie wlasnymi,
# prawdziwymi danymi do MariaDB/MySQL przez formularz logowania
# phpMyAdmin, zadne dane dostepowe do bazy NIE sa zaszyte w tym pliku.

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

PHP_ID="83"
PHP_VERSION_LABEL="8.3"
DOCROOT="/opt/caddy-dashboard/phpmyadmin"
RUN_DIR="/opt/caddy-dashboard/run"
SOCKET_PATH="${RUN_DIR}/phpmyadmin.sock"
POOL_FILE="/etc/opt/remi/php${PHP_ID}/php-fpm.d/phpmyadmin.conf"
FPM_SERVICE="php${PHP_ID}-php-fpm"
VERSION_JSON_URL="https://www.phpmyadmin.net/home_page/version.json"

rpm -q "php${PHP_ID}" >/dev/null 2>&1 \
  || err "PHP ${PHP_VERSION_LABEL} nie jest zainstalowany - zainstaluj go najpierw z kafelka PHP-FPM (Runtime Manager wymaga php${PHP_ID}-php-fpm dla dedykowanego poola phpMyAdmin)."

[ -e "$DOCROOT" ] && err "${DOCROOT} juz istnieje - phpMyAdmin wyglada na juz zainstalowany (albo katalog zajety przez cos innego). Usun najpierw przez przycisk 'Usun' w panelu, jesli to nieudana poprzednia instalacja."

command -v curl >/dev/null 2>&1 || err "Brak polecenia curl."
command -v tar >/dev/null 2>&1 || err "Brak polecenia tar."
command -v openssl >/dev/null 2>&1 || err "Brak polecenia openssl (potrzebne do wygenerowania blowfish_secret)."

VERSION_JSON="$(curl -fsSL --max-time 20 "$VERSION_JSON_URL")" \
  || err "Nie udalo sie pobrac ${VERSION_JSON_URL} (sprawdz polaczenie wychodzace serwera)."
PMA_VERSION="$(printf '%s' "$VERSION_JSON" | grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')"
[[ "$PMA_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || err "Nie udalo sie odczytac numeru wersji z ${VERSION_JSON_URL} (odpowiedz: ${VERSION_JSON:0:200})."

TARBALL_URL="https://files.phpmyadmin.net/phpMyAdmin/${PMA_VERSION}/phpMyAdmin-${PMA_VERSION}-english.tar.gz"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

curl -fsSL --max-time 120 -o "${TMPDIR}/phpmyadmin.tar.gz" "$TARBALL_URL" \
  || err "Pobranie ${TARBALL_URL} nie powiodlo sie."

tar -xzf "${TMPDIR}/phpmyadmin.tar.gz" -C "$TMPDIR" \
  || err "Rozpakowanie archiwum phpMyAdmin nie powiodlo sie."

EXTRACTED_DIR="$(find "$TMPDIR" -mindepth 1 -maxdepth 1 -type d -name 'phpMyAdmin-*')"
[ -n "$EXTRACTED_DIR" ] && [ -d "$EXTRACTED_DIR" ] \
  || err "Nie znaleziono rozpakowanego katalogu phpMyAdmin-* w archiwum."

mv "$EXTRACTED_DIR" "$DOCROOT" || err "Przeniesienie plikow phpMyAdmin do ${DOCROOT} nie powiodlo sie."
echo "$PMA_VERSION" > "${DOCROOT}/.cddash-version"

OWNER="$(stat -c '%U:%G' /opt/caddy-dashboard)"

BLOWFISH_SECRET="$(openssl rand -base64 32 | tr -d '\n')"
cat > "${DOCROOT}/config.inc.php" <<PHPCONF
<?php
declare(strict_types=1);

\$cfg['blowfish_secret'] = '${BLOWFISH_SECRET}';

\$i = 0;
\$i++;
\$cfg['Servers'][\$i]['auth_type'] = 'cookie';
\$cfg['Servers'][\$i]['host'] = 'localhost';
\$cfg['Servers'][\$i]['compress'] = false;
\$cfg['Servers'][\$i]['AllowNoPassword'] = false;

\$cfg['UploadDir'] = '';
\$cfg['SaveDir'] = '';
PHPCONF
chmod 640 "${DOCROOT}/config.inc.php"
chown -R "$OWNER" "$DOCROOT"

mkdir -p "$RUN_DIR"
chown "$OWNER" "$RUN_DIR"

[ -d "$(dirname "$POOL_FILE")" ] \
  || err "Katalog $(dirname "$POOL_FILE") nie istnieje - php${PHP_ID}-php-fpm nie wyglada na poprawnie zainstalowany mimo ze rpm -q php${PHP_ID} przeszlo."

POOL_FILE_BACKUP=""
if [ -f "$POOL_FILE" ]; then
  POOL_FILE_BACKUP="${POOL_FILE}.bak-$(date +%Y%m%d%H%M%S)"
  cp -p "$POOL_FILE" "$POOL_FILE_BACKUP"
fi

cat > "$POOL_FILE" <<POOLCONF || err "Zapisanie ${POOL_FILE} nie powiodlo sie."
[phpmyadmin]
user = ${OWNER%%:*}
group = ${OWNER##*:}
listen = ${SOCKET_PATH}
listen.owner = ${OWNER%%:*}
listen.group = ${OWNER##*:}
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

if ! systemctl reload "$FPM_SERVICE" 2>/tmp/phpmyadmin-install.err; then
  ERR_MSG="$(cat /tmp/phpmyadmin-install.err 2>/dev/null)"
  rm -f /tmp/phpmyadmin-install.err
  rollback_pool_file
  err "Przeladowanie ${FPM_SERVICE} z nowym poolem phpmyadmin nie powiodlo sie: ${ERR_MSG} - przywrocono poprzedni stan poola (pliki phpMyAdmin w ${DOCROOT} pozostaly, ale pool nie dziala)."
fi
rm -f /tmp/phpmyadmin-install.err

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
  err "${FPM_SERVICE} nie dziala poprawnie po dodaniu poola phpmyadmin - przywrocono poprzedni stan."
fi

echo "OK: phpMyAdmin ${PMA_VERSION} zainstalowany w ${DOCROOT}, pool PHP-FPM na ${SOCKET_PATH} (${FPM_SERVICE})."
