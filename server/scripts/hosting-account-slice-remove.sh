#!/usr/bin/env bash
#
# Usuwa drop-in limitu RAM nalozony przez hosting-account-slice-set.sh, przy
# usuwaniu konta hostingowego (patrz hostingAccounts.js deleteAccount) - bez
# tego, gdyby ten sam UID zostal kiedys ponownie przydzielony innemu
# kontu, odziedziczyloby stary limit po poprzednim wlascicielu.
#
# Uzycie: hosting-account-slice-remove.sh <uid>

set -euo pipefail

UID_ARG="${1:-}"

if ! [[ "$UID_ARG" =~ ^[0-9]+$ ]]; then
  echo "BLAD: nieprawidlowy UID: '${UID_ARG}'" >&2
  exit 1
fi

rm -rf "/etc/systemd/system/user-${UID_ARG}.slice.d"
systemctl daemon-reload

echo "OK: usunieto limit RAM dla user-${UID_ARG}.slice"
