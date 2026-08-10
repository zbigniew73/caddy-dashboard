#!/usr/bin/env bash
#
# Tworzy/aktualizuje /etc/systemd/system/hosting.slice - nadrzedny cgroup
# slice, ktory ma byc rodzicem dla przyszlych per-site cgroup (PHP-FPM
# pool/sockets, patrz Runtime Manager) i twardo ograniczac ich LACZNE zuzycie
# CPU, zostawiajac rezerwe dla systemu. Na razie zaden proces jeszcze pod ten
# slice sie nie podpina - sam slice trzyma limit gotowy na przyszlosc.
#
# Uzycie:
#   hosting-slice-set.sh <percent>     - ustawia CPUQuota=<percent>% (liczba calkowita, jak w systemd: 100% = jeden pelny rdzen)
#
# Odczyt stanu NIE idzie przez ten skrypt/sudo - unit w /etc/systemd/system/
# jest standardowo swiatoczytelny (0644), wiec server/services/hostingSlice.js
# czyta go bezposrednio z Node (patrz tam), bez podnoszenia uprawnien.

set -euo pipefail

UNIT_PATH="/etc/systemd/system/hosting.slice"

PERCENT="${1:-}"
if ! [[ "$PERCENT" =~ ^[0-9]+$ ]] || [ "$PERCENT" -lt 1 ] || [ "$PERCENT" -gt 100000 ]; then
  echo "BLAD: nieprawidlowy procent CPUQuota: '${PERCENT}'" >&2
  exit 1
fi

TMP="$(mktemp)"
cat > "$TMP" <<EOF
[Unit]
Description=caddy-dashboard - nadrzedny limit CPU dla hostowanych stron (rezerwa dla systemu)

[Slice]
CPUAccounting=yes
CPUQuota=${PERCENT}%
EOF

install -m 644 -o root -g root "$TMP" "$UNIT_PATH"
rm -f "$TMP"

systemctl daemon-reload
systemctl enable --now hosting.slice >/dev/null 2>&1 || true
systemctl set-property hosting.slice CPUQuota="${PERCENT}%"

echo "OK: hosting.slice ustawiony na CPUQuota=${PERCENT}%"
