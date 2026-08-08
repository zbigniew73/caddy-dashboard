#!/usr/bin/env bash
#
# Ustawia parametry wydajnosci Redis (maxmemory w MB, maxclients, prog
# slowlog) przez redis-cli CONFIG SET. W Redis dziala to NATYCHMIAST, bez
# restartu uslugi - CONFIG REWRITE na koncu tylko trwale zapisuje biezacy
# stan do redis.conf, zeby przetrwal ewentualny restart/reboot.
#
# Trzy linie na stdin: MAXMEMORY_MB, MAXCLIENTS, SLOWLOG_THRESHOLD_US (-1 = wylaczony)

set -uo pipefail

PWFILE="/root/.redispw"

err() { echo "BLAD: $*" >&2; exit 1; }

read -r MAXMEMORY_MB
read -r MAXCLIENTS
read -r SLOWLOG_THRESHOLD

[ -f "$PWFILE" ] || err "Nie znaleziono ${PWFILE} - czy Redis zostal zainstalowany przez ten panel?"
PASSWORD="$(cat "$PWFILE")"

redis-cli -a "$PASSWORD" --no-auth-warning CONFIG SET maxmemory "${MAXMEMORY_MB}mb" >/dev/null \
  || err "Nie udalo sie ustawic maxmemory."
redis-cli -a "$PASSWORD" --no-auth-warning CONFIG SET maxclients "$MAXCLIENTS" >/dev/null \
  || err "Nie udalo sie ustawic maxclients."
redis-cli -a "$PASSWORD" --no-auth-warning CONFIG SET slowlog-log-slower-than "$SLOWLOG_THRESHOLD" >/dev/null \
  || err "Nie udalo sie ustawic slowlog-log-slower-than."
redis-cli -a "$PASSWORD" --no-auth-warning CONFIG REWRITE >/dev/null \
  || err "Ustawienia zastosowane na zywo, ale trwaly zapis (CONFIG REWRITE) nie powiodl sie."

echo "OK: konfiguracja wydajnosci Redis zastosowana natychmiast (bez restartu) i zapisana trwale."
