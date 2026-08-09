#!/usr/bin/env bash
#
# Wypisuje WSZYSTKIE pakiety php${VERSION}-* widoczne w repozytorium
# Remi dla danej wersji, bez wyjatku - dokladnie to co pokazuje
# `dnf search php84-*` uruchomione recznie po SSH (user tak to sprawdza,
# wiec panel ma widziec to samo, nie wezszy podzbior; user explicite
# potwierdzil "pokaz wszystkie php84-* bez wyjatku" po tym jak zapytal o
# brakujace php84-runtime/scldevel/syspaths/unit-php/uwsgi-plugin-php/
# xhprof). Jeden wiersz na pakiet: "<klucz> installed|available
# <pelna-nazwa-pakietu>.<arch>" - trzecie pole to dokladny identyfikator
# pakietu (np. "php84-php-pecl-zip.x86_64"), user chce widziec to samo co
# pokazuje `dnf` samo w sobie, wiec panel niczego tu nie upiekszamy.
#
# Klucz ma dwa warianty w zaleznosci od prefiksu nazwy pakietu (odczytywane
# z powrotem w php-toggle-module.sh, zeby install/remove trafialy w
# WLASCIWY pakiet, nie odgadniety):
#   - "phpXX-php-<reszta>"  -> klucz = "<reszta>"        (np. "zip", "pecl-zip")
#   - "phpXX-<reszta>"      -> klucz = "pkg-<reszta>"    (np. "pkg-runtime",
#                                                          "pkg-unit-php")
#
# Wyklucza z toggle'owania (patrz PROTECTED w php-toggle-module.sh, ta
# sama lista) fpm/cli/common oraz pkg-php/pkg-build/pkg-runtime/
# pkg-scldevel/pkg-syspaths - to nie sa "moduly" tylko fundament/rusztowanie
# samej instalacji SCL (usuniecie ktoregokolwiek zepsuloby cala usluge, nie
# pojedyncze rozszerzenie), ale POKAZUJEMY je w tabeli (bez przyciskow
# akcji po stronie Node/frontu) - user chcial widziec wszystko jawnie.
#
# UWAGA: dokladna komenda repoquery wymaga zweryfikowania na prawdziwym
# AlmaLinux/Rocky (ten skrypt nie moze byc przetestowany na maszynie
# deweloperskiej).

set -uo pipefail

VERSION="${1:-}"
[[ "$VERSION" =~ ^[0-9]{2}$ ]] || { echo "BLAD: nieprawidlowy format wersji: '${VERSION}' (oczekiwano dwoch cyfr, np. 85)." >&2; exit 1; }

PREFIX="php${VERSION}-php-"
BASE_PREFIX="php${VERSION}-"

dnf -q repoquery --qf '%{name} %{arch}' "php${VERSION}-*" 2>/dev/null | sort -u -k1,1 | while read -r pkg arch; do
  if [[ "$pkg" == "${PREFIX}"* ]]; then
    key="${pkg#"$PREFIX"}"
  elif [[ "$pkg" == "${BASE_PREFIX}"* ]]; then
    key="pkg-${pkg#"$BASE_PREFIX"}"
  else
    continue
  fi
  if rpm -q "$pkg" >/dev/null 2>&1; then
    echo "${key} installed ${pkg}.${arch}"
  else
    echo "${key} available ${pkg}.${arch}"
  fi
done
