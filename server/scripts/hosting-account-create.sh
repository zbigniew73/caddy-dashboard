#!/usr/bin/env bash
#
# Tworzy uzytkownika systemowego dla konta hostingowego - bez mozliwosci
# logowania (haslo zablokowane, powloka nologin), z katalogiem domowym pod
# wskazanym punktem montowania (<home_base_dir>/<username>). Limit dysku
# (quota) NIE jest tu ustawiany - to osobny krok, patrz
# quota-ext4-set.sh / quota-xfs-set.sh, wywolywany osobno przez
# server/services/hostingAccounts.js.
#
# Uzycie: hosting-account-create.sh <username> <home_base_dir>

set -euo pipefail

USERNAME="${1:-}"
HOME_BASE_DIR="${2:-}"

if ! [[ "$USERNAME" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
  echo "BLAD: nieprawidlowa nazwa uzytkownika: '${USERNAME}'" >&2
  exit 1
fi
if [[ "$HOME_BASE_DIR" != /* ]] || [ ! -d "$HOME_BASE_DIR" ]; then
  echo "BLAD: nieprawidlowy katalog bazowy: '${HOME_BASE_DIR}'" >&2
  exit 1
fi
if id -u "$USERNAME" >/dev/null 2>&1; then
  echo "BLAD: uzytkownik '${USERNAME}' juz istnieje." >&2
  exit 1
fi

if [ -x /usr/sbin/nologin ]; then
  NOLOGIN=/usr/sbin/nologin
elif [ -x /sbin/nologin ]; then
  NOLOGIN=/sbin/nologin
else
  NOLOGIN=/bin/false
fi

useradd -m -b "$HOME_BASE_DIR" -s "$NOLOGIN" "$USERNAME"
passwd -l "$USERNAME" >/dev/null 2>&1 || true

echo "OK: utworzono konto ${USERNAME} (katalog domowy ${HOME_BASE_DIR}/${USERNAME})"
