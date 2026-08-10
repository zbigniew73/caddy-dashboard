#!/usr/bin/env bash
#
# Usuwa uzytkownika systemowego konta hostingowego. CELOWO bez -r (nie
# kasuje katalogu domowego ani danych strony) - usuniecie konta z panelu
# nie powinno bezpowrotnie kasowac plikow. Admin czysci katalog recznie,
# jesli faktycznie chce skasowac dane. Ta sama filozofia dotyczy
# /etc/caddy/sites/<username> (konfiguracje domen tego konta, patrz
# hosting-account-create.sh) - CELOWO nie usuwamy go tutaj, strony
# zostaja serwowane dalej, dopoki admin recznie nie skasuje plikow
# *.caddy.
#
# Uzycie: hosting-account-delete.sh <username>

set -euo pipefail

USERNAME="${1:-}"

if ! [[ "$USERNAME" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
  echo "BLAD: nieprawidlowa nazwa uzytkownika: '${USERNAME}'" >&2
  exit 1
fi
if ! id -u "$USERNAME" >/dev/null 2>&1; then
  echo "BLAD: uzytkownik '${USERNAME}' nie istnieje." >&2
  exit 1
fi

userdel "$USERNAME"
echo "OK: usunieto konto ${USERNAME} (katalog domowy POZOSTAL nietkniety)"
