#!/usr/bin/env bash
#
# Wypisuje WSZYSTKIE moduly PHP widoczne w repozytorium Remi dla danej
# wersji, nie jakas z gory ustalona liste - "wszystko co widzi system",
# jak chcial user. Zapytanie o pakiety celowo szerokie - "php${VERSION}-*",
# ten sam wzorzec co `dnf search php84-*` uruchomione recznie po SSH (user
# tak to sprawdza, wiec panel ma widziec dokladnie to samo, nie wezszy
# podzbior) - a nie samo "php${VERSION}-php-*". Filtrujemy pozniej do
# faktycznych modulow (prefiks "phpXX-php-"), zeby odsiac pakiety
# rusztowania SCL (np. php84-build/php84-runtime/php84-syspaths), ktore
# nie sa rozszerzeniami do wlaczania/wylaczania. Jeden wiersz na modul:
# "<sufiks po phpXX-php-> installed|available <pelna-nazwa-pakietu>.<arch>"
# - trzecie pole to dokladny identyfikator pakietu (np.
# "php84-php-pecl-zip.x86_64", nie "ladna" etykieta) - user chce widziec
# to samo co pokazuje `dnf` samo w sobie, wiec panel niczego tu nie
# upiekszamy.
#
# Wyklucza fpm/cli/common celowo - to nie sa "moduly" do wlaczania/
# wylaczania, tylko fundament samego runtime PHP (usuniecie ktoregokolwiek
# zepsuloby cala usluge, nie pojedyncze rozszerzenie) - ten sam rodzaj
# ochrony co blokada usuwania portu SSH z tabeli firewalla gdzie indziej
# w tym projekcie.
#
# UWAGA: dokladna komenda repoquery wymaga zweryfikowania na prawdziwym
# AlmaLinux/Rocky (ten skrypt nie moze byc przetestowany na maszynie
# deweloperskiej).

set -uo pipefail

VERSION="${1:-}"
[[ "$VERSION" =~ ^[0-9]{2}$ ]] || { echo "BLAD: nieprawidlowy format wersji: '${VERSION}' (oczekiwano dwoch cyfr, np. 85)." >&2; exit 1; }

PREFIX="php${VERSION}-php-"
PROTECTED=" fpm cli common "

dnf -q repoquery --qf '%{name} %{arch}' "php${VERSION}-*" 2>/dev/null | sort -u -k1,1 | while read -r pkg arch; do
  [[ "$pkg" == "${PREFIX}"* ]] || continue
  suffix="${pkg#"$PREFIX"}"
  [[ "$PROTECTED" == *" ${suffix} "* ]] && continue
  if rpm -q "$pkg" >/dev/null 2>&1; then
    echo "${suffix} installed ${pkg}.${arch}"
  else
    echo "${suffix} available ${pkg}.${arch}"
  fi
done
