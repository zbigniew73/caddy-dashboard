#!/usr/bin/env bash
#
# Wypisuje strumienie modulu php-zts dostepne z repozytorium static-php
# (np. "static-8.4", "static-8.5"), dla wyboru wersji ZTS przy instalacji
# FrankenPHP. Zaklada, ze frankenphp-setup-repo.sh juz zostal uruchomiony
# (wolane osobno PRZED tym skryptem przez routes/frankenphp.js), tak samo
# jak remi-list-available.sh zaklada wczesniejsze remi-setup-repos.sh.
# Jeden wiersz na strumien: "<X.Y> enabled" albo "<X.Y> available" -
# modul DNF ma zawsze co najwyzej jeden wlaczony strumien na raz (streams
# sie wzajemnie wykluczaja), stad "enabled" a nie "installed" jak przy
# pojedynczych pakietach PHP-FPM.
#
# UWAGA: dokladny format `dnf module list php-zts` (nazwy kolumn, znaczniki
# [d]/[e]/[i]) wymaga zweryfikowania na prawdziwym AlmaLinux/Rocky - ten
# skrypt nie moze byc przetestowany na maszynie deweloperskiej. Jesli
# parsowanie ponizej okaze sie nie pasowac do realnego wyjscia, trzeba je
# poprawic na podstawie prawdziwego `dnf module list php-zts`.

set -uo pipefail

STREAMS="$(dnf -q module list php-zts 2>/dev/null | awk '$1 == "php-zts" { print $2 }' | grep -E '^static-[0-9]+\.[0-9]+$' | sort -u)"
ENABLED_STREAM="$(dnf -q module list --enabled php-zts 2>/dev/null | awk '$1 == "php-zts" { print $2 }' | head -n1)"

echo "$STREAMS" | while read -r stream; do
  [ -n "$stream" ] || continue
  ver="${stream#static-}"
  if [ "$stream" = "$ENABLED_STREAM" ]; then
    echo "${ver} enabled"
  else
    echo "${ver} available"
  fi
done
