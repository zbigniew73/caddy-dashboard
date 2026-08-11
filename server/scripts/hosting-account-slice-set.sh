#!/usr/bin/env bash
#
# Naklada GLOWNY limit RAM konta hostingowego (pole "RAM" pakietu, patrz
# server/services/hostingAccounts.js) przez drop-in dla user-<uid>.slice -
# standardowy, systemowy mechanizm systemd/logind, ktory ogranicza LACZNE
# zuzycie pamieci wszystkich procesow dzialajacych jako dany Linux user
# (m.in. sesje SSH; przy wlaczonym lingeringu - `loginctl enable-linger` -
# takze uslugi dzialajace w tle bez aktywnej sesji). To JEDEN, wspolny
# parametr konta - przyszle uslugi hostowane na koncie (PHP-FPM, cron itd.)
# maja z niego korzystac zamiast wlasnych, osobnych limitow pamieci.
#
# Drop-in dziala NIEZALEZNIE od tego, czy slice jest akurat aktywny - jesli
# user nie ma teraz zadnej sesji, limit zadziala przy nastepnym logowaniu.
# Jesli slice jest juz aktywny, dodatkowo nadpisujemy wlasciwosc od razu
# przez `systemctl set-property` (best-effort, nie blokuje jesli slice
# jeszcze nie istnieje).
#
# Uzycie: hosting-account-slice-set.sh <uid> <ram_mb>

set -euo pipefail

UID_ARG="${1:-}"
RAM_MB="${2:-}"

if ! [[ "$UID_ARG" =~ ^[0-9]+$ ]]; then
  echo "BLAD: nieprawidlowy UID: '${UID_ARG}'" >&2
  exit 1
fi
if ! [[ "$RAM_MB" =~ ^[0-9]+$ ]] || [ "$RAM_MB" -lt 1 ]; then
  echo "BLAD: nieprawidlowy limit RAM (MB): '${RAM_MB}'" >&2
  exit 1
fi

DROPIN_DIR="/etc/systemd/system/user-${UID_ARG}.slice.d"
mkdir -p "$DROPIN_DIR"

TMP="$(mktemp)"
cat > "$TMP" <<EOF
[Slice]
MemoryAccounting=yes
MemoryMax=${RAM_MB}M
EOF
install -m 644 -o root -g root "$TMP" "${DROPIN_DIR}/caddy-dashboard-ram.conf"
rm -f "$TMP"

systemctl daemon-reload
systemctl set-property "user-${UID_ARG}.slice" MemoryMax="${RAM_MB}M" >/dev/null 2>&1 || true

echo "OK: user-${UID_ARG}.slice ograniczony do MemoryMax=${RAM_MB}M"
