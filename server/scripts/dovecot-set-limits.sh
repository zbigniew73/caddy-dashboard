#!/usr/bin/env bash
#
# Ustawia mail_max_userip_connections (limit jednoczesnych polaczen IMAP
# per uzytkownik z jednego IP) we WLASNYM drop-inie Dovecota
# (/etc/dovecot/conf.d/90-caddy-dashboard.conf, ten sam plik co
# mail-install.sh/mail-tls-swap.sh), nie w plikach pakietu. Idempotentne -
# podmienia istniejaca linie jesli juz jest, dopisuje nowa jesli jeszcze
# jej nie ma. Walidacja (`doveconf -n`) PRZED przeladowaniem, backup+
# rollback jesli sie nie powiedzie.
#
# Uzycie: dovecot-set-limits.sh <mail_max_userip_connections>

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

VALUE="${1:-}"
DOVECOT_CONF="/etc/dovecot/conf.d/90-caddy-dashboard.conf"

[[ "$VALUE" =~ ^[0-9]+$ ]] && [ "$VALUE" -ge 1 ] || err "nieprawidlowa wartosc mail_max_userip_connections: '${VALUE}' (oczekiwano liczby calkowitej >= 1)."
[ -f "$DOVECOT_CONF" ] || err "${DOVECOT_CONF} nie istnieje - Poczta (Postfix/Dovecot) jest jeszcze niezainstalowana."

BACKUP="$(mktemp)"
cp -p "$DOVECOT_CONF" "$BACKUP"

if grep -q '^mail_max_userip_connections = ' "$DOVECOT_CONF"; then
  sed -i "s|^mail_max_userip_connections = .*|mail_max_userip_connections = ${VALUE}|" "$DOVECOT_CONF"
else
  printf '\nmail_max_userip_connections = %s\n' "$VALUE" >> "$DOVECOT_CONF"
fi

if ! doveconf -n >/dev/null 2>/tmp/dovecot-set-limits.err; then
  MSG="$(cat /tmp/dovecot-set-limits.err 2>/dev/null)"
  rm -f /tmp/dovecot-set-limits.err
  cp -p "$BACKUP" "$DOVECOT_CONF"
  rm -f "$BACKUP"
  err "Nowa wartosc nie przeszla walidacji (doveconf -n): ${MSG} - przywrocono poprzedni config."
fi
rm -f /tmp/dovecot-set-limits.err

if ! systemctl reload dovecot 2>/tmp/dovecot-set-limits.err; then
  MSG="$(cat /tmp/dovecot-set-limits.err 2>/dev/null)"
  rm -f /tmp/dovecot-set-limits.err
  cp -p "$BACKUP" "$DOVECOT_CONF"
  systemctl reload dovecot >/dev/null 2>&1 || true
  rm -f "$BACKUP"
  err "Przeladowanie dovecot z nowa wartoscia nie powiodlo sie: ${MSG} - przywrocono poprzedni config."
fi
rm -f "$BACKUP"

echo "OK: mail_max_userip_connections=${VALUE}."
