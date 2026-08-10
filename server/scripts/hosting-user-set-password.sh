#!/usr/bin/env bash
#
# Ustawia nowe haslo dla konta hostingowego (self-service z panelu klienta,
# /user/ - Ustawienia > Zmiana hasla). Haslo nowego usera jest CELOWO
# czytane ze STDIN (jedna linia), NIGDY jako argument wywolania - argv
# procesu jest widoczne dla kazdego lokalnego uzytkownika przez `ps`/
# /proc/<pid>/cmdline, a konta hostingowe maja teraz pelny dostep SSH
# (patrz hosting-account-create.sh), wiec argv nie jest bezpiecznym
# kanalem na sekret.
#
# Weryfikacja obecnego hasla (PAM) odbywa sie WCZESNIEJ, w Node
# (server/services/hostingUserSelf.js) - ten skrypt tylko ustawia nowe.
#
# Uzycie: hosting-user-set-password.sh <username>   (nowe haslo na stdin)

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

NEW_PASSWORD="$(cat -)"
if [ -z "$NEW_PASSWORD" ]; then
  echo "BLAD: puste haslo." >&2
  exit 1
fi

echo "${USERNAME}:${NEW_PASSWORD}" | chpasswd
echo "OK: haslo zmienione dla ${USERNAME}"
