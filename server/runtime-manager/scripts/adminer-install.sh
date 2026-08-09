#!/usr/bin/env bash
#
# Instaluje Adminer (jeden plik PHP, wersja tylko angielska) do
# /opt/caddy-dashboard/adminer, z dedykowanym poolem PHP-FPM na sockecie
# /opt/caddy-dashboard/run/adminer.sock. Pozycjonowany jako odpowiednik
# phpMyAdmin dla PostgreSQL (user swiadomie odrzucil phpPgAdmin -
# rozwoj stanal w 2020 na PHP 7.2, brak realnej sciezki na PHP 8.3/8.4).
#
# W przeciwienstwie do phpMyAdmin: Adminer to JEDEN plik PHP, zero
# rozpakowywania archiwum, zero config.inc.php - logowanie dzieje sie
# wprost do bazy przez wlasny formularz Adminera (zadne dane dostepowe
# nie sa zaszyte w tym pliku). Stala url
# "https://www.adminer.org/latest-en.php" zawsze przekierowuje na
# najnowsze wydanie (zweryfikowane na zywo 2026-08-09: 302 ->
# static/download/{wersja}/adminer-{wersja}-en.php), wiec nie trzeba
# osobnego API do wykrywania wersji jak przy phpMyAdmin.
#
# Wymaga PHP 8.3 - wybor bez twardego wymogu kompatybilnosci (Adminer
# deklaruje szerokie wsparcie PHP 5.3+/7/8 bez wykluczen), ale dla
# spojnosci z juz dzialajacym poolem phpMyAdmin (ten sam wzorzec,
# ten sam poziom zaufania).

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

PHP_ID="83"
PHP_VERSION_LABEL="8.3"
DOCROOT="/opt/caddy-dashboard/adminer"
RUN_DIR="/opt/caddy-dashboard/run"
SOCKET_PATH="${RUN_DIR}/adminer.sock"
POOL_FILE="/etc/opt/remi/php${PHP_ID}/php-fpm.d/adminer.conf"
FPM_SERVICE="php${PHP_ID}-php-fpm"
LATEST_URL="https://www.adminer.org/latest-en.php"

rpm -q "php${PHP_ID}" >/dev/null 2>&1 \
  || err "PHP ${PHP_VERSION_LABEL} nie jest zainstalowany - zainstaluj go najpierw z kafelka PHP-FPM (Runtime Manager wymaga php${PHP_ID}-php-fpm dla dedykowanego poola Adminera)."

[ -e "$DOCROOT" ] && err "${DOCROOT} juz istnieje - Adminer wyglada na juz zainstalowany (albo katalog zajety przez cos innego). Usun najpierw przez przycisk 'Usun' w panelu, jesli to nieudana poprzednia instalacja."

command -v curl >/dev/null 2>&1 || err "Brak polecenia curl."

REDIRECT_LOCATION="$(curl -sI --max-time 20 "$LATEST_URL" | grep -i '^location:' | head -n1 | sed -E 's/^[Ll]ocation:[[:space:]]*//' | tr -d '\r\n')"
ADMINER_VERSION="$(printf '%s' "$REDIRECT_LOCATION" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)"
[[ "$ADMINER_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || err "Nie udalo sie odczytac numeru wersji z przekierowania ${LATEST_URL} (Location: '${REDIRECT_LOCATION}')."

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

curl -fsSL --max-time 60 -o "${TMPDIR}/index.php" "$LATEST_URL" \
  || err "Pobranie ${LATEST_URL} nie powiodlo sie."

[ -s "${TMPDIR}/index.php" ] || err "Pobrany plik Adminera jest pusty."
head -c 5 "${TMPDIR}/index.php" | grep -q '<?php' \
  || err "Pobrany plik nie wyglada na poprawny plik PHP (brak naglowka <?php)."

mkdir -p "$DOCROOT" || err "Utworzenie ${DOCROOT} nie powiodlo sie."
mv "${TMPDIR}/index.php" "${DOCROOT}/index.php" || err "Przeniesienie pliku Adminera do ${DOCROOT} nie powiodlo sie."
echo "$ADMINER_VERSION" > "${DOCROOT}/.cddash-version"

OWNER="$(stat -c '%U:%G' /opt/caddy-dashboard)"
chown -R "$OWNER" "$DOCROOT"

# Socket musi byc czytelny/zapisywalny dla usera pod ktorym dziala Caddy
# (laczy sie z nim jako reverse proxy klient) - ta sama poprawka co
# przy phpMyAdmin (potwierdzone na zywym serwerze 2026-08-09: domyslne
# listen.group=cdadmin dawalo Caddy "permission denied").
CADDY_GROUP="$(id -gn caddy 2>/dev/null)"
[ -n "$CADDY_GROUP" ] || err "Nie udalo sie ustalic grupy systemowej usera 'caddy' (id -gn caddy) - czy Caddy jest zainstalowany?"

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
[adminer]
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

if ! systemctl reload "$FPM_SERVICE" 2>/tmp/adminer-install.err; then
  ERR_MSG="$(cat /tmp/adminer-install.err 2>/dev/null)"
  rm -f /tmp/adminer-install.err
  rollback_pool_file
  err "Przeladowanie ${FPM_SERVICE} z nowym poolem adminer nie powiodlo sie: ${ERR_MSG} - przywrocono poprzedni stan poola (plik Adminera w ${DOCROOT} pozostal, ale pool nie dziala)."
fi
rm -f /tmp/adminer-install.err

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
  err "${FPM_SERVICE} nie dziala poprawnie po dodaniu poola adminer - przywrocono poprzedni stan."
fi

echo "OK: Adminer ${ADMINER_VERSION} zainstalowany w ${DOCROOT}, pool PHP-FPM na ${SOCKET_PATH} (${FPM_SERVICE})."
