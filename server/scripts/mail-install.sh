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
# Uzycie: mail-install.sh (bez argumentow)

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

getent group mail >/dev/null 2>&1 || err "Systemowa grupa 'mail' nie istnieje - nietypowa instalacja AlmaLinux/Rocky."

# opendkim-tools to OSOBNY podpakiet w EPEL (sam "opendkim" ma tylko
# demona) - opendkim-genkey/opendkim-testkey zyja tam, nie w glownym
# pakiecie. Bez tego dkim-install.sh (przycisk "Zainstaluj DKIM" w
# panelu) failuje "brak polecenia opendkim-genkey" - potwierdzone na
# zywym serwerze 2026-08-14.
dnf install -y postfix dovecot opendkim opendkim-tools || err "Instalacja pakietow (postfix, dovecot, opendkim, opendkim-tools) nie powiodla sie."

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
ssl_cert = <${CERT_FILE}
ssl_key = <${KEY_FILE}

disable_plaintext_auth = yes

# PAM zna tylko GOLE nazwy uzytkownikow systemowych (np. "cdadmin"), nie
# "cdadmin@domena" - bez tego logowanie pelnym adresem (user@domena)
# zawsze by failowalo, mimo ze sam login "user" dziala. %n obcina
# wszystko od "@" wlacznie przed przekazaniem do PAM, wiec
# "cdadmin@20z.eu" i "cdadmin" loguja sie identycznie, jako ten sam
# system user.
auth_username_format = %n

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
postconf -e "smtpd_tls_cert_file=${CERT_FILE}"
postconf -e "smtpd_tls_key_file=${KEY_FILE}"
postconf -e 'smtpd_tls_security_level = may'
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

# --- Firewall: SMTP/Submission/SMTPS + IMAP/IMAPS - SWIADOMIE bez POP3/POP3S ---
firewall-cmd --permanent --add-service=smtp >/dev/null 2>&1 || true
firewall-cmd --permanent --add-port=587/tcp >/dev/null 2>&1 || true
firewall-cmd --permanent --add-port=465/tcp >/dev/null 2>&1 || true
firewall-cmd --permanent --add-service=imap >/dev/null 2>&1 || true
firewall-cmd --permanent --add-service=imaps >/dev/null 2>&1 || true
firewall-cmd --reload >/dev/null 2>&1 || true

echo "OK: Postfix + Dovecot + OpenDKIM zainstalowane i uruchomione (IMAP/IMAPS + SMTP/SMTPS, bez POP3/POP3S; TLS tymczasowy self-signed; DKIM bez kluczy - kolejny krok)."
