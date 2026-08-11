#!/usr/bin/env bash
#
# Test polaczenia + biezace zuzycie RAM prywatnej instancji Redis konta
# hostingowego (self-service z panelu klienta, /user/ - Redis, przycisk
# "Test polaczenia" i kafelek statystyk). Socket i config sa wlasnoscia
# TEGO usera (0600/0700, patrz hosting-user-redis-apply.sh) - panel
# (cdadmin) nie ma do nich dostepu wprost, std laczymy sie jako ten user
# przez `runuser`.
#
# Haslo (jesli ustawione) idzie na STDIN, przekazywane do redis-cli przez
# zmienna srodowiskowa REDISCLI_AUTH (widoczna tylko dla wlasciciela
# procesu/roota przez /proc/<pid>/environ, NIE przez argv/`ps` jak przy
# `-a haslo`).
#
# Uzycie: hosting-user-redis-info.sh <username>   (haslo na stdin, pusta linia = brak hasla)

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

USERNAME="${1:-}"
[[ "$USERNAME" =~ ^srv_[0-9]+$ ]] || err "Nieprawidlowa nazwa uzytkownika: '${USERNAME}'"

PASSWORD="$(cat -)"
SOCK="/run/cd-user-redis/${USERNAME}/redis.sock"

[ -S "$SOCK" ] || err "Redis dla ${USERNAME} nie dziala (brak socketu ${SOCK})."

CLI="redis-cli"
command -v redis-cli >/dev/null 2>&1 || CLI="valkey-cli"
command -v "$CLI" >/dev/null 2>&1 || err "Nie znaleziono ani redis-cli, ani valkey-cli."

if [ -n "$PASSWORD" ]; then
  OUT="$(runuser -u "$USERNAME" -- bash -c "REDISCLI_AUTH=\"\$(cat)\" ${CLI} -s '${SOCK}' info memory" <<< "$PASSWORD" 2>&1)"
else
  OUT="$(runuser -u "$USERNAME" -- "$CLI" -s "$SOCK" info memory 2>&1)"
fi
[ $? -eq 0 ] || err "Polaczenie nieudane: ${OUT}"

USED_MEMORY="$(echo "$OUT" | grep -m1 '^used_memory:' | tr -d '\r' | cut -d: -f2)"
[ -n "$USED_MEMORY" ] || err "Polaczono, ale nie udalo sie odczytac zuzycia pamieci: ${OUT}"

echo "OK"
echo "USED_MEMORY_BYTES=${USED_MEMORY}"
