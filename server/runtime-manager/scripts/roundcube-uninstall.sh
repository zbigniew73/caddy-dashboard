#!/usr/bin/env bash
#
# Usuwa Roundcube: pool PHP-FPM, socket, pliki w /opt/webmail. NIE dotyka
# samego PHP 8.4 (moze byc uzywany przez cos innego). Jesli instalacja
# uzywala MySQL/MariaDB (marker .cddash-db-engine zapisany przez
# roundcube-install.sh), kasuje tez baze+usera 'roundcube' - dla sqlite
# nie ma nic dodatkowego do posprzatania poza samymi plikami w DOCROOT.
# Blok Caddy (webmail.<domena>/mail.<domena> w /etc/caddy/Caddyfile) NIE
# jest tu ruszany - to sprawa panelu glownego (roundcubeSite.js), wolane
# osobno, bo Runtime Manager nic nie wie o domenie.

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

PHP_ID="84"
DOCROOT="/opt/webmail"
SOCKET_PATH="/opt/webmail/run/roundcube.sock"
POOL_FILE="/etc/opt/remi/php${PHP_ID}/php-fpm.d/roundcube.conf"
FPM_SERVICE="php${PHP_ID}-php-fpm"
MARIADB_PWFILE="/root/.mariadb"

if [ -f "${DOCROOT}/.cddash-db-engine" ] && [ "$(cat "${DOCROOT}/.cddash-db-engine")" = "mysql" ]; then
  if [ -f "$MARIADB_PWFILE" ] && command -v mariadb >/dev/null 2>&1; then
    ROOT_PASS="$(cat "$MARIADB_PWFILE")"
    mariadb -u root -p"${ROOT_PASS}" <<SQL || echo "OSTRZEZENIE: nie udalo sie usunac bazy/uzytkownika 'roundcube' w MariaDB - sprawdz recznie." >&2
DROP DATABASE IF EXISTS \`roundcube\`;
DROP USER IF EXISTS 'roundcube'@'localhost';
FLUSH PRIVILEGES;
SQL
  else
    echo "OSTRZEZENIE: Roundcube uzywal MariaDB, ale nie mozna sie polaczyc (brak ${MARIADB_PWFILE} albo polecenia mariadb) - baza 'roundcube' NIE zostala usunieta, posprzataj recznie." >&2
  fi
fi

if [ -f "$POOL_FILE" ]; then
  rm -f "$POOL_FILE"
  systemctl reload "$FPM_SERVICE" 2>/dev/null || true
fi

rm -f "$SOCKET_PATH"
rm -rf "$DOCROOT"

echo "OK: Roundcube usuniety (${DOCROOT}, pool ${FPM_SERVICE})."
