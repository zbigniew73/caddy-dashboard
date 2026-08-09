#!/usr/bin/env bash
#
# Wypisuje WSZYSTKIE moduly PHP widoczne w repozytorium Remi dla danej
# wersji (pakiety phpXX-php-*), nie jakas z gory ustalona liste - "wszystko
# co widzi system", jak chcial user. Jeden wiersz na modul: "<sufiks
# po phpXX-php-> installed" albo "... available".
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

dnf -q repoquery --qf '%{name}' "php${VERSION}-php-*" 2>/dev/null | sort -u | while read -r pkg; do
  [[ "$pkg" == "${PREFIX}"* ]] || continue
  suffix="${pkg#"$PREFIX"}"
  [[ "$PROTECTED" == *" ${suffix} "* ]] && continue
  if rpm -q "$pkg" >/dev/null 2>&1; then
    echo "${suffix} installed"
  else
    echo "${suffix} available"
  fi
done
