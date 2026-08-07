#!/usr/bin/env bash
#
# Zapisuje nowa tresc /etc/fail2ban/jail.local (czytana ze stdin), robi backup,
# przeladowuje fail2ban. Przy niepowodzeniu przywraca poprzednia konfiguracje.

set -uo pipefail

JAIL_LOCAL="/etc/fail2ban/jail.local"
BACKUP="/etc/fail2ban/jail.local.bak-$(date +%Y%m%d%H%M%S)"

if [ -f "$JAIL_LOCAL" ]; then
  cp -p "$JAIL_LOCAL" "$BACKUP" || { echo "BLAD: nie udalo sie zrobic backupu ${JAIL_LOCAL}." >&2; exit 1; }
fi

cat > "$JAIL_LOCAL"

if systemctl reload fail2ban 2>/tmp/fail2ban-write-config.err || systemctl restart fail2ban 2>>/tmp/fail2ban-write-config.err; then
  rm -f /tmp/fail2ban-write-config.err
  echo "OK: konfiguracja zapisana, fail2ban przeladowany."
  exit 0
fi

ERR_MSG="$(cat /tmp/fail2ban-write-config.err 2>/dev/null)"
rm -f /tmp/fail2ban-write-config.err

if [ -f "$BACKUP" ]; then
  cp -p "$BACKUP" "$JAIL_LOCAL"
  systemctl restart fail2ban >/dev/null 2>&1 || true
fi

echo "BLAD: nie udalo sie przeladowac fail2ban z nowa konfiguracja: ${ERR_MSG} - przywrocono poprzedni plik." >&2
exit 1
