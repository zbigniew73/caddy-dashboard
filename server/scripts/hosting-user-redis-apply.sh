#!/usr/bin/env bash
#
# Tworzy/uruchamia (lub aktualizuje juz istniejaca) PRYWATNA instancje
# Redis dla konta hostingowego (self-service z panelu klienta, /user/ -
# Redis). Jeden user = jedna instancja, wlasny systemd service
# `cd-user-redis@<username>.service` (template unit, self-instalujacy sie
# tutaj przy pierwszym uzyciu - zaden reczny krok na VPS nie jest
# potrzebny poza zwyklym refresh-sudoers.sh).
#
# BEZPIECZENSTWO (wieledostepowy VPS - wielu userow hostingowych na tym
# samym boxie): instancja NASLUCHUJE WYLACZNIE na unix sockecie
# (port 0, bez TCP), plik configu i sam socket sa wlasnoscia TEGO usera,
# tryb 0600/0700 - haslo (requirepass) jest wiec NAPRAWDE opcjonalne,
# bo dostep do socketu juz jest ograniczony uprawnieniami systemu plikow
# do wlasciciela + roota, nie do wszystkich lokalnych userow jak przy
# TCP na 127.0.0.1 (ktore byloby widoczne dla KAZDEGO innego konta
# hostingowego na tym samym serwerze).
#
# LIMIT RAM: `maxmemory <mb>mb` w configu Redisa to GLOWNY, jawnie zadany
# limit (domyslnie 256MB przy self-service starcie z panelu klienta -
# server/services/hostingUserRedis.js - podnoszenie wyzej jest juz
# decyzja admina, patrz karta Redis w panelu admina). DODATKOWO instancja
# jest przypisywana do JUZ ISTNIEJACEGO `user-<uid>.slice` konta (ten sam
# slice, ktory ogranicza RAM calego konta - patrz komentarz w
# hosting-account-slice-set.sh: "przyszle uslugi hostowane na koncie...
# maja z niego korzystac zamiast wlasnych, osobnych limitow pamieci") -
# NIE tworzymy osobnego, nowego mechanizmu limitu.
#
# LINGERING: `user-<uid>.slice` domyslnie znika po wylogowaniu ostatniej
# sesji SSH usera (logind), co zabiloby tez Redis dzialajacego w tym
# slice. `loginctl enable-linger` utrzymuje slice (i wszystko w nim)
# dzialajace niezaleznie od aktywnej sesji - wymagane, zeby Redis
# dzialal w tle tak jak prawdziwa usluga.
#
# Uzycie: hosting-user-redis-apply.sh <username> <maxmemory_mb>   (haslo na stdin, pusta linia = brak hasla)

set -euo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

USERNAME="${1:-}"
MAXMEM_MB="${2:-}"
[[ "$USERNAME" =~ ^srv_[0-9]+$ ]] || err "Nieprawidlowa nazwa uzytkownika: '${USERNAME}'"
[[ "$MAXMEM_MB" =~ ^[0-9]+$ ]] && [ "$MAXMEM_MB" -ge 1 ] || err "Nieprawidlowy limit RAM (MB): '${MAXMEM_MB}'"
id -u "$USERNAME" >/dev/null 2>&1 || err "Uzytkownik '${USERNAME}' nie istnieje."
UID_NUM="$(id -u "$USERNAME")"

PASSWORD="$(cat -)"

CONF_DIR="/etc/cd-user-redis"
UNIT_FILE="/etc/systemd/system/cd-user-redis@.service"
DROPIN_DIR="/etc/systemd/system/cd-user-redis@${USERNAME}.service.d"
CONF_FILE="${CONF_DIR}/${USERNAME}.conf"
SOCK="/run/cd-user-redis/${USERNAME}/redis.sock"

mkdir -p "$CONF_DIR"
chmod 711 "$CONF_DIR"

# Template unit - instalowany/nadpisywany tu, idempotentnie (ten sam
# wzorzec co inne "self-installing" skrypty tego projektu - brak
# oddzielnego, recznego kroku instalacyjnego na VPS).
TMP_UNIT="$(mktemp)"
cat > "$TMP_UNIT" <<'UNITEOF'
[Unit]
Description=Per-account Redis cache (%i)
After=network.target

[Service]
Type=notify
ExecStart=/bin/sh -c 'exec $(command -v redis-server || command -v valkey-server) /etc/cd-user-redis/%i.conf --daemonize no --supervised systemd'
User=%i
Group=%i
RuntimeDirectory=cd-user-redis/%i
RuntimeDirectoryMode=0700
NoNewPrivileges=yes
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNITEOF
install -m 644 -o root -g root "$TMP_UNIT" "$UNIT_FILE"
rm -f "$TMP_UNIT"

TMP_CONF="$(mktemp)"
{
  echo "port 0"
  echo "bind 127.0.0.1"
  echo "unixsocket ${SOCK}"
  echo "unixsocketperm 700"
  echo "maxmemory ${MAXMEM_MB}mb"
  echo "maxmemory-policy allkeys-lru"
  echo "daemonize no"
  echo "save \"\""
  echo "appendonly no"
  if [ -n "$PASSWORD" ]; then
    echo "requirepass ${PASSWORD}"
  fi
} > "$TMP_CONF"
install -m 600 -o "$USERNAME" -g "$USERNAME" "$TMP_CONF" "$CONF_FILE"
rm -f "$TMP_CONF"

mkdir -p "$DROPIN_DIR"
TMP_DROPIN="$(mktemp)"
cat > "$TMP_DROPIN" <<EOF
[Service]
Slice=user-${UID_NUM}.slice
EOF
install -m 644 -o root -g root "$TMP_DROPIN" "${DROPIN_DIR}/slice.conf"
rm -f "$TMP_DROPIN"

systemctl daemon-reload

loginctl enable-linger "$USERNAME" >/dev/null 2>&1 || true

systemctl restart "cd-user-redis@${USERNAME}.service" || err "Nie udalo sie uruchomic Redis dla ${USERNAME} - sprawdz journalctl -u cd-user-redis@${USERNAME}.service"
systemctl enable "cd-user-redis@${USERNAME}.service" >/dev/null 2>&1 || true

echo "OK: Redis dla ${USERNAME} uruchomiony."
