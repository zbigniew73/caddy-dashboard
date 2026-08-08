#!/usr/bin/env bash
#
# Zapisuje nowa tresc /etc/my.cnf.d/caddy-dashboard-tuning.cnf (czytana ze
# stdin), restartuje mariadb, weryfikuje ze usluga faktycznie dziala po
# restarcie. Przy niepowodzeniu przywraca poprzednia wersje pliku (albo go
# usuwa, jesli nie istnial wczesniej) i restartuje ponownie.

set -uo pipefail

CONF="/etc/my.cnf.d/caddy-dashboard-tuning.cnf"
HAD_BACKUP=0
BACKUP=""

err_rollback() {
  if [ "$HAD_BACKUP" -eq 1 ]; then
    cp -p "$BACKUP" "$CONF"
  else
    rm -f "$CONF"
  fi
  systemctl restart mariadb >/dev/null 2>&1 || true
  echo "BLAD: $* - przywrocono poprzednia konfiguracje." >&2
  exit 1
}

if [ -f "$CONF" ]; then
  BACKUP="${CONF}.bak-$(date +%Y%m%d%H%M%S)"
  cp -p "$CONF" "$BACKUP" || { echo "BLAD: nie udalo sie zrobic backupu ${CONF}." >&2; exit 1; }
  HAD_BACKUP=1
fi

cat > "$CONF"

if ! systemctl restart mariadb 2>/tmp/mariadb-perf.err; then
  ERR_MSG="$(cat /tmp/mariadb-perf.err 2>/dev/null)"
  rm -f /tmp/mariadb-perf.err
  err_rollback "restart mariadb z nowa konfiguracja nie powiodl sie: ${ERR_MSG}"
fi
rm -f /tmp/mariadb-perf.err

LIVE=""
for _ in 1 2 3 4 5; do
  if systemctl is-active --quiet mariadb; then
    LIVE=1
    break
  fi
  sleep 1
done

if [ -z "$LIVE" ]; then
  err_rollback "mariadb nie dziala poprawnie po restarcie z nowa konfiguracja"
fi

echo "OK: konfiguracja wydajnosci MariaDB zapisana, usluga zrestartowana i dziala."
