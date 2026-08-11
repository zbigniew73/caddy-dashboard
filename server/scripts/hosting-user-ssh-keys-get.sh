#!/usr/bin/env bash
#
# Zwraca surowa tresc ~/.ssh/authorized_keys konta hostingowego
# (self-service z panelu klienta, /user/ - SSH). Panel dziala jako
# osobny user serwisowy, nie ma wiec prawa czytac ani tworzyc plikow w
# katalogu domowym innego usera - std sudo, root tworzy/czyta jako
# wlasciciel.
#
# Tworzy ~/.ssh (0700) i authorized_keys (0600) jesli jeszcze nie
# istnieja - swiezo utworzone konto hostingowe (hosting-account-create.sh)
# loguje sie haslem, nie ma jeszcze zadnego katalogu .ssh dopoki ktos nie
# doda pierwszy klucz z tego panelu.
#
# Uzycie: hosting-user-ssh-keys-get.sh <username>

set -euo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

USERNAME="${1:-}"

if ! [[ "$USERNAME" =~ ^srv_[0-9]+$ ]]; then
  echo "BLAD: nieprawidlowa nazwa uzytkownika: '${USERNAME}'" >&2
  exit 1
fi
id -u "$USERNAME" >/dev/null 2>&1 || err "Uzytkownik '${USERNAME}' nie istnieje."

HOME_DIR="$(getent passwd "$USERNAME" | cut -d: -f6)"
[ -n "$HOME_DIR" ] && [ -d "$HOME_DIR" ] || err "Brak katalogu domowego dla '${USERNAME}'."

SSH_DIR="${HOME_DIR}/.ssh"
AUTH_FILE="${SSH_DIR}/authorized_keys"

mkdir -p "$SSH_DIR"
chmod 700 "$SSH_DIR"
chown "${USERNAME}:${USERNAME}" "$SSH_DIR"
touch "$AUTH_FILE"
chmod 600 "$AUTH_FILE"
chown "${USERNAME}:${USERNAME}" "$AUTH_FILE"

cat "$AUTH_FILE"
