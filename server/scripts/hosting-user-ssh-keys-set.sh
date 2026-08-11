#!/usr/bin/env bash
#
# Nadpisuje cala tresc ~/.ssh/authorized_keys konta hostingowego nowa
# trescia ze STDIN (self-service z panelu klienta, /user/ - SSH). Tresc
# jest budowana i walidowana WCZESNIEJ, w Node
# (server/services/hostingUserSsh.js) - ten skrypt tylko wykonuje
# uprzywilejowana operacje zapisu jako root.
#
# Uzycie: hosting-user-ssh-keys-set.sh <username>   (nowa tresc na stdin)

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

TMP_FILE="$(mktemp)"
trap 'rm -f "$TMP_FILE"' EXIT
cat - > "$TMP_FILE"

install -m 600 -o "$USERNAME" -g "$USERNAME" "$TMP_FILE" "$AUTH_FILE"
echo "OK: authorized_keys zaktualizowany dla ${USERNAME}"
