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
# sqlite (CLI /usr/bin/sqlite3) - wymagany dla wirtualnych domen/skrzynek
# ponizej, osobny (maly) podpakiet, nie czesc bazowego systemu.
dnf install -y postfix dovecot opendkim opendkim-tools sqlite || err "Instalacja pakietow (postfix, dovecot, opendkim, opendkim-tools, sqlite) nie powiodla sie."

# Sterownik sqlite dla Dovecota (passdb/userdb SQL dla wirtualnych
# domen/skrzynek ponizej) bywa OSOBNYM podpakietem (np. starsze EL9) ALBO
# WBUDOWANY w sam pakiet "dovecot" - potwierdzone na AlmaLinux 10.2
# (dovecot 2.3.21-19.el10_2): pakiet "dovecot-sqlite" tam W OGOLE NIE
# ISTNIEJE ("Unable to find a match"), bo libdriver_sqlite.so juz siedzi
# w samym "dovecot". Probujemy doinstalowac OSOBNY pakiet, ale NIE
# failujemy jesli go nie ma - prawdziwym testem jest obecnosc samej
# biblioteki sterownika, sprawdzana ponizej. Sciezka potwierdzona `rpm -ql
# dovecot` na zywym serwerze 2026-08-14 (AlmaLinux 10.2) - POJEDYNCZA,
# konkretna sciezka (NIE `find` po kilku katalogach - `find` z
# nieistniejacym drugim argumentem potrafi nie zwrocic nic uzytecznego,
# tak jak sie tu okazalo).
dnf install -y dovecot-sqlite >/dev/null 2>&1 || true
DOVECOT_SQLITE_DRIVER="/usr/lib64/dovecot/libdriver_sqlite.so"
[ -e "$DOVECOT_SQLITE_DRIVER" ] \
  || err "Brak sterownika sqlite dla Dovecota (${DOVECOT_SQLITE_DRIVER}) - sprawdz recznie: rpm -ql dovecot | grep sqlite."

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
SNI_MAP_FILE="/etc/postfix/mail-sni-map"
if [ ! -f "$SNI_MAP_FILE" ]; then
  : > "$SNI_MAP_FILE"
  postmap "$SNI_MAP_FILE" || err "postmap ${SNI_MAP_FILE} nie powiodlo sie."
  chmod 644 "$SNI_MAP_FILE" "${SNI_MAP_FILE}.db" 2>/dev/null || true
fi
postconf -e "tls_server_sni_maps=hash:${SNI_MAP_FILE}"
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
postconf -e 'smtpd_milters = inet:127.0.0.1:8891'
postconf -e 'non_smtpd_milters = inet:127.0.0.1:8891'

# master.cf: dopisujemy WLASNE, kompletne stanze submission(587)/smtps(465)
# zamiast probowac odkomentowac szablon dostarczony z pakietem (rozny
# dokladny format miedzy wersjami postfixa/dystrybucji) - `postconf -M`
# to REALNY, autorytatywny odczyt aktywnej konfiguracji (nie dopasowanie
# tekstu), wiec dopisanie jest bezpiecznie idempotentne.
if ! postconf -M 2>/dev/null | grep -q '^submission/inet'; then
  cat >> /etc/postfix/master.cf <<'EOF'

submission inet n       -       y       -       -       smtpd
  -o syslog_name=postfix/submission
  -o smtpd_tls_security_level=encrypt
  -o smtpd_sasl_auth_enable=yes
  -o smtpd_relay_restrictions=permit_sasl_authenticated,reject
EOF
fi
if ! postconf -M 2>/dev/null | grep -q '^smtps/inet'; then
  cat >> /etc/postfix/master.cf <<'EOF'

smtps     inet  n       -       y       -       -       smtpd
  -o syslog_name=postfix/smtps
  -o smtpd_tls_wrappermode=yes
  -o smtpd_sasl_auth_enable=yes
  -o smtpd_relay_restrictions=permit_sasl_authenticated,reject
EOF
fi

# --- Wirtualne domeny/skrzynki pocztowe (klienci hostingu, NIEZALEZNE od
# kont systemowych/SSH z Fazy 1 powyzej) - DODATKOWA, rownolegla sciezka,
# nie zastepuje niczego istniejacego. Dedykowany systemowy user "vmail"
# (bez logowania) - zadna wirtualna skrzynka NIGDY nie nalezy do
# prawdziwego konta SSH/PAM. Zrodlo prawdy: SQLite
# (/etc/caddy-dashboard/mail-virtual.db, patrz server/scripts/
# mail-virtual-*.sh) - Dovecot czyta go NA ZYWO (wlasny driver sqlite),
# Postfix (czesto BEZ wkompilowanego sqlite) dostaje plaskie pliki hash:
# regenerowane z tej samej bazy przez mail-virtual-*.sh (ten sam wzorzec
# co KeyTable/SigningTable OpenDKIM).
if ! getent passwd vmail >/dev/null 2>&1; then
  useradd --system --no-create-home --home-dir /var/mail/vhosts --shell /sbin/nologin vmail \
    || err "Utworzenie systemowego uzytkownika 'vmail' nie powiodlo sie."
fi
VMAIL_UID="$(id -u vmail)"
VMAIL_GID="$(id -g vmail)"
mkdir -p /var/mail/vhosts
chown vmail:vmail /var/mail/vhosts
chmod 750 /var/mail/vhosts

VMAIL_DB="/etc/caddy-dashboard/mail-virtual.db"
mkdir -p /etc/caddy-dashboard
if [ ! -f "$VMAIL_DB" ]; then
  sqlite3 "$VMAIL_DB" <<'SQL' || err "Inicjalizacja schematu SQLite (${VMAIL_DB}) nie powiodla sie."
