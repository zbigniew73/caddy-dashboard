#!/usr/bin/env bash
#
# Ustawia wydajnosciowe parametry PostgreSQL przez ALTER SYSTEM SET (trzy
# linie na stdin: shared_buffers w MB, max_connections, track_activities
# on/off) i restartuje usluge. PostgreSQL sam zapisuje ALTER SYSTEM do
# postgresql.auto.conf w katalogu danych - przed zmiana robimy backup tego
# pliku i przywracamy go, jesli restart z nowa konfiguracja sie nie powiedzie.

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

read -r SHARED_BUFFERS_MB
read -r MAX_CONNECTIONS
read -r TRACK_ACTIVITIES

PG_UNIT=""
for u in postgresql-17.service postgresql-16.service postgresql-15.service postgresql-14.service postgresql-13.service postgresql.service; do
  if systemctl list-unit-files "$u" --no-legend 2>/dev/null | grep -q "$u"; then
    PG_UNIT="$u"
    break
  fi
done
[ -n "$PG_UNIT" ] || err "Nie znaleziono zainstalowanej uslugi PostgreSQL."

PGDATA="$(runuser -u postgres -- psql -tAc 'SHOW data_directory;' 2>/dev/null | tr -d '[:space:]')"
[ -n "$PGDATA" ] || err "Nie udalo sie ustalic katalogu danych PostgreSQL (data_directory)."
AUTOCONF="${PGDATA}/postgresql.auto.conf"

HAD_BACKUP=0
BACKUP=""
if [ -f "$AUTOCONF" ]; then
  BACKUP="${AUTOCONF}.bak-$(date +%Y%m%d%H%M%S)"
  cp -p "$AUTOCONF" "$BACKUP" || err "Nie udalo sie zrobic backupu ${AUTOCONF}."
  HAD_BACKUP=1
fi

rollback_and_restart() {
  if [ "$HAD_BACKUP" -eq 1 ]; then
    cp -p "$BACKUP" "$AUTOCONF"
  fi
  systemctl restart "$PG_UNIT" >/dev/null 2>&1 || true
}

if ! runuser -u postgres -- psql \
  -c "ALTER SYSTEM SET shared_buffers = '${SHARED_BUFFERS_MB}MB';" \
  -c "ALTER SYSTEM SET max_connections = ${MAX_CONNECTIONS};" \
  -c "ALTER SYSTEM SET track_activities = '${TRACK_ACTIVITIES}';" \
  2>/tmp/pg-perf.err; then
  ERR_MSG="$(cat /tmp/pg-perf.err 2>/dev/null)"
  rm -f /tmp/pg-perf.err
  rollback_and_restart
  err "ALTER SYSTEM nie powiodlo sie: ${ERR_MSG}"
fi
rm -f /tmp/pg-perf.err

if ! systemctl restart "$PG_UNIT" 2>/tmp/pg-perf.err; then
  ERR_MSG="$(cat /tmp/pg-perf.err 2>/dev/null)"
  rm -f /tmp/pg-perf.err
  rollback_and_restart
  err "Restart ${PG_UNIT} z nowa konfiguracja nie powiodl sie: ${ERR_MSG}"
fi
rm -f /tmp/pg-perf.err

LIVE=""
for _ in 1 2 3 4 5; do
  if systemctl is-active --quiet "$PG_UNIT"; then
    LIVE=1
    break
  fi
  sleep 1
done

if [ -z "$LIVE" ]; then
  rollback_and_restart
  err "PostgreSQL nie dziala poprawnie po restarcie z nowa konfiguracja."
fi

echo "OK: konfiguracja wydajnosci PostgreSQL zapisana, usluga ${PG_UNIT} zrestartowana i dziala."
