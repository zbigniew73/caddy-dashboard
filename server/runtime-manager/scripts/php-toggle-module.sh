#!/usr/bin/env bash
#
# Wlacza/wylacza jeden modul PHP (dnf install/remove pakietu
# phpXX-php-<modul>), przeladowuje phpXX-php-fpm, weryfikuje ze usluga
# dalej dziala. Modul nie jest walidowany tutaj wzgledem whitelisty -
# to juz zrobil server/runtime-manager/routes/php.js PRZED wywolaniem
# tego skryptu (patrz MODULE_WHITELIST tam) - tu tylko podstawowa
# walidacja formatu, zeby nie przekazac czegos ewidentnie zlego.
#
# Brak tu proby "rollbacku" usuniecia pakietu (w przeciwienstwie do
# php-set-settings.sh/php-set-opcache.sh) - cofanie dnf remove
# automatycznym ponownym install jest bardziej ryzykowne niz przywrocenie
# pliku ini z kopii, wiec przy awarii po zmianie tylko jasno o tym
# informujemy, bez automatycznej naprawy.

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

VERSION="${1:-}"
MODULE="${2:-}"
ACTION="${3:-}"

[[ "$VERSION" =~ ^[0-9]{2}$ ]] || err "Nieprawidlowy format wersji: '${VERSION}' (oczekiwano dwoch cyfr, np. 85)."
[[ "$MODULE" =~ ^[a-z0-9_-]+$ ]] || err "Nieprawidlowa nazwa modulu: '${MODULE}'."
[[ "$ACTION" == "install" || "$ACTION" == "remove" ]] || err "Nieznana akcja: '${ACTION}' (oczekiwano install/remove)."

PKG="php${VERSION}-php-${MODULE}"
SERVICE="php${VERSION}-php-fpm"

if [ "$ACTION" = "install" ]; then
  dnf install -y "$PKG" || err "Instalacja pakietu ${PKG} nie powiodla sie."
else
  dnf remove -y "$PKG" || err "Usuniecie pakietu ${PKG} nie powiodlo sie."
fi

systemctl reload "$SERVICE" || err "${PKG}: ${ACTION} zakonczone, ale przeladowanie ${SERVICE} nie powiodlo sie."

LIVE=""
for _ in 1 2 3; do
  if systemctl is-active --quiet "$SERVICE"; then
    LIVE=1
    break
  fi
  sleep 1
done
[ -n "$LIVE" ] || err "${SERVICE} nie dziala poprawnie po ${ACTION} pakietu ${PKG} - sprawdz recznie (dziennik: journalctl -u ${SERVICE})."

echo "OK: ${PKG} (${ACTION}), ${SERVICE} przeladowany i dziala."
