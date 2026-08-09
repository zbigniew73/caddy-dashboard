#!/usr/bin/env bash
#
# Idempotentnie dodaje repozytorium static-php (rpm.henderkes.com) -
# wymagane dla FrankenPHP + PHP ZTS. To jest CALKOWICIE OSOBNE repo/pakiet
# od EPEL/Remi uzywanego przez zwykle PHP-FPM
# (server/runtime-manager/scripts/remi-setup-repos.sh) - PHP-FPM (Remi)
# zostaje nietkniete, to jest drugi, rownolegly runtime PHP.
#
# UWAGA: dokladna nazwa zainstalowanego pakietu wymaga zweryfikowania na
# prawdziwym AlmaLinux/Rocky - `rpm -q static-php` ponizej zaklada nazwe
# pakietu pochodna z nazwy pliku RPM ("static-php-1-0.noarch.rpm"), ale
# NIE zostalo to potwierdzone na zywym systemie (ten skrypt nie moze byc
# przetestowany na maszynie deweloperskiej).

set -euo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

rpm -q static-php >/dev/null 2>&1 \
  || dnf install -y https://rpm.henderkes.com/static-php-1-0.noarch.rpm \
  || err "Instalacja repozytorium static-php nie powiodla sie."

echo "OK: repozytorium static-php wlaczone."
