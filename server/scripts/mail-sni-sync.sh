#!/usr/bin/env bash
#
# Synchronizuje certyfikaty TLS per "mail.<domena>" (domeny mailowe
# wlasnych stron hostingowych, wlaczone przez "Obsluga poczty" w panelu
# usera - Strony -> Dodaj strone) z magazynu certow Caddy do Postfixa i
# Dovecota, przez prawdziwe SNI (Server Name Indication) - DODATKOWA
# warstwa obok pojedynczego, domyslnego certyfikatu (mail-tls-swap.sh),
# ktory zostaje FALLBACKIEM dla polaczen bez dopasowania SNI (np. wprost
# po adresie IP) oraz dla wlasnej domeny panelu.
#
# Zrodlo certyfikatu: WEWNETRZNY magazyn certow Caddy (ta sama, juz
# zweryfikowana na zywym serwerze 2026-08-14 sciezka co w
# mail-tls-swap.sh):
#   /var/lib/caddy/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory/<domena>/<domena>.crt
#   /var/lib/caddy/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory/<domena>/<domena>.key
#
# Postfix (tls_server_sni_maps, bootstrap w mail-install.sh): mapa
# "<domena> <sciezka do POLACZONEGO pliku klucz+cert>" - Postfix wymaga
# JEDNEGO pliku PEM (najpierw prywatny klucz, potem certyfikat), nie
# oddzielnych cert=/key=.
# Dovecot (bootstrap w mail-install.sh, plik 92-caddy-dashboard-sni.conf):
# blok "local_name <domena> { ssl_cert = <plik ssl_key = <plik }" per
# domena, oddzielne pliki (jak w 90-caddy-dashboard.conf).
#
# Kazda synchronizacja REGENERUJE OBIE mapy w calosci na podstawie
# zawartosci /etc/pki/tls/mail-sni/ (ten sam wzorzec regeneracji-z-listy
# co mail-virtual-domain.sh dla virtual_mailbox_domains) - katalog
# /etc/pki/tls/mail-sni/<domena>/ jest wiec jedynym zrodlem prawdy o tym,
# ktore domeny maja juz zsynchronizowany certyfikat SNI.
#
# Walidacja PRZED przeladowaniem (postfix check / dovecot -n), z
# rollbackiem obu plikow map do poprzedniej tresci przy niepowodzeniu -
# ten sam wzorzec co mail-tls-swap.sh/postfix-set-limits.sh.
#
# Uzycie:
#   mail-sni-sync.sh sync <mail-domena>
#   mail-sni-sync.sh remove <mail-domena>
#   mail-sni-sync.sh list

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

DOMAIN_RE='^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$'
SNI_DIR="/etc/pki/tls/mail-sni"
SNI_MAP_FILE="/etc/postfix/mail-sni-map"
SNI_DOVECOT_FILE="/etc/dovecot/conf.d/92-caddy-dashboard-sni.conf"
CADDY_CERT_DIR_BASE="/var/lib/caddy/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory"

[ -f "$SNI_DOVECOT_FILE" ] || err "${SNI_DOVECOT_FILE} nie istnieje - Poczta (Postfix/Dovecot) jest jeszcze niezainstalowana."

mkdir -p "$SNI_DIR"

