#!/usr/bin/env bash
#
# Zlicza pliki .caddy/.caddy.disabled nalezace do konta hostingowego w
# PLASKIM /etc/caddy/sites (patrz hosting-account-create.sh - bez
# podkatalogow per-konto, izolacja idzie przez wlasciciela pliku, nie
# katalog). Liczy tez strony ZATRZYMANE (.caddy.disabled) - to licznik
# "ile stron ma konto" wzgledem limitu z pakietu (maxDomains), nie "ile
# stron aktualnie dziala". Panel dziala jako osobny user serwisowy (nie
# root, nie w grupie caddy), wiec nie ma prawa czytac tego katalogu
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

SITES_DIR="/etc/caddy/sites"

if [ ! -d "$SITES_DIR" ]; then
  echo "0"
  exit 0
fi

find "$SITES_DIR" -maxdepth 1 -type f \( -name '*.caddy' -o -name '*.caddy.disabled' \) -user "$USERNAME" | wc -l
