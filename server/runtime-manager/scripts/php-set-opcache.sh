#!/usr/bin/env bash
#
# Zapisuje /etc/opt/remi/phpXX/php.d/98-caddy-dashboard-opcache.ini (tresc
# ze stdin) - osobny plik od 99-caddy-dashboard.ini (podstawowe ustawienia
# PHP) celowo, zeby zapis jednej sekcji z panelu nigdy nie nadpisywal
# drugiej. Ta sama logika backup/reload/weryfikacja/rollback co
# php-set-settings.sh.

set -uo pipefail

err_plain() { echo "BLAD: $*" >&2; exit 1; }

VERSION="${1:-}"
[[ "$VERSION" =~ ^[0-9]{2}$ ]] || err_plain "Nieprawidlowy format wersji: '${VERSION}' (oczekiwano dwoch cyfr, np. 85)."

CONF="/etc/opt/remi/php${VERSION}/php.d/98-caddy-dashboard-opcache.ini"
SERVICE="php${VERSION}-php-fpm"
ERRFILE="/tmp/php-opcache-${VERSION}.err"

[ -d "$(dirname "$CONF")" ] || err_plain "Katalog $(dirname "$CONF") nie istnieje - czy PHP ${VERSION} jest w ogole zainstalowane?"

HAD_BACKUP=0
BACKUP=""

err_rollback() {
  if [ "$HAD_BACKUP" -eq 1 ]; then
    cp -p "$BACKUP" "$CONF"
  else
    rm -f "$CONF"
  fi
  systemctl reload "$SERVICE" >/dev/null 2>&1 || true
  echo "BLAD: $* - przywrocono poprzednia konfiguracje." >&2
  exit 1
}

if [ -f "$CONF" ]; then
  BACKUP="${CONF}.bak-$(date +%Y%m%d%H%M%S)"
  cp -p "$CONF" "$BACKUP" || err_plain "Nie udalo sie zrobic backupu ${CONF}."
  HAD_BACKUP=1
fi

cat > "$CONF"

if ! systemctl reload "$SERVICE" 2>"$ERRFILE"; then
  ERR_MSG="$(cat "$ERRFILE" 2>/dev/null)"
  rm -f "$ERRFILE"
  err_rollback "przeladowanie ${SERVICE} z nowa konfiguracja OPcache nie powiodlo sie: ${ERR_MSG}"
fi
rm -f "$ERRFILE"

LIVE=""
for _ in 1 2 3 4 5; do
  if systemctl is-active --quiet "$SERVICE"; then
    LIVE=1
    break
  fi
  sleep 1
done

[ -n "$LIVE" ] || err_rollback "${SERVICE} nie dziala poprawnie po przeladowaniu z nowa konfiguracja OPcache"

echo "OK: ustawienia OPcache PHP ${VERSION:0:1}.${VERSION:1:1} zapisane, ${SERVICE} przeladowany i dziala."