CREATE TABLE domains (
  id INTEGER PRIMARY KEY,
  domain TEXT UNIQUE NOT NULL,
  owner_account TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE mailboxes (
  id INTEGER PRIMARY KEY,
  domain_id INTEGER NOT NULL REFERENCES domains(id),
  localpart TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  maildir TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(domain_id, localpart)
);
CREATE TABLE aliases (
  id INTEGER PRIMARY KEY,
  domain_id INTEGER NOT NULL REFERENCES domains(id),
  source TEXT NOT NULL,
  destination TEXT NOT NULL,
  created_at TEXT NOT NULL
);
SQL
fi
# Dovecot laczy sie do tej bazy jako grupa "dovecot" (proces auth-worker,
# NIE root) - musi miec jawny dostep grupowy do odczytu (zawiera
# zahaszowane hasla, wiec NIE world-readable). Ten sam bledny wzorzec
# (poleganie na umask roota) juz raz zepsul OpenDKIM na tym serwerze
# (2026-08-14, patrz [[project_caddy_dashboard_mail_access]]) - tu
# ustawiane jawnie, bezwarunkowo przy KAZDYM uruchomieniu.
chown root:dovecot "$VMAIL_DB"
chmod 640 "$VMAIL_DB"

# Plik z zapytaniami SQL (NIE zawiera hasel, tylko sciezke do bazy +
# zapytania) - Dovecot parsuje WSZYSTKIE pliki configu jako root przy
# starcie, wiec 0600 root:root (standardowy, bezpieczny wzorzec Dovecota
# dla *-sql.conf.ext) wystarcza - w przeciwienstwie do samej bazy powyzej,
# ktora jest odpytywana NA ZYWO przez nieuprzywilejowany proces.
cat > /etc/dovecot/dovecot-sql-virtual.conf.ext <<EOF
driver = sqlite
connect = ${VMAIL_DB}
default_pass_scheme = SHA512-CRYPT
password_query = SELECT mailboxes.password_hash AS password FROM mailboxes JOIN domains ON domains.id = mailboxes.domain_id WHERE domains.domain = '%d' AND mailboxes.localpart = '%n' AND mailboxes.enabled = 1
user_query = SELECT '/var/mail/vhosts/' || domains.domain || '/' || mailboxes.localpart AS home, 'maildir:/var/mail/vhosts/' || domains.domain || '/' || mailboxes.localpart || '/Maildir' AS mail, ${VMAIL_UID} AS uid, ${VMAIL_GID} AS gid FROM mailboxes JOIN domains ON domains.id = mailboxes.domain_id WHERE domains.domain = '%d' AND mailboxes.localpart = '%n' AND mailboxes.enabled = 1
EOF
chmod 600 /etc/dovecot/dovecot-sql-virtual.conf.ext

# WSPOLISTNIEJE z PAM (90-caddy-dashboard.conf, wlaczony przez pakietowy
# auth-system.conf.ext) - Dovecot probuje kazdy passdb/userdb po kolei,
# brak dopasowania (0 wierszy z SQL) po prostu przechodzi do nastepnego,
# zero konfliktu.
cat > /etc/dovecot/conf.d/91-caddy-dashboard-virtual.conf <<'EOF'
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
chmod 644 /etc/dovecot/conf.d/91-caddy-dashboard-virtual.conf

dovecot -n >/dev/null 2>&1 || err "Konfiguracja Dovecota (91-caddy-dashboard-virtual.conf) nie przeszla walidacji (dovecot -n)."

# --- Postfix: wirtualne domeny/skrzynki/aliasy - PLASKIE pliki hash:,
# REGENEROWANE ze zrodla prawdy (SQLite powyzej) przez mail-virtual-*.sh
# przy kazdej zmianie (ten sam wzorzec co KeyTable/SigningTable OpenDKIM).
# Tworzone tu jako PUSTE (0 domen) - postmap nizej ma co zwalidowac nawet
# przy zerowej liczbie wirtualnych domen.
VIRTUAL_DOMAINS_FILE="/etc/postfix/virtual-domains"
VIRTUAL_MAILBOX_FILE="/etc/postfix/virtual-mailboxes"
VIRTUAL_ALIAS_FILE="/etc/postfix/virtual-aliases"
# chmod 644 PO KAZDYM postmap (nie tylko przy tworzeniu) - `postmap`
# generuje plik .db od nowa za kazdym razem, wiec dziedziczy AKTUALNY
# umask roota (na tym serwerze potrafi dac 640, patrz OpenDKIM
# 2026-08-14) - bez jawnego chmod proces "postfix" (odebrane uprawnienia,
# NIE root) nie moglby odczytac WLASNYCH map wirtualnych domen/skrzynek.
for f in "$VIRTUAL_DOMAINS_FILE" "$VIRTUAL_MAILBOX_FILE" "$VIRTUAL_ALIAS_FILE"; do
  [ -f "$f" ] || : > "$f"
  postmap "$f" || err "postmap ${f} nie powiodlo sie."
  chmod 644 "$f" "${f}.db" 2>/dev/null || true
done

postconf -e "virtual_mailbox_base=/var/mail/vhosts"
postconf -e "virtual_mailbox_domains=hash:${VIRTUAL_DOMAINS_FILE}"
postconf -e "virtual_mailbox_maps=hash:${VIRTUAL_MAILBOX_FILE}"
postconf -e "virtual_alias_maps=hash:${VIRTUAL_ALIAS_FILE}"
postconf -e "virtual_uid_maps=static:${VMAIL_UID}"
postconf -e "virtual_gid_maps=static:${VMAIL_GID}"
postconf -e "virtual_minimum_uid=${VMAIL_UID}"
postconf -e 'virtual_transport = virtual'

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
