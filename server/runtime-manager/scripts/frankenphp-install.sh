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

frankenphp version >/dev/null 2>&1 \
  || err "Instalacja zakonczona, ale 'frankenphp version' zwrocilo blad."

frankenphp php-cli -v >/dev/null 2>&1 \
  || err "Instalacja zakonczona, ale 'frankenphp php-cli -v' zwrocilo blad (PHP ZTS ${VERSION} moze nie byc poprawnie wlaczone)."

echo "OK: FrankenPHP + PHP ${VERSION} ZTS zainstalowane. Usluga systemd NIE zostala uruchomiona automatycznie."
