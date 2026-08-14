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

dnf install -y postfix dovecot opendkim || err "Instalacja pakietow (postfix, dovecot, opendkim) nie powiodla sie."

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
postconf -e "smtpd_tls_cert_file=${CERT_FILE}"
postconf -e "smtpd_tls_key_file=${KEY_FILE}"
postconf -e 'smtpd_tls_security_level = may'
postconf -e 'smtpd_sasl_type = dovecot'
postconf -e 'smtpd_sasl_path = private/auth'
postconf -e 'smtpd_sasl_auth_enable = yes'
postconf -e 'smtpd_relay_restrictions = permit_sasl_authenticated, permit_mynetworks, reject_unauth_destination'
postconf -e 'milter_default_action = accept'
postconf -e 'milter_protocol = 6'
postconf -e 'smtpd_milters = inet:localhost:8891'
postconf -e 'non_smtpd_milters = inet:localhost:8891'

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
mkdir -p /etc/opendkim
touch /etc/opendkim/KeyTable /etc/opendkim/SigningTable
ensure_directive() {
  local key="$1" value="$2"
  if grep -q "^${key}[[:space:]]" "$OPENDKIM_CONF" 2>/dev/null; then
    sed -i "s|^${key}[[:space:]].*|${key} ${value}|" "$OPENDKIM_CONF"
  else
    echo "${key} ${value}" >> "$OPENDKIM_CONF"
  fi
}
ensure_directive "Mode" "sv"
ensure_directive "Socket" "inet:8891@localhost"
ensure_directive "KeyTable" "/etc/opendkim/KeyTable"
ensure_directive "SigningTable" "/etc/opendkim/SigningTable"
ensure_directive "PidFile" "/run/opendkim/opendkim.pid"

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
