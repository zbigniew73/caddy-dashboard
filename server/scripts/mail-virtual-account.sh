#!/usr/bin/env bash
#
# Zarzadza kontami (skrzynkami) w ramach juz dodanej wirtualnej domeny
# pocztowej - patrz mail-virtual-domain.sh. Zrodlo prawdy: SQLite
# (/etc/caddy-dashboard/mail-virtual.db, tabela "mailboxes"). Kazda zmiana
# regeneruje plaski plik Postfixa (virtual_mailbox_maps) i przeladowuje
# usluge; Dovecot czyta baze NA ZYWO (bez potrzeby przeladowania przy
# zmianach danych, tylko przy zmianach configu).
#
# Haslo idzie na STDIN (jedna linia), NIGDY jako argument - ten sam powod
# co hosting-user-set-password.sh (argv widoczne przez ps/proc dla
# kazdego lokalnego uzytkownika). WYJATEK: samo `doveadm pw -p` (haszowanie)
# ponizej dostaje haslo jako argument TEGO polecenia - to jedyny
# udokumentowany, nieinteraktywny sposob wywolania doveadm pw, okno
# widocznosci w ps jest bardzo krotkie (pojedyncze polecenie, nie
# dlugozyjacy proces).
#
# Limit skrzynek per DOMENA (nie per konto hostingowe - polityka to "2
# konta e-mail NA JEDNA STRONE WWW", strona=domena) - <max_mailboxes>
# to juz rozstrzygnieta, biezaca wartosc limitu (Node czyta ja z
# server/services/mailLimits.js), skrypt tylko egzekwuje COUNT(*) wzgledem
# tej liczby - nie ma tu wlasnej kopii/domyslnej wartosci.
#
# Uzycie:
#   mail-virtual-account.sh add <domena> <localpart> <max_mailboxes>   (haslo na stdin)
#   mail-virtual-account.sh passwd <domena> <localpart>                (nowe haslo na stdin)
#   mail-virtual-account.sh remove <domena> <localpart>
#   mail-virtual-account.sh list <domena>

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

VMAIL_DB="/etc/caddy-dashboard/mail-virtual.db"
VIRTUAL_MAILBOX_FILE="/etc/postfix/virtual-mailboxes"
DOMAIN_RE='^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$'
LOCALPART_RE='^[a-z0-9][a-z0-9._-]{0,63}$'

[ -f "$VMAIL_DB" ] || err "Poczta (wirtualne domeny) nie jest zainstalowana/zainicjalizowana - uruchom najpierw instalacje Poczty."

sql() {
  sqlite3 "$VMAIL_DB" "$1"
}
esc() {
  printf '%s' "${1//\'/\'\'}"
}

get_domain_id() {
  local domain="$1"
  sql "SELECT id FROM domains WHERE domain = '$(esc "$domain")';"
}

regen_virtual_mailboxes() {
  # Format wymagany przez Postfix (virtual_mailbox_maps): "adres wzgledna/sciezka/do/Maildir/"
  sql "SELECT mailboxes.localpart || '@' || domains.domain || ' ' || domains.domain || '/' || mailboxes.localpart || '/Maildir/' FROM mailboxes JOIN domains ON domains.id = mailboxes.domain_id;" \
    > "$VIRTUAL_MAILBOX_FILE"
  postmap "$VIRTUAL_MAILBOX_FILE" || err "postmap ${VIRTUAL_MAILBOX_FILE} nie powiodlo sie."
  chmod 644 "$VIRTUAL_MAILBOX_FILE" "${VIRTUAL_MAILBOX_FILE}.db" 2>/dev/null || true
  systemctl reload postfix >/dev/null 2>&1 || err "Przeladowanie postfix nie powiodlo sie."
}

ACTION="${1:-}"
DOMAIN="${2:-}"
DOMAIN="${DOMAIN,,}"
[[ "$DOMAIN" =~ $DOMAIN_RE ]] || err "nieprawidlowa domena: '${DOMAIN}'."

