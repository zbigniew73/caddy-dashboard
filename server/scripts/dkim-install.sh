#!/usr/bin/env bash
#
# Generuje klucz DKIM (opendkim-genkey, RSA 2048) dla podanej domeny,
# selektor na sztywno "mail" (prosty, powszechny wybor - nie kolejny
# parametr do wyboru). Dopisuje wpisy do KeyTable/SigningTable OpenDKIM
# (puste od mail-install.sh - Faza 1 celowo nie generowala kluczy, patrz
# komentarz tam).
#
# Idempotentne - jesli klucz dla tej domeny+selektora juz istnieje, NIE
# generuje nowego (nowy klucz uniewazniby juz opublikowany rekord DNS
# admina bez ostrzezenia) - tylko dopisuje ewentualnie brakujace wpisy
# KeyTable/SigningTable i zwraca ISTNIEJACY rekord.
#
# /etc/opendkim/keys nie jest world-readable (wlasciciel/grupa
# "opendkim"), wiec nawet SAM ODCZYT gotowego rekordu wymaga roota -
# stad akcja "status" (bez zadnych zmian) TEZ idzie przez ten sam,
# uprzywilejowany skrypt, nie osobny bezposredni odczyt z Node.
#
# Uzycie:
#   dkim-install.sh install <domena>   - generuje (jesli trzeba) + zwraca rekord
#   dkim-install.sh status <domena>    - TYLKO odczyt, bez generowania
# Na stdout (poza pierwsza linia OK:...) dwie dodatkowe linie:
#   RECORD_NAME=<selektor>._domainkey.<domena>
#   RECORD_VALUE=<pelna tresc rekordu TXT, jedna linia>
# Jesli status i klucza jeszcze nie ma: tylko "MISSING" na stdout.

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

ACTION="${1:-}"
DOMAIN="${2:-}"
SELECTOR="mail"

[ "$ACTION" = "install" ] || [ "$ACTION" = "status" ] || err "nieznana akcja '${ACTION}' (oczekiwano install|status)."
[[ "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$ ]] || err "nieprawidlowa domena: '${DOMAIN}'"

KEY_DIR="/etc/opendkim/keys/${DOMAIN}"
KEY_TABLE="/etc/opendkim/KeyTable"
SIGNING_TABLE="/etc/opendkim/SigningTable"

print_record() {
  local record_value
  record_value="$(grep -o '"[^"]*"' "${KEY_DIR}/${SELECTOR}.txt" | sed 's/^"//;s/"$//' | tr -d '\n' | tr -s ' ')"
  [ -n "$record_value" ] || err "nie udalo sie odczytac rekordu DKIM z ${KEY_DIR}/${SELECTOR}.txt."
  echo "RECORD_NAME=${SELECTOR}._domainkey.${DOMAIN}"
  echo "RECORD_VALUE=${record_value}"
}

if [ "$ACTION" = "status" ]; then
  if [ -f "${KEY_DIR}/${SELECTOR}.txt" ]; then
    echo "OK: klucz DKIM (selektor ${SELECTOR}) dla ${DOMAIN} juz istnieje."
    print_record
  else
    echo "MISSING"
  fi
  exit 0
fi

[ -f "$KEY_TABLE" ] && [ -f "$SIGNING_TABLE" ] || err "brak ${KEY_TABLE}/${SIGNING_TABLE} - Poczta (OpenDKIM) jest jeszcze niezainstalowana."

# SAMONAPRAWCZE: opendkim-genkey zyje w OSOBNYM podpakiecie EPEL
# (opendkim-tools), ktorego mail-install.sh sprzed tej poprawki nie
# instalowal - na instalacjach Poczty sprzed niej sam "opendkim" jest,
# ale narzedzia (genkey/testkey) nie. Zamiast tylko sie skarzyc,
# doinstaluj i sprobuj ponownie - nie trzeba ponownego klikania
# "Zainstaluj" w zakladce Instalator.
if ! command -v opendkim-genkey >/dev/null 2>&1; then
  dnf install -y opendkim-tools >/dev/null 2>&1 || true
fi
command -v opendkim-genkey >/dev/null 2>&1 || err "brak polecenia opendkim-genkey nawet po probie doinstalowania opendkim-tools - sprawdz recznie (dnf install opendkim-tools)."

mkdir -p "$KEY_DIR"

GENERATED=""
if [ ! -f "${KEY_DIR}/${SELECTOR}.private" ] || [ ! -f "${KEY_DIR}/${SELECTOR}.txt" ]; then
  opendkim-genkey -b 2048 -d "$DOMAIN" -D "$KEY_DIR" -s "$SELECTOR" -v \
    || err "opendkim-genkey nie powiodlo sie."

  OPENDKIM_GROUP="$(id -gn opendkim 2>/dev/null)"
  if [ -n "$OPENDKIM_GROUP" ]; then
    chown "opendkim:${OPENDKIM_GROUP}" "${KEY_DIR}/${SELECTOR}.private" "${KEY_DIR}/${SELECTOR}.txt" 2>/dev/null || true
  fi
  chmod 640 "${KEY_DIR}/${SELECTOR}.private"
  GENERATED="1"
fi

if ! grep -qF "${SELECTOR}._domainkey.${DOMAIN} " "$KEY_TABLE" 2>/dev/null; then
  echo "${SELECTOR}._domainkey.${DOMAIN} ${DOMAIN}:${SELECTOR}:${KEY_DIR}/${SELECTOR}.private" >> "$KEY_TABLE"
fi

if ! grep -qF "*@${DOMAIN} " "$SIGNING_TABLE" 2>/dev/null; then
  echo "*@${DOMAIN} ${SELECTOR}._domainkey.${DOMAIN}" >> "$SIGNING_TABLE"
fi

if ! systemctl restart opendkim 2>/tmp/dkim-install.err; then
  MSG="$(cat /tmp/dkim-install.err 2>/dev/null)"
  rm -f /tmp/dkim-install.err
  err "Restart opendkim z nowym kluczem nie powiodl sie: ${MSG}"
fi
rm -f /tmp/dkim-install.err

if [ -n "$GENERATED" ]; then
  echo "OK: nowy klucz DKIM (selektor ${SELECTOR}) dla ${DOMAIN} wygenerowany, opendkim przeladowany."
else
  echo "OK: klucz DKIM (selektor ${SELECTOR}) dla ${DOMAIN} juz istnial - dopisano ewentualnie brakujace wpisy, opendkim przeladowany."
fi
print_record
