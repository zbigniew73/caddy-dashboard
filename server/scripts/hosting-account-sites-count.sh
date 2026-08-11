#!/usr/bin/env bash
#
# Zlicza pliki *.caddy w katalogu domen konta hostingowego (patrz
# hosting-account-create.sh: /etc/caddy/sites/<username>, wlasciciel
# <username>:caddy, tryb 0750). Panel dziala jako osobny user serwisowy
# (nie root, nie w grupie caddy), wiec nie ma prawa czytac tego katalogu
# bezposrednio - std dla kafelka "Strony" w panelu klienta
# (server/services/hostingUserSelf.js).
#
# Uzycie: hosting-account-sites-count.sh <username>

set -euo pipefail

USERNAME="${1:-}"

if ! [[ "$USERNAME" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
  echo "BLAD: nieprawidlowa nazwa uzytkownika: '${USERNAME}'" >&2
  exit 1
fi

SITES_DIR="/etc/caddy/sites/${USERNAME}"

if [ ! -d "$SITES_DIR" ]; then
  echo "0"
  exit 0
fi

find "$SITES_DIR" -maxdepth 1 -type f -name '*.caddy' | wc -l
