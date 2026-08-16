#!/usr/bin/env bash
#
# Instaluje Postfix + Dovecot + OpenDKIM (stabilne, systemowe wersje -
# bez dodatkowego repozytorium, jak MariaDB "local"/Redis "local").
# Idempotentny - bezpieczny do ponownego uruchomienia.
#
# FAZA 1 (swiadomie ograniczony zakres - reszta to kolejne kroki):
# - Jedna skrzynka (~/Maildir) na konto hostingowe, NIE pelny system
#   wirtualnych skrzynek per-domena jak DirectAdmin (~/imap/<domena>/...) -
#   logowanie tym samym haslem co SSH (Dovecot auth przez PAM, zero
#   nowego magazynu hasel).
# - IMAP/IMAPS + SMTP/SMTPS - BEZ POP3/POP3S (explicite: "protocols = imap"
#   w Dovecocie, brak portow 110/995 w firewallu).
# - OpenDKIM zainstalowany i podpiety jako milter do Postfixa, ale BEZ
#   kluczy per-domena (KeyTable/SigningTable puste) - milter przepuszcza
#   wszystko czysto, nic nie jest jeszcze podpisywane. Generowanie kluczy
#   per-domena to OSOBNY, przyszly krok.
# - TLS: self-signed certyfikat wygenerowany tutaj, JAWNIE tymczasowy -
#   klienci pocztowi pokaza ostrzezenie, dopoki admin nie podmieni go na
#   prawdziwy certyfikat domeny mailowej (przyszly krok).
#
# Uzycie: mail-install.sh [wykryta_domena_bazowa_panelu]
#   Argument opcjonalny - jesli podany, uzywany do zbudowania warunkowego
#   auth_username_format (patrz nizej przy 90-caddy-dashboard.conf). Jesli
#   pominiety/pusty, samonaprawa w dovecot-set-limits.sh uzupelni go
#   pozniej, gdy tylko domena bazowa bedzie znana.

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

BASE_DOMAIN="${1:-}"
# %n = obcina wszystko od "@" (potrzebne dla PAM, ktory zna tylko gole
# nazwy systemowe) - ALE globalne, bezwarunkowe %n zabija tez %d (domene)
# dla PRZYSZLYCH wirtualnych skrzynek (SQL passdb nizej), bo
# auth_username_format jest stosowany PRZED zbudowaniem %u dla WSZYSTKICH
# passdb/userdb, nie tylko PAM. %{if;%d;eq;<domena>;%n;%u} rozwiazuje to:
# dla logowania w domenie panelu (system/PAM) uzywa golej nazwy (%n), dla
# kazdej innej domeny (wirtualne skrzynki klientow) zachowuje pelny adres
# (%u), zeby %d/%n byly nadal dostepne dla zapytania SQL. Skladnia
# %{if;...} dostepna od Dovecota 2.2.33 (potwierdzone w dokumentacji
# 2026-08-14) - bezpieczna na AlmaLinux/Rocky 9 (2.3.16) i 10 (2.3.21+).
if [ -n "$BASE_DOMAIN" ]; then
  AUTH_USERNAME_FORMAT="%{if;%d;eq;${BASE_DOMAIN};%n;%u}"
else
  AUTH_USERNAME_FORMAT='%n'
fi

getent group mail >/dev/null 2>&1 || err "Systemowa grupa 'mail' nie istnieje - nietypowa instalacja AlmaLinux/Rocky."

# opendkim-tools to OSOBNY podpakiet w EPEL (sam "opendkim" ma tylko
# demona) - opendkim-genkey/opendkim-testkey zyja tam, nie w glownym
# pakiecie. Bez tego dkim-install.sh (przycisk "Zainstaluj DKIM" w
# panelu) failuje "brak polecenia opendkim-genkey" - potwierdzone na
# zywym serwerze 2026-08-14.
dnf install -y postfix dovecot opendkim opendkim-tools || err "Instalacja pakietow (postfix, dovecot, opendkim, opendkim-tools) nie powiodla sie."

# Sterowniki mysql dla Postfixa/Dovecota (wirtualne domeny/skrzynki na
# MariaDB, patrz sekcja nizej) - dokladne nazwy pakietow/sciezki
# sterownikow NIE byly (jeszcze) potwierdzone na zywym serwerze (w
# odroznieniu od dovecot-sqlite ktore mielismy zweryfikowane 2026-08-14,
# przed przejsciem wirtualnych skrzynek z SQLite na MariaDB) - ten sam
# defensywny wzorzec: probujemy zainstalowac pakiet, ale prawdziwym testem
# jest obecnosc samego sterownika, NIE exit code dnf. Jesli te sciezki
# okaza sie bledne na konkretnej wersji EL, `rpm -ql postfix-mysql` /
# `rpm -ql dovecot-mysql` (albo `rpm -ql dovecot | grep mysql`, gdyby
# sterownik byl wbudowany jak przy sqlite) pokaze prawdziwa lokalizacje -
# poprawic tu.
dnf install -y postfix-mysql >/dev/null 2>&1 || true
POSTFIX_MYSQL_DRIVER="$(find /usr/lib64/postfix -maxdepth 1 -iname '*mysql*' 2>/dev/null | head -n1)"
[ -n "$POSTFIX_MYSQL_DRIVER" ] \
  || err "Brak sterownika mysql dla Postfixa - sprawdz recznie: rpm -ql postfix-mysql, albo dnf provides '*/postfix-mysql'."

dnf install -y dovecot-mysql >/dev/null 2>&1 || true
DOVECOT_MYSQL_DRIVER="/usr/lib64/dovecot/libdriver_mysql.so"
[ -e "$DOVECOT_MYSQL_DRIVER" ] \
  || err "Brak sterownika mysql dla Dovecota (${DOVECOT_MYSQL_DRIVER}) - sprawdz recznie: rpm -ql dovecot | grep mysql."

