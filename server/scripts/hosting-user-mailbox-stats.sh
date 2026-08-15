#!/usr/bin/env bash
#
# Statystyki wlasnej skrzynki systemowej (~/Maildir) konta hostingowego -
# kafelek "Statystyki skrzynki" w zakladce Poczta panelu /user/. Katalog
# domowy jest wlasnoscia usera (pelny SSH) i nie jest czytelny dla
# serwisowego usera panelu, std sudo/root - ten sam wzorzec co
# hosting-account-disk-usage.sh.
#
# Katalog domowy jest odczytywany z /etc/passwd PRZEZ TEN SKRYPT (nie
# przyjmowany jako argument), zeby caller nie mogl podac dowolnej sciezki
# do przeskanowania jako root.
#
# Brak Maildir (mail-install.sh nigdy nie uruchamiany, albo konto jeszcze
# nie odebralo/nie wyslalo zadnej wiadomosci) to normalny stan, nie blad -
# zwraca "0 0".
#
# Uzycie: hosting-user-mailbox-stats.sh <username>
# Wyjscie: dwie linie - rozmiar w MB, liczba wiadomosci

set -euo pipefail

USERNAME="${1:-}"

if ! [[ "$USERNAME" =~ ^srv_[0-9]+$ ]]; then
  echo "BLAD: nieprawidlowa nazwa uzytkownika: '${USERNAME}'" >&2
  exit 1
fi

HOME_DIR="$(getent passwd "$USERNAME" | cut -d: -f6)"
MAILDIR="${HOME_DIR}/Maildir"

if [ -z "$HOME_DIR" ] || [ ! -d "$MAILDIR" ]; then
  echo "0"
  echo "0"
  exit 0
fi

SIZE_MB="$(du -sm "$MAILDIR" 2>/dev/null | awk '{print $1}')"
[ -z "$SIZE_MB" ] && SIZE_MB="0"

# Wiadomosci zyja w cur/ (przeczytane) i new/ (nieprzeczytane) - zarowno w
# samym INBOX, jak i w kazdym podfolderze (.Nazwa/cur, .Nazwa/new, format
# Maildir++). tmp/ celowo pominiete - to tylko poczekalnia w trakcie
# dostarczania, nie gotowe wiadomosci.
COUNT="$(find "$MAILDIR" -type f \( -path '*/cur/*' -o -path '*/new/*' \) 2>/dev/null | wc -l)"
[ -z "$COUNT" ] && COUNT="0"

echo "$SIZE_MB"
echo "$COUNT"