# Regeneruje OBIE mapy (Postfix hash: + Dovecot local_name) z aktualnej
# zawartosci $SNI_DIR - wywolywane po KAZDEJ zmianie (dodaniu/usunieciu),
# nigdy recznie edytowane.
regenerate_maps() {
  : > "${SNI_MAP_FILE}.tmp"
  {
    echo "# Zarzadzane przez Caddy Dashboard - server/scripts/mail-sni-sync.sh"
  } > "${SNI_DOVECOT_FILE}.tmp"

  for dir in "$SNI_DIR"/*/; do
    [ -d "$dir" ] || continue
    local_domain="$(basename "$dir")"
    postfix_pem="${dir}postfix.pem"
    dovecot_cert="${dir}dovecot-cert.pem"
    dovecot_key="${dir}dovecot-key.pem"
    [ -f "$postfix_pem" ] || continue
    printf '%s %s\n' "$local_domain" "$postfix_pem" >> "${SNI_MAP_FILE}.tmp"
    if [ -f "$dovecot_cert" ] && [ -f "$dovecot_key" ]; then
      {
        printf 'local_name %s {\n' "$local_domain"
        printf '  ssl_cert = <%s\n' "$dovecot_cert"
        printf '  ssl_key = <%s\n' "$dovecot_key"
        printf '}\n'
      } >> "${SNI_DOVECOT_FILE}.tmp"
    fi
  done

  mv "${SNI_MAP_FILE}.tmp" "$SNI_MAP_FILE"
  # lmdb: (NIE hash:) - na AlmaLinux/Rocky 10 Postfix jest budowany bez
  # Berkeley DB, "hash:" psulo TLS dla WSZYSTKICH polaczen (potwierdzone
  # na zywym serwerze 2026-08-15, "unsupported dictionary type: hash").
  # Musi byc zgodne z postconf -e "tls_server_sni_maps=lmdb:..." w
  # mail-install.sh - plik .lmdb, NIE .db.
  # `-F` OBOWIAZKOWE dla tls_server_sni_maps (inaczej niz dla zwyklych
  # tabel routingu w tym projekcie) - bez tego smtpd loguje "malformed
  # BASE64 value" i odrzuca KAZDE polaczenie TLS z SNI dopasowanym do tej
  # mapy (potwierdzone na zywym serwerze 2026-08-15, realny Gmail
  # inbound do mail.autoai.qd.je - zrodlo:
  # https://www.mail-archive.com/postfix-users@postfix.org/msg91707.html).
  postmap -F lmdb:"$SNI_MAP_FILE" || err "postmap ${SNI_MAP_FILE} nie powiodlo sie."
  chmod 644 "$SNI_MAP_FILE" "${SNI_MAP_FILE}.lmdb" 2>/dev/null || true

  mv "${SNI_DOVECOT_FILE}.tmp" "$SNI_DOVECOT_FILE"
  chmod 644 "$SNI_DOVECOT_FILE"
}

ACTION="${1:-}"

case "$ACTION" in
  list)
    for dir in "$SNI_DIR"/*/; do
      [ -d "$dir" ] || continue
      [ -f "${dir}postfix.pem" ] && basename "$dir"
    done
    ;;

  # Jak "list", ale z data wygasniecia certyfikatu (epoch, sekundy) -
  # user zglosil 2026-08-16 potrzebe pokazania "ile dni zostalo do
  # odnowienia" w panelu, zamiast samego statusu tak/nie. Certyfikat NIE
  # odnawia sie tu sam (Caddy go odnawia we WLASNYM magazynie, ale
  # mail-sni-sync.sh trzeba kliknac RECZNIE zeby skopiowac nowa wersje do
  # Postfixa/Dovecota) - stad ta informacja ma realna wartosc ostrzegawcza.
  # dovecot-cert.pem (NIE postfix.pem, ktory zawiera material klucza) -
  # bezpieczny do odczytu samego certyfikatu, ta sama tresc X.509 co w
  # postfix.pem, tylko bez klucza prywatnego doklejonego przed nim.
  list-detail)
    for dir in "$SNI_DIR"/*/; do
      [ -d "$dir" ] || continue
      [ -f "${dir}postfix.pem" ] || continue
      domain="$(basename "$dir")"
      cert="${dir}dovecot-cert.pem"
      not_after_epoch=""
      if [ -f "$cert" ]; then
        not_after_raw="$(openssl x509 -enddate -noout -in "$cert" 2>/dev/null | sed 's/^notAfter=//')"
        [ -n "$not_after_raw" ] && not_after_epoch="$(date -d "$not_after_raw" +%s 2>/dev/null || true)"
      fi
      printf '%s|%s\n' "$domain" "$not_after_epoch"
    done
    ;;

  sync)
    DOMAIN="${2:-}"
    DOMAIN="${DOMAIN,,}"
    [[ "$DOMAIN" =~ $DOMAIN_RE ]] || err "nieprawidlowa domena: '${DOMAIN}'."

    SRC_CRT="${CADDY_CERT_DIR_BASE}/${DOMAIN}/${DOMAIN}.crt"
    SRC_KEY="${CADDY_CERT_DIR_BASE}/${DOMAIN}/${DOMAIN}.key"
    [ -f "$SRC_CRT" ] && [ -f "$SRC_KEY" ] \
      || err "Caddy jeszcze nie wydal certyfikatu dla ${DOMAIN} - sprawdz, czy strona jest juz zywa i DNS na nia wskazuje (musi byc co najmniej jedno udane polaczenie HTTPS, zeby Caddy dokonczyl ACME)."

    DEST_DIR="${SNI_DIR}/${DOMAIN}"
    mkdir -p "$DEST_DIR"

    # Postfix: JEDEN plik, klucz + certyfikat, w tej kolejnosci (patrz
    # komentarz na gorze pliku) - zawiera material klucza, wiec root:root
    # 600, ten sam wzorzec co mail-tls-swap.sh.
    cat "$SRC_KEY" "$SRC_CRT" > "${DEST_DIR}/postfix.pem.new" \
      || err "Skladanie polaczonego PEM dla Postfixa nie powiodlo sie."
    chown root:root "${DEST_DIR}/postfix.pem.new"
    chmod 600 "${DEST_DIR}/postfix.pem.new"
    mv "${DEST_DIR}/postfix.pem.new" "${DEST_DIR}/postfix.pem"

    # Dovecot: oddzielne pliki cert/key (jak 90-caddy-dashboard.conf) -
    # klucz root:root 600, certyfikat (bez materialu klucza) 644.
    cp "$SRC_CRT" "${DEST_DIR}/dovecot-cert.pem.new" || err "Kopiowanie certyfikatu dla Dovecota nie powiodlo sie."
    cp "$SRC_KEY" "${DEST_DIR}/dovecot-key.pem.new" || err "Kopiowanie klucza dla Dovecota nie powiodlo sie."
    chown root:root "${DEST_DIR}/dovecot-cert.pem.new" "${DEST_DIR}/dovecot-key.pem.new"
    chmod 644 "${DEST_DIR}/dovecot-cert.pem.new"
    chmod 600 "${DEST_DIR}/dovecot-key.pem.new"
    mv "${DEST_DIR}/dovecot-cert.pem.new" "${DEST_DIR}/dovecot-cert.pem"
    mv "${DEST_DIR}/dovecot-key.pem.new" "${DEST_DIR}/dovecot-key.pem"
    ;;

  remove)
    DOMAIN="${2:-}"
    DOMAIN="${DOMAIN,,}"
    [[ "$DOMAIN" =~ $DOMAIN_RE ]] || err "nieprawidlowa domena: '${DOMAIN}'."
    rm -rf "${SNI_DIR:?}/${DOMAIN}"
    ;;

  *)
    err "nieznana akcja '${ACTION}' (oczekiwano sync|remove|list)."
    ;;
esac

if [ "$ACTION" = "sync" ] || [ "$ACTION" = "remove" ]; then
  # --- Zapamietaj poprzedni stan (do rollbacku) ---
  MAP_BACKUP="$(mktemp)"
  DOVECOT_BACKUP="$(mktemp)"
  cp -p "$SNI_MAP_FILE" "$MAP_BACKUP" 2>/dev/null || : > "$MAP_BACKUP"
  cp -p "$SNI_DOVECOT_FILE" "$DOVECOT_BACKUP"

  rollback() {
    cp -p "$MAP_BACKUP" "$SNI_MAP_FILE"
    postmap -F lmdb:"$SNI_MAP_FILE" >/dev/null 2>&1 || true
    cp -p "$DOVECOT_BACKUP" "$SNI_DOVECOT_FILE"
    systemctl reload postfix dovecot >/dev/null 2>&1 || true
    rm -f "$MAP_BACKUP" "$DOVECOT_BACKUP"
  }

  regenerate_maps

  CHECK_OUT="$(mktemp)"
  if ! postfix check >"$CHECK_OUT" 2>&1; then
    ERR_MSG="$(cat "$CHECK_OUT")"
    rm -f "$CHECK_OUT"
    rollback
    err "Konfiguracja Postfixa nie przeszla walidacji (postfix check) po synchronizacji SNI - wycofano zmiany. ${ERR_MSG}"
  fi

  if ! dovecot -n >"$CHECK_OUT" 2>&1; then
    ERR_MSG="$(cat "$CHECK_OUT")"
    rm -f "$CHECK_OUT"
    rollback
    err "Konfiguracja Dovecota nie przeszla walidacji (dovecot -n) po synchronizacji SNI - wycofano zmiany. ${ERR_MSG}"
  fi
  rm -f "$CHECK_OUT"

  systemctl reload postfix dovecot || err "Przeladowanie postfix/dovecot nie powiodlo sie."
  rm -f "$MAP_BACKUP" "$DOVECOT_BACKUP"
fi

echo "OK: ${ACTION} ${2:-} zakonczone."