# --- TLS: self-signed cert (tymczasowy, patrz komentarz na gorze) ---
CERT_FILE="/etc/pki/tls/certs/mail-selfsigned.crt"
KEY_FILE="/etc/pki/tls/private/mail-selfsigned.key"
if [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; then
  openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    -keyout "$KEY_FILE" -out "$CERT_FILE" \
    -subj "/CN=$(hostname -f 2>/dev/null || hostname)" \
    || err "Generowanie tymczasowego certyfikatu TLS nie powiodlo sie."
  chmod 600 "$KEY_FILE"
fi

# NIE nadpisuj bezwarunkowo aktywnego certyfikatu Let's Encrypt certem
# self-signed przy KAZDYM ponownym uruchomieniu tego skryptu (ten skrypt
# jest idempotentny/samonaprawiajacy sie i bywa odpalany ponownie np.
# przyciskiem "Sprawdz/zaktualizuj konfiguracje" po kazdej aktualizacji
# panelu) - bez tego sprawdzenia admin klikal "Wlacz" (mail-tls-swap.sh),
# a kolejne uruchomienie mail-install.sh po cichu cofalo TLS z powrotem na
# self-signed, mimo ze nic o tym nie mowilo. Zglosone przez usera
# 2026-08-15 ("po kazdej aktualizacji ... tymczasowy self-signed", mimo ze
# wczesniej klikal Wlacz). LE_CERT/LE_KEY musza byc IDENTYCZNE ze
# stalymi w mail-tls-swap.sh.
LE_CERT="/etc/pki/tls/certs/mail-letsencrypt.crt"
LE_KEY="/etc/pki/tls/private/mail-letsencrypt.key"
CURRENT_TLS_CERT="$(postconf -h smtpd_tls_cert_file 2>/dev/null || true)"
if [ "$CURRENT_TLS_CERT" = "$LE_CERT" ] && [ -f "$LE_CERT" ] && [ -f "$LE_KEY" ]; then
  ACTIVE_CERT_FILE="$LE_CERT"
  ACTIVE_KEY_FILE="$LE_KEY"
else
  ACTIVE_CERT_FILE="$CERT_FILE"
  ACTIVE_KEY_FILE="$KEY_FILE"
fi

# --- Dovecot: wlasny drop-in, NIE dotykamy plikow pakietu (bezpieczne na
# aktualizacje) - /etc/dovecot/conf.d/ laduje pliki alfabetycznie,
# pozniejszy nadpisuje wczesniejsze. ---
mkdir -p /etc/dovecot/conf.d
cat > /etc/dovecot/conf.d/90-caddy-dashboard.conf <<EOF
# Zarzadzane przez Caddy Dashboard - server/scripts/mail-install.sh
protocols = imap

mail_location = maildir:~/Maildir

mail_privileged_group = mail

ssl = required
ssl_cert = <${ACTIVE_CERT_FILE}
ssl_key = <${ACTIVE_KEY_FILE}

disable_plaintext_auth = yes

# PAM zna tylko GOLE nazwy uzytkownikow systemowych (np. "cdadmin"), nie
# "cdadmin@domena" - bez tego logowanie pelnym adresem (user@domena)
# zawsze by failowalo, mimo ze sam login "user" dziala. Warunkowy format
# (patrz komentarz przy BASE_DOMAIN na gorze skryptu) obcina domene TYLKO
# dla domeny panelu (PAM), zachowujac ja dla wirtualnych skrzynek (SQL).
auth_username_format = ${AUTH_USERNAME_FORMAT}

service auth {
  unix_listener /var/spool/postfix/private/auth {
    mode = 0660
    user = postfix
    group = postfix
  }
}
EOF

MAIL_DISABLED_LIST="/etc/dovecot/mail-disabled.list"
touch "$MAIL_DISABLED_LIST"
chmod 644 "$MAIL_DISABLED_LIST"

# Wlasny plik PAM Dovecota (NIE ten sam co SSH) - pam_listfile odrzuca
# logowanie kazdego uzytkownika wypisanego w mail-disabled.list (jeden
# login na linie, pusta lista = wszyscy maja dostep). Wlaczanie/wylaczanie
# per-konto: server/scripts/mail-toggle-access.sh (patrz tam po pelny
# opis mechanizmu i UWAGA o samonaprawie tej reguly na starszych
# instalacjach sprzed tej funkcji).
cat > /etc/pam.d/dovecot <<EOF
auth       include      system-auth
account    required     pam_listfile.so item=user sense=deny file=${MAIL_DISABLED_LIST} onerr=succeed
account    include      system-auth
session    include      system-auth
EOF

dovecot -n >/dev/null 2>&1 || err "Konfiguracja Dovecota (90-caddy-dashboard.conf) nie przeszla walidacji (dovecot -n)."

# --- Postfix: postconf -e (oficjalny, idempotentny mechanizm - main.cf) ---
# home_mailbox=Maildir/ - BEZ TEGO Postfix dorecza lokalna poczte do
# starego formatu mbox (/var/mail/<user>), a Dovecot/Roundcube czytaja z
# ~/Maildir (patrz mail_location wyzej) - dwa rozne miejsca, wiadomosc
# "dostarczona" wedlug Postfixa, ale niewidoczna dla odbiorcy. Potwierdzone
# na zywym serwerze 2026-08-14 (test cdadmin<->konto hostingowe, poczta
# znikala).
postconf -e "home_mailbox=Maildir/"
# Domyslny main.cf z pakietu RPM (AlmaLinux/Rocky) ma "inet_interfaces =
# localhost" (swiadomie bezpieczny stan przy instalacji) - bez tego
# Postfix NIGDY nie nasluchuje na publicznym interfejsie na porcie 25,
# tylko na 127.0.0.1/::1 (widac to w `ss -tlnp`), wiec ZADNA poczta
# przychodzaca z internetu nigdy nie dociera, mimo poprawnego DNS/MX i
# otwartego firewalla. Potwierdzone na zywym serwerze 2026-08-14 (Gmail
# odpowiedz do cdadmin@20z.eu nigdy nie dotarla).
postconf -e 'inet_interfaces = all'
postconf -e "smtpd_tls_cert_file=${ACTIVE_CERT_FILE}"
postconf -e "smtpd_tls_key_file=${ACTIVE_KEY_FILE}"
postconf -e 'smtpd_tls_security_level = may'

# --- SNI: certyfikaty TLS per "mail.<domena>" dla wlasnych domen mailowych
# klientow (Strony -> "Wlacz obsluge poczty" w panelu usera, patrz
# hostingUserSites.js buildMailStubBlock) - DODATKOWA, opcjonalna mapa
# obok pojedynczego domyslnego certu ustawionego wyzej (ktory zostaje
# FALLBACKIEM dla polaczen bez dopasowania SNI, np. bezposrednio po IP,
# oraz dla wlasnej domeny panelu). Mapa startuje PUSTA - wpisy dopisuje
# server/scripts/mail-sni-sync.sh za kazdym razem, gdy Caddy faktycznie
# wyda certyfikat Let's Encrypt dla kolejnej domeny mailowej klienta.
# Bootstrap TYLKO jesli plik jeszcze nie istnieje - mail-sni-sync.sh jest
# jedynym wlascicielem tresci tego pliku po pierwszym uruchomieniu, ten
# skrypt (idempotentny/re-runowalny) nie moze go nadpisywac pusta mapa
# przy kazdym ponownym uruchomieniu (dokladnie ten sam blad co certyfikat
# self-signed wyzej).
# lmdb: (NIE hash:/btree:) - na AlmaLinux/Rocky 10 Postfix jest budowany
# BEZ Berkeley DB (usunieta z bazowego systemu, problem licencyjny
# Oracle) - `postconf -m` na tym build'zie w ogole nie wymienia hash/
# btree wsrod dostepnych typow map. Potwierdzone na zywym serwerze
# 2026-08-15 realnym bledem "unsupported dictionary type: hash. Is the
# postfix-hash package installed?" - psulo TLS dla WSZYSTKICH polaczen
# (nie tylko SNI), bo Postfix nie moze otworzyc mapy = nie moze
# dokonczyc handshake'u. lmdb ma inne rozszerzenie pliku (.lmdb, NIE
# .db) - patrz tez virtual_mailbox_domains/-maps/virtual_alias_maps
# nizej, ten sam blad, ta sama poprawka.
#
# `postmap -F` (NIE goly `postmap`) - specyficzne WYLACZNIE dla
# tls_server_sni_maps: Postfix przy odczycie tego konkretnego parametru
# oczekuje wartosci zakodowanej w base64 (wewnetrzny mechanizm TLS-
# kontekstow), a `-F` to ten krok wlacza przy budowaniu mapy - bez niego
# (zwykle "postmap lmdb:plik") smtpd loguje "malformed BASE64 value" i
# odrzuca KAZDE polaczenie TLS proszace o SNI dla domeny w tej mapie
# (potwierdzone na zywym serwerze 2026-08-15, zrodlo:
# https://www.mail-archive.com/postfix-users@postfix.org/msg91707.html).
# Zwykle mapy tego projektu (virtual_mailbox_domains itd.) NIE potrzebuja
# -F - to wylacznie kwirk tls_server_sni_maps.
SNI_MAP_FILE="/etc/postfix/mail-sni-map"
if [ ! -f "$SNI_MAP_FILE" ]; then
  : > "$SNI_MAP_FILE"
  postmap -F lmdb:"$SNI_MAP_FILE" || err "postmap ${SNI_MAP_FILE} nie powiodlo sie."
  chmod 644 "$SNI_MAP_FILE" "${SNI_MAP_FILE}.lmdb" 2>/dev/null || true
fi
postconf -e "tls_server_sni_maps=lmdb:${SNI_MAP_FILE}"
# Dovecot: analogiczny, pusty plik z blokami "local_name { ssl_cert = ...
# ssl_key = ... }" per domena - regenerowany w calosci przez
# mail-sni-sync.sh (ten sam wzorzec co Postfixowa mapa wyzej). /etc/
# dovecot/conf.d/*.conf jest ladowany automatycznie (bez osobnej dyrektywy
# include), wiec sam fakt istnienia pliku wystarczy.
SNI_DOVECOT_FILE="/etc/dovecot/conf.d/92-caddy-dashboard-sni.conf"
if [ ! -f "$SNI_DOVECOT_FILE" ]; then
  printf '%s\n' '# Zarzadzane przez Caddy Dashboard - server/scripts/mail-sni-sync.sh' > "$SNI_DOVECOT_FILE"
  chmod 644 "$SNI_DOVECOT_FILE"
fi
postconf -e 'smtpd_sasl_type = dovecot'
postconf -e 'smtpd_sasl_path = private/auth'
postconf -e 'smtpd_sasl_auth_enable = yes'
postconf -e 'smtpd_relay_restrictions = permit_sasl_authenticated, permit_mynetworks, reject_unauth_destination'
postconf -e 'milter_default_action = accept'
postconf -e 'milter_protocol = 6'
# 127.0.0.1 (LITERAL IP), NIE "localhost" - stanze submission/smtps ponizej
# maja chroot=y (piate pole "y"), a proces w chroocie (/var/spool/postfix)
# nie ma /etc/hosts/resolvera, wiec NIE POTRAFI rozwiazac nazwy "localhost".
# Efekt: "warning: connect to Milter service inet:localhost:8891: Cannot
# assign requested address" - milter sie nie laczy, a milter_default_action
# = accept po cichu przepuszcza wiadomosc BEZ PODPISU, bez glosnego bledu
# w logach. Literal IP nie wymaga zadnego resolvowania nazw, wiec dziala
# tez w chroocie. Potwierdzone na zywym serwerze 2026-08-14.
#
# DOPISZ do istniejacej listy, NIE nadpisuj calej wartosci - ten skrypt
# (mail-install.sh) jest idempotentny/re-runowalny (np. przycisk "Sprawdz/
# zaktualizuj konfiguracje" w Poczta), a spamassassin-install.sh (jesli
# admin go wczesniej uruchomil) DOPISUJE tu WLASNY milter
# (inet:127.0.0.1:8893) OBOK tego OpenDKIM. Bezwarunkowe "postconf -e
# smtpd_milters=inet:127.0.0.1:8891" nadpisywalo CALA liste za kazdym
# re-runem tego skryptu, cicho usuwajac spamass-milter z lancucha (bez
# zadnego bledu - postfix check nadal przechodzi czysto, bo brakujacy
# milter to nie blad skladni) - user zglosil 2026-08-16 realny przypadek:
# SpamAssassin przestal skanowac poczte po tym, jak mail-install.sh zostal
# ponownie uruchomiony (przy okazji niepowiazanej migracji MariaDB) i po
# cichu wyrzucil spamass-milter, ktory wczesniej byl juz poprawnie
# dopiety. Ten sam wzorzec "dopisz-jesli-brak" co juz uzywany w
# spamassassin-install.sh dla tej samej pary parametrow.
DKIM_MILTER_ADDR="inet:127.0.0.1:8891"
for PARAM in smtpd_milters non_smtpd_milters; do
  CURRENT="$(postconf -h "$PARAM" 2>/dev/null || true)"
  if [[ "$CURRENT" != *"${DKIM_MILTER_ADDR}"* ]]; then
    if [ -n "$CURRENT" ]; then
      postconf -e "${PARAM}=${CURRENT}, ${DKIM_MILTER_ADDR}"
    else
      postconf -e "${PARAM}=${DKIM_MILTER_ADDR}"
    fi
  fi
done

# master.cf: dopisujemy WLASNE, kompletne stanze submission(587)/smtps(465)
# zamiast probowac odkomentowac szablon dostarczony z pakietem (rozny
# dokladny format miedzy wersjami postfixa/dystrybucji) - `postconf -M`
# to REALNY, autorytatywny odczyt aktywnej konfiguracji (nie dopasowanie
# tekstu), wiec dopisanie MIALO byc bezpiecznie idempotentne.
#
# BYL TU REALNY BLAD, potwierdzony na zywym serwerze 2026-08-15 (4x
# zduplikowane stanze submission/smtps w master.cf po samych 4
# uruchomieniach tego skryptu w ciagu jednej sesji): sprawdzenie
# `grep -q '^submission/inet'` NIGDY nie pasowalo, bo prawdziwy format
# `postconf -M` to "submission inet ..." (spacja miedzy nazwa a typem),
# NIE "submission/inet" (ten drugi zapis to `postconf -Mf`/inny kontekst,
# nie zwykle `postconf -M`) - w efekcie warunek zawsze wychodzil "nie ma
# jeszcze", wiec KAZDE ponowne uruchomienie (np. przycisk "Sprawdz/
# zaktualizuj konfiguracje") dopisywalo kolejna kopie. Naprawa: dopasuj
# WYLACZNIE pierwsze pole (nazwa uslugli), dokladnie, awk+grep -x -
# odporne na dowolna liczbe spacji/tabow w kolumnach wyjscia postconf.
if ! postconf -M 2>/dev/null | awk '{print $1}' | grep -qx submission; then
  cat >> /etc/postfix/master.cf <<'EOF'

submission inet n       -       y       -       -       smtpd
  -o syslog_name=postfix/submission
  -o smtpd_tls_security_level=encrypt
  -o smtpd_sasl_auth_enable=yes
  -o smtpd_relay_restrictions=permit_sasl_authenticated,reject
  -o smtpd_helo_restrictions=
EOF
fi
if ! postconf -M 2>/dev/null | awk '{print $1}' | grep -qx smtps; then
  cat >> /etc/postfix/master.cf <<'EOF'

smtps     inet  n       -       y       -       -       smtpd
  -o syslog_name=postfix/smtps
  -o smtpd_tls_wrappermode=yes
  -o smtpd_sasl_auth_enable=yes
  -o smtpd_relay_restrictions=permit_sasl_authenticated,reject
  -o smtpd_helo_restrictions=
EOF
fi
# Samonaprawa dla JUZ istniejacych instalacji (powyzsze dwa bloki dopisuja
# CALA stanze tylko przy PIERWSZYM zalozeniu - re-run tego skryptu na juz
# dzialajacej Poczcie NIGDY by nie dolozyl tej jednej nowej linii do
# stanzy zalozonej wczesniejsza wersja skryptu). `postconf -P` to
# oficjalny mechanizm edycji pojedynczych parametrow w master.cf per
# usluga, idempotentny (ustawienie tej samej wartosci ponownie nic nie
# zmienia). Powod: submission/smtps maja chroot=y (5te pole "y"), a
# /var/spool/postfix/etc/resolv.conf NIGDY nie zostal tam zmirrorowany na
# tym serwerze (potwierdzone na zywym serwerze 2026-08-15, pusty/brakujacy
# katalog) - wiec chrootowany smtpd nie ma zadnego dzialajacego resolwera
# DNS, a globalne smtpd_helo_restrictions (ustawiane przez postfix-
# antispam.sh) zawieraja reject_unknown_helo_hostname, ktore WYMAGA
# dzialajacego DNS - kazda proba wyslania poczty przez webmail (submission/
# smtps) konczyla sie "450 4.7.1 Helo command rejected: Host not found",
# mimo ze rekord DNS dla helo hostname FAKTYCZNIE istnial (`dig` z samego
# serwera go widzial - problem byl wylacznie w niedostepnosci resolwera
# WEWNATRZ chroota, nie w samym DNS). Restrykcje HELO maja sens dla
# anonimowego ruchu na porcie 25 (obcy nadawcy) - ruch uwierzytelniony
# przez SASL na submission/smtps i tak juz jest ograniczony przez
# smtpd_relay_restrictions=permit_sasl_authenticated,reject powyzej, wiec
# wylaczenie akurat tej jednej kontroli tu nie osłabia ochrony
# antyspamowej portu 25.
postconf -P 'submission/inet/smtpd_helo_restrictions='
postconf -P 'smtps/inet/smtpd_helo_restrictions='

# --- Wirtualne domeny/skrzynki pocztowe (klienci hostingu, NIEZALEZNE od
# kont systemowych/SSH z Fazy 1 powyzej) - DODATKOWA, rownolegla sciezka,
# nie zastepuje niczego istniejacego. Dedykowany systemowy user "vmail"
# (bez logowania) - zadna wirtualna skrzynka NIGDY nie nalezy do
# prawdziwego konta SSH/PAM. Zrodlo prawdy: MariaDB (baza "mailvirtual",
# patrz server/scripts/mail-virtual-*.sh) - Postfix I Dovecot odpytuja ja
# NA ZYWO (mysql: mapy / driver mysql), zero regeneracji plaskich plikow
# (poprzednia wersja z SQLite+lmdb: byla kruchsza - regeneracja/postmap/
# reload to dodatkowy punkt awarii, ktory juz raz na zywym serwerze psul
# TLS przez zly typ mapy, patrz komentarz przy SNI_MAP_FILE wyzej).
if ! getent passwd vmail >/dev/null 2>&1; then
  useradd --system --no-create-home --home-dir /var/mail/vhosts --shell /sbin/nologin vmail \
    || err "Utworzenie systemowego uzytkownika 'vmail' nie powiodlo sie."
fi
VMAIL_UID="$(id -u vmail)"
VMAIL_GID="$(id -g vmail)"
mkdir -p /var/mail/vhosts
chown vmail:vmail /var/mail/vhosts
chmod 750 /var/mail/vhosts

# MariaDB jest OSOBNA, juz istniejaca instalacja (patrz
# server/scripts/mariadb-install.sh, uzywana tez do baz klienckich
# hostingu przez hosting-db-mariadb.sh) - ten skrypt jej NIE instaluje,
# tylko wymaga zeby juz dzialala, dokladnie tak jak inne skrypty tego
# projektu wymagaja juz zainstalowanej Poczty przed dopisaniem czegos do
# niej (patrz np. check VMAIL_DB w mail-virtual-*.sh sprzed tej zmiany).
MARIADB_PWFILE="/root/.mariadb"
[ -f "$MARIADB_PWFILE" ] || err "MariaDB nie jest zainstalowana (brak ${MARIADB_PWFILE}) - zainstaluj MariaDB w panelu (Bazy danych) przed instalacja Poczty z wirtualnymi domenami."
systemctl is-active --quiet mariadb || err "Usluga mariadb nie dziala - uruchom ja przed instalacja Poczty."
ROOT_PASS="$(cat "$MARIADB_PWFILE")"

mkdir -p /etc/caddy-dashboard

# Haslo dedykowanego, SELECT-only uzytkownika MariaDB dla Postfixa/
# Dovecota (oba demony siecowe, haslo lezy jawnym tekstem w ich configach
# nizej - stad minimalne uprawnienia, patrz GRANT ponizej) - generowane
# TYLKO przy pierwszym uruchomieniu i trwale zapisywane, dokladnie ten sam
# powod co self-signed TLS wyzej: re-run tego (idempotentnego,
# samonaprawiajacego sie) skryptu NIE MOZE po cichu wygenerowac nowego
# hasla, bo wszystkie 4 configi (3x Postfix + Dovecot) rozjadyby sie z tym
# co faktycznie jest ustawione w bazie.
source "$(dirname "${BASH_SOURCE[0]}")/lib-gen-password.sh"
MAILVIRTUAL_PWFILE="/etc/caddy-dashboard/mail-virtual-db.pass"
if [ -f "$MAILVIRTUAL_PWFILE" ]; then
  MAILVIRTUAL_PASS="$(cat "$MAILVIRTUAL_PWFILE")"
else
  MAILVIRTUAL_PASS="$(gen_password)"
  umask 077
  printf '%s\n' "$MAILVIRTUAL_PASS" > "$MAILVIRTUAL_PWFILE"
  chown root:root "$MAILVIRTUAL_PWFILE"
  chmod 600 "$MAILVIRTUAL_PWFILE"
fi

# CREATE USER/GRANT sa IDEMPOTENTNE (IF NOT EXISTS), ale ALTER USER jest
# TU CELOWO bezwarunkowy - gdyby haslo w bazie kiedys rozjechalo sie z
# plikiem powyzej (np. reczna interwencja DBA), re-run tego skryptu ma je
# wymusic z powrotem, a nie po cichu zostawic rozjazd niewykryty.
mariadb -u root -p"${ROOT_PASS}" <<SQL || err "Inicjalizacja schematu MariaDB (mailvirtual) nie powiodla sie."
CREATE DATABASE IF NOT EXISTS mailvirtual CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mailvirtual.domains (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  domain VARCHAR(255) NOT NULL,
  owner_account VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uq_domains_domain (domain)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS mailvirtual.mailboxes (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  domain_id INT UNSIGNED NOT NULL,
  localpart VARCHAR(128) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  maildir VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uq_mailboxes_domain_localpart (domain_id, localpart),
  CONSTRAINT fk_mailboxes_domain FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS mailvirtual.aliases (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  domain_id INT UNSIGNED NOT NULL,
  source VARCHAR(255) NOT NULL,
  destination VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL,
  CONSTRAINT fk_aliases_domain FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE USER IF NOT EXISTS 'mailvirtual'@'127.0.0.1' IDENTIFIED BY '${MAILVIRTUAL_PASS}';
ALTER USER 'mailvirtual'@'127.0.0.1' IDENTIFIED BY '${MAILVIRTUAL_PASS}';
GRANT SELECT ON mailvirtual.* TO 'mailvirtual'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL

# Plik z connect stringiem MariaDB - ZAWIERA haslo usera "mailvirtual"
# jawnym tekstem (w odroznieniu od poprzedniej wersji SQLite, ktora hasla
# do samej bazy nie potrzebowala) - ale ten user jest SELECT-only na
# jednej bazie (patrz GRANT przy tworzeniu usera wyzej), wiec blast radius
# wycieku tego pliku jest ograniczony. Dovecot parsuje WSZYSTKIE pliki
# configu jako root przy starcie, wiec 0600 root:root (standardowy,
# bezpieczny wzorzec Dovecota dla *-sql.conf.ext) wystarcza.
cat > /etc/dovecot/dovecot-sql-virtual.conf.ext <<EOF
driver = mysql
connect = host=127.0.0.1 dbname=mailvirtual user=mailvirtual password=${MAILVIRTUAL_PASS}
default_pass_scheme = SHA512-CRYPT
password_query = SELECT mailboxes.password_hash AS password FROM mailboxes JOIN domains ON domains.id = mailboxes.domain_id WHERE domains.domain = '%d' AND mailboxes.localpart = '%n' AND mailboxes.enabled = 1
user_query = SELECT CONCAT('/var/mail/vhosts/',domains.domain,'/',mailboxes.localpart) AS home, CONCAT('maildir:/var/mail/vhosts/',domains.domain,'/',mailboxes.localpart,'/Maildir') AS mail, ${VMAIL_UID} AS uid, ${VMAIL_GID} AS gid FROM mailboxes JOIN domains ON domains.id = mailboxes.domain_id WHERE domains.domain = '%d' AND mailboxes.localpart = '%n' AND mailboxes.enabled = 1
EOF
chmod 600 /etc/dovecot/dovecot-sql-virtual.conf.ext

# passdb/userdb SQL w OSOBNYM, WCZESNIE ladowanym pliku ("05-..." - przed
# "10-auth.conf", ktory wlacza PAM przez pakietowy auth-system.conf.ext) -
# NIE w tym samym pliku co first_valid_uid nizej (patrz komentarz tam,
# dlaczego first_valid_uid musi zostac PO "10-mail.conf"). Dovecot probuje
# kazdy passdb/userdb PO KOLEI w kolejnosci deklaracji (czyli kolejnosci
# ladowania plikow conf.d/*.conf) - trzymajac SQL na "91-..." (jak
# pierwotnie), PAM zawsze byl probowany PIERWSZY. Dla wirtualnych
# skrzynek (login zawsze "localpart@domena") PAM/pam_unix ZAWSZE musi
# zawiesc (to nie jest konto systemowe) - ale pam_unix ma wbudowane ~2s
# opoznienie PO kazdej nieudanej probie (ochrona antybruteforce/
# username-enumeration), wiec KAZDE logowanie wirtualnej skrzynki traciilo
# ~2s zanim w ogole doszlo do szybkiego (SQL, ~0ms) passdb. Roundcube
# laczy sie kilka razy na jedna akcje (nowe polaczenie IMAP zamiast
# trzymac jedno), wiec te 2s mnozyly sie do kilkunastu sekund odczuwalnego
# opoznienia - zdiagnozowane 2026-08-16 (user: "kontakt@autoai.qd.je
# dziala bardzo wolno, srv_1001 bardzo szybko") przez slowlog PHP-FPM +
# auth_debug Dovecota. Proba naprawy na poziomie PAM (pam_succeed_if,
# "user != *@*") zostala ODRZUCONA i cofnieta - nieskuteczna na zywo
# (pam_succeed_if traktuje "!=" jako scisle porownanie stringow, NIE
# fnmatch, wiec warunek byl zawsze prawdziwy = no-op), a poprawianie
# skladni skokow PAM ([success=...]) uznane za zbyt ryzykowne (bledna
# skladnia moze zablokowac logowanie WSZYSTKIM). Ta zmiana kolejnosci
# plikow jest bezpieczniejsza: dla kont lokalnych (bez "@") SQL i tak
# zwraca 0 wierszy blyskawicznie (potwierdzone na zywo: "in 0 msecs"),
# wiec PAM nadal dziala normalnie, tylko chwile pozniej - zero dodatkowego
# opoznienia w praktyce.
cat > /etc/dovecot/conf.d/05-caddy-dashboard-virtual-passdb.conf <<EOF
# Zarzadzane przez Caddy Dashboard - server/scripts/mail-install.sh
passdb {
  driver = sql
  args = /etc/dovecot/dovecot-sql-virtual.conf.ext
}
userdb {
  driver = sql
  args = /etc/dovecot/dovecot-sql-virtual.conf.ext
}
EOF
chmod 644 /etc/dovecot/conf.d/05-caddy-dashboard-virtual-passdb.conf

dovecot -n >/dev/null 2>&1 || err "Konfiguracja Dovecota (05-caddy-dashboard-virtual-passdb.conf) nie przeszla walidacji (dovecot -n)."

# first_valid_uid MUSI zostac w PLIKU LADOWANYM PO "10-mail.conf"
# (pakietowe ustawienie Dovecota tam ustawia domyslnie 1000, blokujac
# dostep dla KAZDEGO UID ponizej 1000, w tym samego "vmail" - "useradd
# --system" wyzej przydziela UID z puli systemowej, ponizej 1000,
# potwierdzone na zywym serwerze 2026-08-15: UID 987). Gdyby ten plik
# zaladowal sie WCZESNIEJ niz "10-mail.conf" (np. razem z passdb/userdb w
# pliku "05-..." powyzej), pozniejszy pakietowy default nadpisalby nasze
# 987 z powrotem na 1000 - Dovecot znow odmawialby dostepu do KAZDEJ
# wirtualnej skrzynki ("Mail access for users with UID ... not
# permitted"), dokladnie jak przy pierwszym odkryciu tego bledu. Stad
# osobny plik "91-..." (zostaje PO "10-mail.conf"), NIE ten sam co
# wczesnie-ladowany plik passdb/userdb wyzej. Dopuszczamy WYLACZNIE ten
# jeden, znany, bezpieczny UID (NIE obnizamy globalnej bariery dla
# wszystkiego innego ponizej 1000, np. roota) - stad zmienna VMAIL_UID w
# tym pliku, nie sztywna liczba.
cat > /etc/dovecot/conf.d/91-caddy-dashboard-virtual.conf <<EOF
# Zarzadzane przez Caddy Dashboard - server/scripts/mail-install.sh
first_valid_uid = ${VMAIL_UID}
EOF
chmod 644 /etc/dovecot/conf.d/91-caddy-dashboard-virtual.conf

dovecot -n >/dev/null 2>&1 || err "Konfiguracja Dovecota (91-caddy-dashboard-virtual.conf) nie przeszla walidacji (dovecot -n)."

# --- Postfix: wirtualne domeny/skrzynki/aliasy - mysql: mapy, ODPYTYWANE
# NA ZYWO z MariaDB (baza "mailvirtual" powyzej) przy kazdej wiadomosci -
# ZERO regeneracji plaskich plikow/postmap/reload (poprzednia wersja z
# SQLite+lmdb: byla kruchsza - regeneracja/postmap/reload to dodatkowy
# punkt awarii, ktory juz raz na zywym serwerze psul TLS przez zly typ
# mapy, patrz komentarz przy SNI_MAP_FILE wyzej). Zmiana w bazie (dodanie/
# usuniecie domeny/skrzynki przez mail-virtual-*.sh) jest widoczna dla
# Postfixa natychmiast, bez zadnego przeladowania uslugi.
#
# hosts = 127.0.0.1 (TCP, NIE socket unixowy /var/lib/mysql/mysql.sock) -
# submission/smtps ponizej maja chroot=y (patrz postconf -P przy
# smtpd_helo_restrictions wyzej), a socket plikowy bylby niewidoczny w tym
# samym chroocie - dokladnie ta sama klasa problemu co juz raz zepsula
# HELO/DNS w chroocie (2026-08-15). TCP do 127.0.0.1 dziala przezroczyscie
# z chroota (syscall sieciowy, nie sciezka na dysku). MariaDB musi wiec
# nasluchiwac na 127.0.0.1 (bind-address w /etc/my.cnf.d/) - domyslnie
# zwykle tak jest, ale NIE bylo to jeszcze potwierdzone na tym konkretnym
# serwerze - jesli polaczenie nie dziala, sprawdzic tam najpierw.
MYSQL_VIRTUAL_DOMAINS_CF="/etc/postfix/mysql-virtual-domains.cf"
MYSQL_VIRTUAL_MAILBOXES_CF="/etc/postfix/mysql-virtual-mailboxes.cf"
MYSQL_VIRTUAL_ALIASES_CF="/etc/postfix/mysql-virtual-aliases.cf"

cat > "$MYSQL_VIRTUAL_DOMAINS_CF" <<EOF
user = mailvirtual
password = ${MAILVIRTUAL_PASS}
hosts = 127.0.0.1
dbname = mailvirtual
query = SELECT 1 FROM domains WHERE domain='%s'
EOF

cat > "$MYSQL_VIRTUAL_MAILBOXES_CF" <<EOF
user = mailvirtual
password = ${MAILVIRTUAL_PASS}
hosts = 127.0.0.1
dbname = mailvirtual
query = SELECT CONCAT(domains.domain,'/',mailboxes.localpart,'/Maildir/') FROM mailboxes JOIN domains ON domains.id = mailboxes.domain_id WHERE domains.domain='%d' AND mailboxes.localpart='%u' AND mailboxes.enabled=1
EOF

cat > "$MYSQL_VIRTUAL_ALIASES_CF" <<EOF
user = mailvirtual
password = ${MAILVIRTUAL_PASS}
hosts = 127.0.0.1
dbname = mailvirtual
query = SELECT destination FROM aliases WHERE source='%s'
EOF

# root:postfix 0640 - zawieraja haslo jawnym tekstem, proces "postfix"
# (grupa postfix) musi je odczytac przy kazdym zapytaniu do bazy.
chown root:postfix "$MYSQL_VIRTUAL_DOMAINS_CF" "$MYSQL_VIRTUAL_MAILBOXES_CF" "$MYSQL_VIRTUAL_ALIASES_CF"
chmod 640 "$MYSQL_VIRTUAL_DOMAINS_CF" "$MYSQL_VIRTUAL_MAILBOXES_CF" "$MYSQL_VIRTUAL_ALIASES_CF"

postconf -e "virtual_mailbox_base=/var/mail/vhosts"
postconf -e "virtual_mailbox_domains=mysql:${MYSQL_VIRTUAL_DOMAINS_CF}"
postconf -e "virtual_mailbox_maps=mysql:${MYSQL_VIRTUAL_MAILBOXES_CF}"
postconf -e "virtual_alias_maps=mysql:${MYSQL_VIRTUAL_ALIASES_CF}"
postconf -e "virtual_uid_maps=static:${VMAIL_UID}"
postconf -e "virtual_gid_maps=static:${VMAIL_GID}"
postconf -e "virtual_minimum_uid=${VMAIL_UID}"
postconf -e 'virtual_transport = virtual'
# Postfixowy WLASNY, STALY domyslny virtual_mailbox_limit (51200000 B,
# ~51MB) jest NIEZALEZNY od mailbox_size_limit mimo podobnej nazwy - jesli
# message_size_limit jest juz wiekszy (np. admin podniosl go wczesniej w
# Poczta -> ustawienia, patrz postfix-set-limits.sh), agent `virtual`
# odmawia startu przy pierwszej dostawie ("virtual_mailbox_limit is
# smaller than message_size_limit"), niezaleznie od tego ze `postfix
# check` przechodzi czysto. Potwierdzone na zywym serwerze 2026-08-15 -
# dopasowujemy go tu od razu do aktualnego mailbox_size_limit, zeby swiezy
# install (albo re-run na juz dzialajacym message_size_limit) nigdy nie
# zaczynal w tym zepsutym stanie.
postconf -e "virtual_mailbox_limit=$(postconf -h mailbox_size_limit 2>/dev/null || echo 0)"

# Potwierdza, ze DZIALAJACY binarny postfix faktycznie zglasza "mysql"
# jako dostepny typ mapy - pakiet postfix-mysql moze byc zainstalowany, a
# wsparcie mimo to niewidoczne bez tego (np. brak wpisu w dynamicmaps.cf).
postconf -m 2>/dev/null | grep -qx mysql \
  || err "Postfix nie zglasza 'mysql' jako dostepny typ mapy mimo zainstalowanego postfix-mysql - sprawdz 'postconf -m' i /etc/postfix/dynamicmaps.cf recznie."

postfix check || err "Konfiguracja Postfixa nie przeszla walidacji (postfix check) po zmianach."

# --- OpenDKIM: pojedyncze dyrektywy w pliku pakietu (brak wlasnego
# conf.d) - "ensure_directive" nadpisuje istniejaca linie LUB dopisuje
# nowa, idempotentnie, bez ruszania reszty pliku (komentarze/domyslne
# wartosci pakietu zostaja). KeyTable/SigningTable na razie PUSTE -
# generowanie kluczy per-domena to kolejny krok. ---
OPENDKIM_CONF="/etc/opendkim.conf"
mkdir -p /etc/opendkim /etc/opendkim/keys
touch /etc/opendkim/KeyTable /etc/opendkim/SigningTable
# Demon dziala jako opendkim:opendkim (UserID w opendkim.conf), NIE jako
# root, i nie nalezy do grupy "root" - pliki utworzone tu jako root
# musza byc jawnie czytelne, bo umask roota na serwerze potrafi dac 640
# (nieczytelne dla nikogo poza rootem/grupa root). Zadna z tych trzech
# rzeczy (KeyTable/SigningTable/katalog kluczy) nie zawiera samego
# materialu klucza - to tylko sciezki/nazwy, wiec swiatoczytelnosc jest
# bezpieczna (sam prywatny klucz .private ma osobne, wlasciwe chmod 640
# opendkim:opendkim, patrz dkim-install.sh).
chmod 644 /etc/opendkim/KeyTable /etc/opendkim/SigningTable
chmod 755 /etc/opendkim/keys

# TrustedHosts/InternalHosts - BEZ TEGO opendkim TYLKO weryfikuje przychodzaca
# poczte, nigdy nie PODPISUJE wychodzacej z localhost (Postfix->milter to
# polaczenie 127.0.0.1). Domyslnie pakiet nie ma zadnego hosta w
# "internal" - milter traktuje kazde polaczenie jako "zewnetrzne" i tylko
# weryfikuje. Potwierdzone brakiem podpisu DKIM w realnie wyslanej
# wiadomosci na zywym serwerze 2026-08-14.
cat > /etc/opendkim/TrustedHosts <<'EOF'
127.0.0.1
::1
localhost
EOF
chmod 644 /etc/opendkim/TrustedHosts

ensure_directive() {
  local key="$1" value="$2"
  if grep -q "^${key}[[:space:]]" "$OPENDKIM_CONF" 2>/dev/null; then
    sed -i "s|^${key}[[:space:]].*|${key} ${value}|" "$OPENDKIM_CONF"
  else
    echo "${key} ${value}" >> "$OPENDKIM_CONF"
  fi
}
ensure_directive "Mode" "sv"
# 127.0.0.1 literal, zeby dokladnie odpowiadac adresowi ktory Postfix
# faktycznie uzywa (smtpd_milters=inet:127.0.0.1:8891 powyzej) - unika
# jakiejkolwiek niejednoznacznosci IPv4/IPv6 przy rozwiazywaniu "localhost".
ensure_directive "Socket" "inet:8891@127.0.0.1"
ensure_directive "KeyTable" "/etc/opendkim/KeyTable"
# "refile:" (NIE goła sciezka) - bez tego prefiksu OpenDKIM traktuje plik
# jako "file:" (dopasowanie tylko doslowne, BEZ WILDCARDOW), a wpis w
# SigningTable to wlasnie wildcard "*@domena" (patrz komentarz w samym
# pliku SigningTable, wygenerowanym przez pakiet). Efekt bez "refile:":
# "no signing table match for 'user@domena'" w logu i wiadomosc wychodzi
# BEZ PODPISU, mimo poprawnego wpisu w tabeli. Potwierdzone na zywym
# serwerze 2026-08-14.
ensure_directive "SigningTable" "refile:/etc/opendkim/SigningTable"
ensure_directive "PidFile" "/run/opendkim/opendkim.pid"
ensure_directive "InternalHosts" "refile:/etc/opendkim/TrustedHosts"
ensure_directive "ExternalIgnoreList" "refile:/etc/opendkim/TrustedHosts"

systemctl enable --now postfix dovecot opendkim \
  || err "Pakiety zainstalowane, ale nie udalo sie uruchomic/wlaczyc jednej z uslug (postfix/dovecot/opendkim)."
# Skrypt jest idempotentny i moze byc URUCHOMIONY PONOWNIE na juz
# dzialajacej instalacji (np. zeby dolozyc obsluge wirtualnych domen do
# istniejacej Poczty) - `enable --now` na juz aktywnej uslugie NIC nie
# robi (start na running unit to no-op), wiec bez jawnego reload/restart
# ponizej nowa konfiguracja (Postfix virtual_*, nowy plik Dovecota) NIGDY
# by sie nie zaladowala na zywym serwerze bez recznego restartu.
systemctl reload postfix >/dev/null 2>&1 || true
systemctl reload dovecot >/dev/null 2>&1 || true

# --- Firewall: SMTP/Submission/SMTPS + IMAP/IMAPS - SWIADOMIE bez POP3/POP3S ---
firewall-cmd --permanent --add-service=smtp >/dev/null 2>&1 || true
firewall-cmd --permanent --add-port=587/tcp >/dev/null 2>&1 || true
firewall-cmd --permanent --add-port=465/tcp >/dev/null 2>&1 || true
firewall-cmd --permanent --add-service=imap >/dev/null 2>&1 || true
firewall-cmd --permanent --add-service=imaps >/dev/null 2>&1 || true
firewall-cmd --reload >/dev/null 2>&1 || true

echo "OK: Postfix + Dovecot + OpenDKIM zainstalowane i uruchomione (IMAP/IMAPS + SMTP/SMTPS, bez POP3/POP3S; TLS tymczasowy self-signed; DKIM bez kluczy - kolejny krok)."
