#!/usr/bin/env bash
#
# Nadpisuje caly crontab konta hostingowego nowa trescia ze STDIN (self-
# service z panelu klienta, /user/ - Cron). Tresc jest budowana i
# walidowana WCZESNIEJ, w Node (server/services/hostingUserCron.js) - ten
# skrypt tylko wykonuje uprzywilejowana operacje zapisu jako root.
#
# Uzycie: hosting-user-crontab-set.sh <username>   (nowa tresc na stdin)

set -euo pipefail

USERNAME="${1:-}"

if ! [[ "$USERNAME" =~ ^srv_[0-9]+$ ]]; then
  echo "BLAD: nieprawidlowa nazwa uzytkownika: '${USERNAME}'" >&2
  exit 1
fi
if ! id -u "$USERNAME" >/dev/null 2>&1; then
  echo "BLAD: uzytkownik '${USERNAME}' nie istnieje." >&2
  exit 1
fi

TMP_FILE="$(mktemp)"
trap 'rm -f "$TMP_FILE"' EXIT
cat - > "$TMP_FILE"

crontab -u "$USERNAME" "$TMP_FILE"
echo "OK: crontab zaktualizowany dla ${USERNAME}"
