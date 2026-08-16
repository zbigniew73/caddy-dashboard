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
# Na stdout (poza pierwsza linia OK:...) trzy dodatkowe linie:
#   RECORD_NAME=<selektor>._domainkey.<domena>
#   RECORD_VALUE=<pelna tresc rekordu TXT, jedna linia, BEZ cudzyslowow>
#   RECORD_VALUE_RAW=<ta sama tresc, ALE w oryginalnym formacie BIND z
#     opendkim-genkey - kazdy fragment <=255 znakow we WLASNYCH
#     cudzyslowach, oddzielone spacja (np. "v=DKIM1; k=rsa; p=AAAA..."
#     "BBBB...") - niektorzy dostawcy DNS wymagaja WLASNIE tego formatu
#     (pole akceptujace "surowy" wpis strefy), a nie plaskiego stringu bez
#     cudzyslowow z RECORD_VALUE. User zglosil 2026-08-16, ze plaski string
#     nie dzialal u jego dostawcy.
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
  local flat record_value record_value_raw
  # Zrodlo prawdy: PELNA, DOKLADNA konkatenacja bez zadnego separatora
  # (dokladnie tak jak DNS TXT semantycznie sklada wiele wewnetrznych
  # character-stringow w jedna wartosc - konkatenacja bajt-w-bajt, bez
  # wstawionego znaku). Podzial na fragmenty w PLIKU opendkim-genkey (ile
  # ich jest i gdzie dokladnie przebiega granica) to WYLACZNIE decyzja tego
  # konkretnego narzedzia/wersji przy zapisie - RÓŻNE klucze/wersje daja
  # RÓŻNY podzial tego samego, poprawnego rekordu (potwierdzone na zywym
  # serwerze 2026-08-16: user dostal 3 fragmenty z osobnym
  # '"v=DKIM1; k=rsa; "', a oczekiwal 2 fragmentow ze zlaczonym tagiem+
  # poczatkiem klucza - OBA byly poprawnymi rekordami TXT, ale niespojnymi
  # miedzy soba). Dlatego NIE powielamy podzialu z pliku - liczymy WLASNY,
  # deterministyczny podzial od zera (patrz record_value_raw nizej), zeby
  # kazde wywolanie dawalo ta sama, przewidywalna strukture niezaleznie od
  # tego jak akurat opendkim-genkey zapisal plik.
  flat="$(grep -o '"[^"]*"' "${KEY_DIR}/${SELECTOR}.txt" | sed 's/^"//;s/"$//' | tr -d '\n')"
  [ -n "$flat" ] || err "nie udalo sie odczytac rekordu DKIM z ${KEY_DIR}/${SELECTOR}.txt."
  # Do WYSWIETLENIA (pole "Wartosc") - czytelnosc, spacja na kazdej
  # granicy 255-znakowego kawalka (fold -w255, jak przy RAW ponizej, tylko
  # bez cudzyslowow) - user zglosil 2026-08-16, ze zlepione bez separatora
  # bylo nieczytelne.
  record_value="$(printf '%s' "$flat" | fold -w255 | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
  # Do KOPIOWANIA (przycisk "Kopiuj DKIM") - prawdziwy format BIND: kazdy
  # <=255-znakowy kawalek WLASNYCH cudzyslowach, oddzielone spacja. `fold
  # -w255` (NIE -s, ktore dzielilo by na granicach slow) - baza64 nie ma
  # "slow", dokladnie tak samo tnie to realny DNS przy budowaniu wielu
  # character-stringow w jednym rekordzie TXT.
  record_value_raw="$(printf '%s' "$flat" | fold -w255 | sed 's/^/"/;s/$/"/' | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
  echo "RECORD_NAME=${SELECTOR}._domainkey.${DOMAIN}"
  echo "RECORD_VALUE=${record_value}"
  echo "RECORD_VALUE_RAW=${record_value_raw}"
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

# SAMONAPRAWCZE: InternalHosts/ExternalIgnoreList brakowaly w mail-install.sh
# sprzed tej poprawki - bez nich opendkim TYLKO weryfikuje poczte, nigdy nie
# PODPISUJE wychodzacej z localhost (milter widzi kazde polaczenie jako
# "zewnetrzne"). Instalacje sprzed tej poprawki maja klucz wygenerowany, ale
# realnie nic nie podpisuja - dopisz brakujaca konfiguracje tutaj tez, zeby
# ponowne klikniecie "Zainstaluj DKIM"/"Sprawdz ponownie" naprawilo juz
# dzialajacy serwer bez pelnej reinstalacji Poczty.
OPENDKIM_CONF="/etc/opendkim.conf"
TRUSTED_HOSTS="/etc/opendkim/TrustedHosts"
OPENDKIM_CHANGED=""
if [ ! -f "$TRUSTED_HOSTS" ]; then
  printf '127.0.0.1\n::1\nlocalhost\n' > "$TRUSTED_HOSTS"
  OPENDKIM_CHANGED="1"
fi
if ! grep -q '^InternalHosts[[:space:]]' "$OPENDKIM_CONF" 2>/dev/null; then
  echo "InternalHosts refile:${TRUSTED_HOSTS}" >> "$OPENDKIM_CONF"
  OPENDKIM_CHANGED="1"
fi
if ! grep -q '^ExternalIgnoreList[[:space:]]' "$OPENDKIM_CONF" 2>/dev/null; then
  echo "ExternalIgnoreList refile:${TRUSTED_HOSTS}" >> "$OPENDKIM_CONF"
  OPENDKIM_CHANGED="1"
fi

# SAMONAPRAWCZE: Socket "inet:8891@localhost" (stara wersja mail-install.sh)
# -> "inet:8891@127.0.0.1" (literal IP). Postfixowe stanze submission/smtps
# maja chroot=y i NIE POTRAFIA rozwiazac nazwy "localhost" (brak
# /etc/hosts/resolvera w chroocie /var/spool/postfix) - milter sie nie
# laczy ("Cannot assign requested address"), a milter_default_action =
# accept po cichu przepuszcza wiadomosc BEZ PODPISU. Postfixowa strona
# (smtpd_milters/non_smtpd_milters) jest naprawiana analogicznie w
# postfix-set-limits.sh - oba trzeba naprawic razem (klikniecie "Zapisz"
# na Postfix - ustawienia ORAZ ponowne "Zainstaluj DKIM"/"Sprawdz
# ponownie" tutaj).
if grep -q '^Socket[[:space:]].*localhost' "$OPENDKIM_CONF" 2>/dev/null; then
  sed -i 's|^Socket[[:space:]].*|Socket inet:8891@127.0.0.1|' "$OPENDKIM_CONF"
  OPENDKIM_CHANGED="1"
fi

# SAMONAPRAWCZE: SigningTable bez prefiksu "refile:" -> wpis wildcard
# "*@domena" jest CICHO ignorowany (tryb "file:" nie obsluguje wildcardow) -
# log pokazuje "no signing table match for 'user@domena'" mimo poprawnego
# wpisu w tabeli. Bez "refile:" nic sie NIGDY nie podpisze, niezaleznie od
# tresci SigningTable.
if grep -q '^SigningTable[[:space:]]/etc/opendkim/SigningTable' "$OPENDKIM_CONF" 2>/dev/null; then
  sed -i 's|^SigningTable[[:space:]]/etc/opendkim/SigningTable|SigningTable refile:/etc/opendkim/SigningTable|' "$OPENDKIM_CONF"
  OPENDKIM_CHANGED="1"
fi

# SAMONAPRAWCZE (uprawnienia, NIEZALEZNIE od OPENDKIM_CHANGED powyzej):
# demon dziala jako opendkim:opendkim, nie root, i nie nalezy do grupy
# "root" - na tym serwerze umask roota dawal 640/750 (nieczytelne dla
# opendkim) na TrustedHosts/KeyTable/SigningTable/katalogu kluczy,
# co powodowalo "dkimf_db_open(): Permission denied" i opendkim w ogole
# nie startowal (status 78/CONFIG). Ustawiane bezwarunkowo przy KAZDYM
# uruchomieniu - tanie, zawsze bezpieczne, naprawia juz zle utworzone
# pliki bez potrzeby ich usuwania. Zaden z tych plikow nie zawiera
# materialu klucza (tylko sciezki/nazwy), wiec swiatoczytelnosc jest OK -
# sam prywatny klucz .private ma osobny, wlasciwy chmod 640 opendkim:opendkim
# nizej.
chmod 644 "$TRUSTED_HOSTS" 2>/dev/null || true
chmod 644 "$KEY_TABLE" "$SIGNING_TABLE" 2>/dev/null || true
mkdir -p /etc/opendkim/keys
chmod 755 /etc/opendkim/keys 2>/dev/null || true

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
elif [ -n "$OPENDKIM_CHANGED" ]; then
  echo "OK: klucz DKIM (selektor ${SELECTOR}) dla ${DOMAIN} juz istnial - dopisano brakujaca konfiguracje InternalHosts/ExternalIgnoreList (poprzednio opendkim tylko weryfikowal, nie podpisywal), opendkim przeladowany."
else
  echo "OK: klucz DKIM (selektor ${SELECTOR}) dla ${DOMAIN} juz istnial - dopisano ewentualnie brakujace wpisy, opendkim przeladowany."
fi
print_record
