#!/usr/bin/env bash
#
# Instaluje FrankenPHP + wybrany strumien PHP ZTS (VERSION w formacie
# X.Y, np. "8.5" -> modul php-zts:static-8.5). Idempotentne - bezpieczne
# do ponownego uruchomienia. Zaklada, ze repozytorium static-php juz jest
# wlaczone (frankenphp-setup-repo.sh, wolane osobno PRZED tym skryptem
# przez routes/frankenphp.js), tak samo jak php-install.sh zaklada
# wczesniejsze remi-setup-repos.sh.
#
# Celowo NIE uruchamia/wlacza uslugi systemd frankenphp na koncu (w
# przeciwienstwie do php-install.sh, ktore od razu robi `systemctl enable
# --now` dla php-fpm) - user'a wlasny research material jasno odradza
# uruchamianie uslugi FrankenPHP zanim integracja z Caddy zostanie
# przemyslana (moze dzialac jako wlasny serwer WWW, kolidujac z
# istniejacym Caddy na tym samym porcie). Instalacja konczy sie na
# weryfikacji, ze binarka dziala - uruchomienie uslugi to osobny, reczny
# krok z zakladki Uslugi.

set -euo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

VERSION="${1:-}"
[[ "$VERSION" =~ ^[0-9]\.[0-9]$ ]] || err "Nieprawidlowy format wersji: '${VERSION}' (oczekiwano X.Y, np. 8.5)."

STREAM="static-${VERSION}"

dnf module enable -y "php-zts:${STREAM}" \
  || err "Wlaczenie modulu php-zts:${STREAM} nie powiodlo sie."

dnf install -y frankenphp \
  || err "Instalacja pakietu frankenphp nie powiodla sie."

command -v frankenphp >/dev/null 2>&1 \
  || err "Instalacja zakonczona, ale binarka frankenphp nie zostala znaleziona w PATH."

# `frankenphp php-cli -v` NIE dziala jak zwykle `php -v` - podkomenda
# "php-cli" uruchamia PHP skrypt/kod (jak `php <plik>`), wiec `-v` jest
# interpretowane jako nazwa pliku do wykonania, nie flaga ("Failed opening
# required '-v'") - potwierdzone na zywym serwerze (2026-08-09). Zamiast
# tego `frankenphp version` samo w sobie wypisuje podlinkowana wersje PHP
# w formacie "FrankenPHP vX.Y.Z PHP A.B Caddy vC.D.E ..." - to jest
# pewny, bezposredni dowod ze wybrany strumien ZTS zostal poprawnie
# podlinkowany, bez potrzeby zgadywania skladni php-cli.
VERSION_OUTPUT="$(frankenphp version 2>&1)" \
  || err "Instalacja zakonczona, ale 'frankenphp version' zwrocilo blad."

echo "$VERSION_OUTPUT" | grep -q "PHP ${VERSION}" \
  || err "Instalacja zakonczona, ale 'frankenphp version' nie pokazuje PHP ${VERSION} ZTS (wyjscie: ${VERSION_OUTPUT}) - modul php-zts:static-${VERSION} moze nie byc poprawnie wlaczony."

echo "OK: FrankenPHP + PHP ${VERSION} ZTS zainstalowane (${VERSION_OUTPUT}). Usluga systemd NIE zostala uruchomiona automatycznie."
