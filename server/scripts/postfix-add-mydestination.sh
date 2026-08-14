#!/usr/bin/env bash
#
# Dopisuje domene do `mydestination` Postfixa (lista domen, dla ktorych
# Postfix przyjmuje poczte jako WLASNA i dorecza lokalnie - kazdy lokalny
# uzytkownik systemowy staje sie wtedy osiagalny jako <user>@<ta domena>,
# dokladnie ten sam mechanizm co juz dzialajacy <user>@localhost).
# Idempotentne - jesli domena juz jest na liscie, nic nie robi.
#
# NIE nadpisuje calej wartosci - dopisuje do istniejacej listy (czyta
# `postconf -h mydestination` PRZED zmiana), zeby nie zgubic domyslnych
# wpisow Postfixa ($myhostname, localhost.$mydomain, localhost).
#
# Walidacja (`postfix check`) PRZED przeladowaniem, rollback do
# poprzedniej wartosci jesli sie nie powiedzie.
#
# Uzycie: postfix-add-mydestination.sh <domena>

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

DOMAIN="${1:-}"
[[ "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$ ]] || err "nieprawidlowa domena: '${DOMAIN}'"

CURRENT="$(postconf -h mydestination 2>/dev/null || true)"
[ -n "$CURRENT" ] || err "nie udalo sie odczytac obecnej wartosci mydestination - czy Postfix jest zainstalowany?"

IFS=',' read -ra PARTS <<< "$CURRENT"
for p in "${PARTS[@]}"; do
  trimmed="$(echo "$p" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  if [ "$trimmed" = "$DOMAIN" ]; then
    echo "OK: ${DOMAIN} jest juz w mydestination, nic nie zmieniono."
    exit 0
  fi
done

NEW="${CURRENT}, ${DOMAIN}"
postconf -e "mydestination=${NEW}"

if ! postfix check 2>/tmp/postfix-add-mydestination.err; then
  MSG="$(cat /tmp/postfix-add-mydestination.err 2>/dev/null)"
  rm -f /tmp/postfix-add-mydestination.err
  postconf -e "mydestination=${CURRENT}"
  err "Nowa wartosc mydestination nie przeszla 'postfix check': ${MSG} - przywrocono poprzednia wartosc."
fi
rm -f /tmp/postfix-add-mydestination.err

if ! systemctl reload postfix 2>/tmp/postfix-add-mydestination.err; then
  MSG="$(cat /tmp/postfix-add-mydestination.err 2>/dev/null)"
  rm -f /tmp/postfix-add-mydestination.err
  postconf -e "mydestination=${CURRENT}"
  systemctl reload postfix >/dev/null 2>&1 || true
  err "Przeladowanie postfix z nowa wartoscia mydestination nie powiodlo sie: ${MSG} - przywrocono poprzednia wartosc."
fi
rm -f /tmp/postfix-add-mydestination.err

echo "OK: ${DOMAIN} dodana do mydestination, postfix przeladowany."
