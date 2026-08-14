#!/usr/bin/env bash
#
# Ustawia prog TWARDEGO ODRZUCENIA (-r) dla spamass-milter - wiadomosci
# punktowane WYZEJ niz ten prog sa odrzucane na poziomie SMTP (nadawca
# dostaje blad), nizej punktowane przechodza dalej z samymi naglowkami
# X-Spam-* (standardowy prog tagowania SpamAssassin, 5.0, zostaje bez
# zmian - to inna, osobna liczba). Walidacja przez restart +
# `systemctl is-active`, backup+rollback jesli sie nie powiedzie (ten
# sam wzorzec co postfwd-set-limits.sh - spamass-milter tez nie ma
# potwierdzonego trybu "tylko sprawdz skladnie").
#
# Uzycie: spamassassin-set-threshold.sh <prog_odrzucenia>

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

THRESHOLD="${1:-}"
CONF_FILE="/etc/sysconfig/spamass-milter"

[[ "$THRESHOLD" =~ ^[0-9]+$ ]] && [ "$THRESHOLD" -ge 1 ] || err "nieprawidlowy prog odrzucenia: '${THRESHOLD}'."
[ -f "$CONF_FILE" ] || err "${CONF_FILE} nie istnieje - SpamAssassin jest jeszcze niezainstalowany."

BACKUP="$(mktemp)"
cp -p "$CONF_FILE" "$BACKUP"

if grep -q '^EXTRA_FLAGS=' "$CONF_FILE"; then
  sed -i "s|^EXTRA_FLAGS=.*|EXTRA_FLAGS=\"-r ${THRESHOLD}\"|" "$CONF_FILE"
else
  printf 'EXTRA_FLAGS="-r %s"\n' "$THRESHOLD" >> "$CONF_FILE"
fi

rollback() {
  cp -p "$BACKUP" "$CONF_FILE"
  systemctl restart spamass-milter >/dev/null 2>&1 || true
  rm -f "$BACKUP"
}

if ! systemctl restart spamass-milter 2>/tmp/spamassassin-set-threshold.err; then
  MSG="$(cat /tmp/spamassassin-set-threshold.err 2>/dev/null)"
  rm -f /tmp/spamassassin-set-threshold.err
  rollback
  err "Restart spamass-milter z nowym progiem nie powiodl sie: ${MSG} - przywrocono poprzedni config."
fi
rm -f /tmp/spamassassin-set-threshold.err

sleep 1
if ! systemctl is-active --quiet spamass-milter; then
  rollback
  err "spamass-milter nie wystartowal poprawnie z nowym progiem (sprawdz: journalctl -u spamass-milter) - przywrocono poprzedni config."
fi
rm -f "$BACKUP"

echo "OK: prog odrzucenia SpamAssassin ustawiony na ${THRESHOLD}."
