#!/usr/bin/env bash
#
# Wypisuje wersje PHP dostepne z repozytorium Remi - pakiety SCL nazwane
# dokladnie phpXX (np. php82/php83/php84/php85), NIE phpXX-php-cli itp.
# Jeden wiersz na wersje: "<XX> installed" albo "<XX> available".
# Zaklada, ze remi-setup-repos.sh juz zostal uruchomiony (wolane osobno
# PRZED tym skryptem przez routes/php.js) - jesli repo Remi nie jest
# wlaczone, `dnf repoquery` po prostu nie znajdzie zadnych pakietow i
# skrypt zwroci pusta liste (nie blad).
#
# UWAGA: dokladna komenda repoquery wymaga zweryfikowania na prawdziwym
# AlmaLinux/Rocky (ten skrypt nie moze byc przetestowany na maszynie
# deweloperskiej - patrz notatka w planie/pamieci projektu).

set -uo pipefail

dnf -q repoquery --qf '%{name}' 'php[0-9][0-9]' 2>/dev/null | sort -u | while read -r pkg; do
  [[ "$pkg" =~ ^php([0-9]{2})$ ]] || continue
  ver="${BASH_REMATCH[1]}"
  if rpm -q "$pkg" >/dev/null 2>&1; then
    echo "${ver} installed"
  else
    echo "${ver} available"
  fi
done
