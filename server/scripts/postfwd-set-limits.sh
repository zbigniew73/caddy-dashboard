#!/usr/bin/env bash
#
# Ustawia limit tempa wysylki postfwd (per uwierzytelnione konto,
# sasl_username) - trzy okna: na minute, na godzine, na dzien. Nadpisuje
# CALY /etc/postfwd/postfwd.cf (plik jest w calosci nasz, patrz
# postfwd-install.sh) - walidacja przez restart + sprawdzenie
# `systemctl is-active`, backup+rollback jesli sie nie powiedzie
# (postfwd nie ma potwierdzonego trybu "tylko sprawdz skladnie", wiec
# restart+is-active to najbezpieczniejszy dostepny test).
#
# Uzycie: postfwd-set-limits.sh <per_minute> <per_hour> <per_day>

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

PER_MINUTE="${1:-}"
PER_HOUR="${2:-}"
PER_DAY="${3:-}"
POSTFWD_CF="/etc/postfwd/postfwd.cf"

[[ "$PER_MINUTE" =~ ^[0-9]+$ ]] && [ "$PER_MINUTE" -ge 1 ] || err "nieprawidlowy limit na minute: '${PER_MINUTE}'."
[[ "$PER_HOUR" =~ ^[0-9]+$ ]] && [ "$PER_HOUR" -ge 1 ] || err "nieprawidlowy limit na godzine: '${PER_HOUR}'."
[[ "$PER_DAY" =~ ^[0-9]+$ ]] && [ "$PER_DAY" -ge 1 ] || err "nieprawidlowy limit na dzien: '${PER_DAY}'."
[ -f "$POSTFWD_CF" ] || err "${POSTFWD_CF} nie istnieje - postfwd jest jeszcze niezainstalowany."

BACKUP="$(mktemp)"
cp -p "$POSTFWD_CF" "$BACKUP"

cat > "$POSTFWD_CF" <<EOF
# Zarzadzane przez Caddy Dashboard - server/scripts/postfwd-set-limits.sh
id=RATE_MIN
        sasl_username=!!^\$
        action=rate(\$\$sasl_username/${PER_MINUTE}/60/450 4.7.1 rate limit exceeded, try again in a minute)

id=RATE_HOUR
        sasl_username=!!^\$
        action=rate(\$\$sasl_username/${PER_HOUR}/3600/450 4.7.1 rate limit exceeded, try again later)

id=RATE_DAY
        sasl_username=!!^\$
        action=rate(\$\$sasl_username/${PER_DAY}/86400/450 4.7.1 daily sending limit exceeded)

id=DEFAULT
        action=dunno
EOF
chmod 644 "$POSTFWD_CF"

rollback() {
  cp -p "$BACKUP" "$POSTFWD_CF"
  systemctl restart postfwd >/dev/null 2>&1 || true
  rm -f "$BACKUP"
}

if ! systemctl restart postfwd 2>/tmp/postfwd-set-limits.err; then
  MSG="$(cat /tmp/postfwd-set-limits.err 2>/dev/null)"
  rm -f /tmp/postfwd-set-limits.err
  rollback
  err "Restart postfwd z nowymi limitami nie powiodl sie: ${MSG} - przywrocono poprzedni config."
fi
rm -f /tmp/postfwd-set-limits.err

sleep 1
if ! systemctl is-active --quiet postfwd; then
  rollback
  err "postfwd nie wystartowal poprawnie z nowymi limitami (sprawdz: journalctl -u postfwd) - przywrocono poprzedni config."
fi
rm -f "$BACKUP"

echo "OK: limit wysylki ustawiony na ${PER_MINUTE}/min, ${PER_HOUR}/godz, ${PER_DAY}/dzien."
