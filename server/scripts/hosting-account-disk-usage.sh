#!/usr/bin/env bash
#
# Zwraca rzeczywiste zuzycie dysku (w MB) katalogu domowego konta
# hostingowego (kafelek "Dysk" na Dashboardzie /user/,
# server/services/hostingUserSelf.js). Dziala niezaleznie od tego, czy
# limit dysku jest juz egzekwowany przez quote (ext4 usrquota / XFS
# project quota) - `du` liczy realne zajete bloki, nie zaklada zadnego
# konkretnego mechanizmu limitu. Katalog domowy jest wlasnoscia usera
# (bash shell, pelny SSH - patrz hosting-account-create.sh) i nie jest
# czytelny dla serwisowego usera panelu, std sudo/root.
#
# Katalog domowy jest odczytywany z /etc/passwd PRZEZ TEN SKRYPT (nie
# przyjmowany jako argument) - ten sam wzorzec bezpieczenstwa co w
# hosting-account-sites-count.sh, zeby caller nie mogl podac dowolnej
# sciezki do przeskanowania jako root.
#
# Uzycie: hosting-account-disk-usage.sh <username>

set -euo pipefail

USERNAME="${1:-}"

if ! [[ "$USERNAME" =~ ^srv_[0-9]+$ ]]; then
  echo "BLAD: nieprawidlowa nazwa uzytkownika: '${USERNAME}'" >&2
  exit 1
fi

HOME_DIR="$(getent passwd "$USERNAME" | cut -d: -f6)"
if [ -z "$HOME_DIR" ] || [ ! -d "$HOME_DIR" ]; then
  echo "0"
  exit 0
fi

du -sm "$HOME_DIR" 2>/dev/null | awk '{print $1}' || echo "0"
