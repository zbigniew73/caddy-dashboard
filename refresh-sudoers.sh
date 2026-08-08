#!/usr/bin/env bash
#
# Szybka aktualizacja /etc/sudoers.d/caddy-dashboard bez pelnej reinstalacji.
# Uzyj tego zamiast ponownego uruchamiania install.sh, gdy nowa wersja
# panelu dodaje nowa funkcje wymagajaca uprawnien sudo (dostaniesz w
# panelu blad typu "Brak uprawnien sudo bez hasla dla ..."), a masz juz
# dzialajaca instalacje.
#
# Uzycie: cd /opt/caddy-dashboard && sudo ./refresh-sudoers.sh

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Uruchom jako root: sudo ./refresh-sudoers.sh" >&2
  exit 1
fi

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "${INSTALL_DIR}/caddy-dashboard.service" ]; then
  echo "BLAD: nie znaleziono ${INSTALL_DIR}/caddy-dashboard.service - uruchom najpierw pelny install.sh." >&2
  exit 1
fi

SVC_USER="$(grep '^User=' "${INSTALL_DIR}/caddy-dashboard.service" | cut -d= -f2)"

if [ -z "$SVC_USER" ] || [ "$SVC_USER" = "root" ]; then
  echo "OK: usluga dziala jako root - plik sudoers nie jest potrzebny, nic do zrobienia."
  exit 0
fi

INSTALL_DIR="$INSTALL_DIR" SVC_USER="$SVC_USER" "${INSTALL_DIR}/server/scripts/write-sudoers.sh"