case "$ACTION" in
  list)
    DOMAIN_ID="$(get_domain_id "$DOMAIN")"
    [ -n "$DOMAIN_ID" ] || err "Domena '${DOMAIN}' nie jest zarejestrowana jako wirtualna."
    sql "SELECT localpart || '|' || enabled || '|' || created_at FROM mailboxes WHERE domain_id = ${DOMAIN_ID} ORDER BY localpart;"
    ;;

  add)
    LOCALPART="${3:-}"
    LOCALPART="${LOCALPART,,}"
    MAX_MAILBOXES="${4:-}"
    [[ "$LOCALPART" =~ $LOCALPART_RE ]] || err "nieprawidlowy login skrzynki: '${LOCALPART}'."
    [[ "$MAX_MAILBOXES" =~ ^[0-9]+$ ]] || err "nieprawidlowy limit skrzynek: '${MAX_MAILBOXES}'."

    DOMAIN_ID="$(get_domain_id "$DOMAIN")"
    [ -n "$DOMAIN_ID" ] || err "Domena '${DOMAIN}' nie jest zarejestrowana jako wirtualna."

    EXISTING="$(sql "SELECT 1 FROM mailboxes WHERE domain_id = ${DOMAIN_ID} AND localpart = '$(esc "$LOCALPART")';")"
    [ -z "$EXISTING" ] || err "Skrzynka '${LOCALPART}@${DOMAIN}' juz istnieje."

    CURRENT_COUNT="$(sql "SELECT COUNT(*) FROM mailboxes WHERE domain_id = ${DOMAIN_ID};")"
    [ "${CURRENT_COUNT:-0}" -lt "$MAX_MAILBOXES" ] || err "Osiagnieto limit skrzynek dla domeny '${DOMAIN}' (${CURRENT_COUNT}/${MAX_MAILBOXES})."

    PASSWORD="$(cat -)"
    [ -n "$PASSWORD" ] || err "puste haslo."
    HASH="$(doveadm pw -s SHA512-CRYPT -p "$PASSWORD")" || err "haszowanie hasla (doveadm pw) nie powiodlo sie."

    mkdir -p "/var/mail/vhosts/${DOMAIN}/${LOCALPART}/Maildir"
    chown -R vmail:vmail "/var/mail/vhosts/${DOMAIN}/${LOCALPART}"
    chmod -R 700 "/var/mail/vhosts/${DOMAIN}/${LOCALPART}"

    CREATED_AT="$(date -Iseconds)"
    sql "INSERT INTO mailboxes (domain_id, localpart, password_hash, enabled, maildir, created_at) VALUES (${DOMAIN_ID}, '$(esc "$LOCALPART")', '$(esc "$HASH")', 1, '${DOMAIN}/${LOCALPART}/Maildir/', '${CREATED_AT}');" \
      || err "Zapis skrzynki do bazy nie powiodl sie."

    regen_virtual_mailboxes
    echo "OK: skrzynka '${LOCALPART}@${DOMAIN}' utworzona."
    ;;

  passwd)
    LOCALPART="${3:-}"
    LOCALPART="${LOCALPART,,}"
    [[ "$LOCALPART" =~ $LOCALPART_RE ]] || err "nieprawidlowy login skrzynki: '${LOCALPART}'."

    DOMAIN_ID="$(get_domain_id "$DOMAIN")"
    [ -n "$DOMAIN_ID" ] || err "Domena '${DOMAIN}' nie jest zarejestrowana jako wirtualna."
    EXISTING="$(sql "SELECT 1 FROM mailboxes WHERE domain_id = ${DOMAIN_ID} AND localpart = '$(esc "$LOCALPART")';")"
    [ -n "$EXISTING" ] || err "Skrzynka '${LOCALPART}@${DOMAIN}' nie istnieje."

    PASSWORD="$(cat -)"
    [ -n "$PASSWORD" ] || err "puste haslo."
    HASH="$(doveadm pw -s SHA512-CRYPT -p "$PASSWORD")" || err "haszowanie hasla (doveadm pw) nie powiodlo sie."

    sql "UPDATE mailboxes SET password_hash = '$(esc "$HASH")' WHERE domain_id = ${DOMAIN_ID} AND localpart = '$(esc "$LOCALPART")';" \
      || err "Aktualizacja hasla w bazie nie powiodla sie."
    echo "OK: haslo zmienione dla '${LOCALPART}@${DOMAIN}'."
    ;;

  remove)
    LOCALPART="${3:-}"
    LOCALPART="${LOCALPART,,}"
    [[ "$LOCALPART" =~ $LOCALPART_RE ]] || err "nieprawidlowy login skrzynki: '${LOCALPART}'."

    DOMAIN_ID="$(get_domain_id "$DOMAIN")"
    [ -n "$DOMAIN_ID" ] || err "Domena '${DOMAIN}' nie jest zarejestrowana jako wirtualna."
    EXISTING="$(sql "SELECT 1 FROM mailboxes WHERE domain_id = ${DOMAIN_ID} AND localpart = '$(esc "$LOCALPART")';")"
    [ -n "$EXISTING" ] || err "Skrzynka '${LOCALPART}@${DOMAIN}' nie istnieje."

    sql "DELETE FROM mailboxes WHERE domain_id = ${DOMAIN_ID} AND localpart = '$(esc "$LOCALPART")';" \
      || err "Usuniecie skrzynki z bazy nie powiodlo sie."
    rm -rf "/var/mail/vhosts/${DOMAIN}/${LOCALPART}"

    regen_virtual_mailboxes
    echo "OK: skrzynka '${LOCALPART}@${DOMAIN}' usunieta."
    ;;

  *)
    err "nieznana akcja '${ACTION}' (oczekiwano add|passwd|remove|list)."
    ;;
esac
