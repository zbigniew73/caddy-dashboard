#!/usr/bin/env bash
#
# Podmienia certyfikat TLS Postfixa/Dovecota miedzy tymczasowym self-signed
# (wygenerowanym przez mail-install.sh, Faza 1) a prawdziwym certyfikatem
# Let's Encrypt, ktory Caddy juz wydal dla mail.<domena> (wystawiony przy
# instalacji/konfiguracji Roundcube - patrz roundcube-caddy-config.sh).
#
# Zrodlo certyfikatu Let's Encrypt: WEWNETRZNY magazyn certow Caddy
# (sciezka zweryfikowana na zywym serwerze 2026-08-14, `sudo find
# /var/lib/caddy -iname "mail.<domena>*"`):
#   /var/lib/caddy/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory/<domena>/<domena>.crt
#   /var/lib/caddy/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory/<domena>/<domena>.key
# KOPIUJEMY (nie symlinkujemy) do wlasnych plikow pod /etc/pki/tls/ - te
# same katalogi/wzorzec uprawnien co self-signed z mail-install.sh.
#
# UWAGA - znana granica tego mechanizmu: certyfikat Let's Encrypt Caddy
# ODNAWIA automatycznie co ok. 60 dni, ale ta kopia w /etc/pki/tls/ NIE
# odswieza sie sama - po odnowieniu trzeba ponownie kliknac Wlacz (albo
# zbudowac osobny mechanizm auto-sync/reload) - PRZYSZLY, nie tutaj.
#
# Idempotentne, z backupem+rollbackiem (main.cf przez zapamietanie
# poprzednich wartosci postconf, dovecot conf.d przez kopie pliku) -
# jesli walidacja (postfix check / dovecot -n) po ktorejkolwiek zmianie
# sie nie powiedzie, PRZYWRACA OBIE uslugi do poprzedniego stanu, nie
# zostawia ich w polowie zmiany.
#
# Uzycie: mail-tls-swap.sh <enable|disable> <mail-domena>
#   enable  - podmienia self-signed na certyfikat Let's Encrypt dla podanej domeny
#   disable - przywraca certyfikat tymczasowy self-signed

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

ACTION="${1:-}"
DOMAIN="${2:-}"

SELFSIGNED_CERT="/etc/pki/tls/certs/mail-selfsigned.crt"
SELFSIGNED_KEY="/etc/pki/tls/private/mail-selfsigned.key"
LE_CERT="/etc/pki/tls/certs/mail-letsencrypt.crt"
LE_KEY="/etc/pki/tls/private/mail-letsencrypt.key"
DOVECOT_CONF="/etc/dovecot/conf.d/90-caddy-dashboard.conf"
CADDY_CERT_DIR_BASE="/var/lib/caddy/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory"

