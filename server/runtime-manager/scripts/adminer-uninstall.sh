#!/usr/bin/env bash
#
# Usuwa Adminer: pool PHP-FPM, socket, plik w docroot. NIE dotyka samego
# PHP 8.3 (moze byc uzywany przez cos innego, np. phpMyAdmin) ani
# Caddyfile (wpiecie w Caddy jest recznym krokiem admina, patrz
# adminer-install.sh).

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

PHP_ID="83"
DOCROOT="/opt/caddy-dashboard/adminer"
SOCKET_PATH="/opt/caddy-dashboard/run/adminer.sock"
POOL_FILE="/etc/opt/remi/php${PHP_ID}/php-fpm.d/adminer.conf"
FPM_SERVICE="php${PHP_ID}-php-fpm"

if [ -f "$POOL_FILE" ]; then
  rm -f "$POOL_FILE"
  systemctl reload "$FPM_SERVICE" 2>/dev/null || true
fi

rm -f "$SOCKET_PATH"
rm -rf "$DOCROOT"

echo "OK: Adminer usuniety (${DOCROOT}, pool ${FPM_SERVICE})."