[ "$ACTION" = "enable" ] || [ "$ACTION" = "disable" ] || err "nieznana akcja '${ACTION}' (oczekiwano enable|disable)."
[[ "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$ ]] || err "nieprawidlowa domena: '${DOMAIN}'"
[ -f "$DOVECOT_CONF" ] || err "${DOVECOT_CONF} nie istnieje - Poczta (Postfix/Dovecot) jest jeszcze niezainstalowana."

if [ "$ACTION" = "enable" ]; then
  SRC_CRT="${CADDY_CERT_DIR_BASE}/${DOMAIN}/${DOMAIN}.crt"
  SRC_KEY="${CADDY_CERT_DIR_BASE}/${DOMAIN}/${DOMAIN}.key"
  [ -f "$SRC_CRT" ] && [ -f "$SRC_KEY" ] \
    || err "Caddy jeszcze nie wydal certyfikatu dla ${DOMAIN} (brak ${SRC_CRT}) - sprawdz, czy strona jest juz zywa i DNS na nia wskazuje."

  cp "$SRC_CRT" "$LE_CERT" || err "Kopiowanie certyfikatu z magazynu Caddy nie powiodlo sie."
  cp "$SRC_KEY" "$LE_KEY" || err "Kopiowanie klucza z magazynu Caddy nie powiodlo sie."
  chown root:root "$LE_CERT" "$LE_KEY"
  chmod 644 "$LE_CERT"
  chmod 600 "$LE_KEY"

  NEW_CERT="$LE_CERT"
  NEW_KEY="$LE_KEY"
else
  [ -f "$SELFSIGNED_CERT" ] && [ -f "$SELFSIGNED_KEY" ] \
    || err "Brak tymczasowego certyfikatu self-signed (${SELFSIGNED_CERT}) - nietypowa instalacja, sprawdz recznie."
  NEW_CERT="$SELFSIGNED_CERT"
  NEW_KEY="$SELFSIGNED_KEY"
fi

# --- Zapamietaj poprzedni stan (do rollbacku) ---
OLD_CERT="$(postconf -h smtpd_tls_cert_file 2>/dev/null || true)"
OLD_KEY="$(postconf -h smtpd_tls_key_file 2>/dev/null || true)"
DOVECOT_BACKUP="$(mktemp)"
cp -p "$DOVECOT_CONF" "$DOVECOT_BACKUP"

rollback() {
  [ -n "$OLD_CERT" ] && postconf -e "smtpd_tls_cert_file=${OLD_CERT}" >/dev/null 2>&1
  [ -n "$OLD_KEY" ] && postconf -e "smtpd_tls_key_file=${OLD_KEY}" >/dev/null 2>&1
  cp -p "$DOVECOT_BACKUP" "$DOVECOT_CONF"
  systemctl reload postfix dovecot >/dev/null 2>&1 || true
  rm -f "$DOVECOT_BACKUP"
}

# --- Postfix ---
postconf -e "smtpd_tls_cert_file=${NEW_CERT}"
postconf -e "smtpd_tls_key_file=${NEW_KEY}"

if ! postfix check 2>/tmp/mail-tls-swap.err; then
  MSG="$(cat /tmp/mail-tls-swap.err 2>/dev/null)"
  rm -f /tmp/mail-tls-swap.err
  rollback
  err "Nowa konfiguracja TLS Postfixa nie przeszla 'postfix check': ${MSG} - przywrocono poprzedni stan."
fi
rm -f /tmp/mail-tls-swap.err

# --- Dovecot ---
sed -i \
  -e "s|^ssl_cert = <.*|ssl_cert = <${NEW_CERT}|" \
  -e "s|^ssl_key = <.*|ssl_key = <${NEW_KEY}|" \
  "$DOVECOT_CONF"

if ! dovecot -n >/dev/null 2>/tmp/mail-tls-swap.err; then
  MSG="$(cat /tmp/mail-tls-swap.err 2>/dev/null)"
  rm -f /tmp/mail-tls-swap.err
  rollback
  err "Nowa konfiguracja TLS Dovecota nie przeszla walidacji (dovecot -n): ${MSG} - przywrocono poprzedni stan (obu uslug)."
fi
rm -f /tmp/mail-tls-swap.err

# --- Reload obu uslug ---
if ! systemctl reload postfix 2>/tmp/mail-tls-swap.err || ! systemctl reload dovecot 2>>/tmp/mail-tls-swap.err; then
  MSG="$(cat /tmp/mail-tls-swap.err 2>/dev/null)"
  rm -f /tmp/mail-tls-swap.err
  rollback
  err "Przeladowanie postfix/dovecot z nowym certyfikatem nie powiodlo sie: ${MSG} - przywrocono poprzedni stan."
fi
rm -f /tmp/mail-tls-swap.err
rm -f "$DOVECOT_BACKUP"

if [ "$ACTION" = "enable" ]; then
  echo "OK: Postfix i Dovecot uzywaja teraz certyfikatu Let's Encrypt dla ${DOMAIN}."
else
  echo "OK: Postfix i Dovecot przywrocone do certyfikatu tymczasowego self-signed."
fi
