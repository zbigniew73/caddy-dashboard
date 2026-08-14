#!/usr/bin/env bash
#
# Zarzadza wirtualnymi domenami pocztowymi (klienci hostingu, NIEZALEZNE
# od kont systemowych/SSH - patrz mail-install.sh, sekcja "Wirtualne
# domeny/skrzynki"). Zrodlo prawdy: SQLite (/etc/caddy-dashboard/
# mail-virtual.db, tabela "domains"). Kazda zmiana regeneruje plaski plik
# Postfixa (virtual_mailbox_domains) i przeladowuje uslugE.
#
# Uzycie:
#   mail-virtual-domain.sh add <domena> <owner_account>
#   mail-virtual-domain.sh remove <domena>
#   mail-virtual-domain.sh list

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

VMAIL_DB="/etc/caddy-dashboard/mail-virtual.db"
VIRTUAL_DOMAINS_FILE="/etc/postfix/virtual-domains"
DOMAIN_RE='^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$'
ACCOUNT_RE='^srv_[0-9]+$'

[ -f "$VMAIL_DB" ] || err "Poczta (wirtualne domeny) nie jest zainstalowana/zainicjalizowana - uruchom najpierw instalacje Poczty."

sql() {
  sqlite3 "$VMAIL_DB" "$1"
}

regen_virtual_domains() {
  sql "SELECT domain FROM domains;" | while IFS= read -r d; do
    printf '%s OK\n' "$d"
  done > "$VIRTUAL_DOMAINS_FILE"
  postmap "$VIRTUAL_DOMAINS_FILE" || err "postmap ${VIRTUAL_DOMAINS_FILE} nie powiodlo sie."
  chmod 644 "$VIRTUAL_DOMAINS_FILE" "${VIRTUAL_DOMAINS_FILE}.db" 2>/dev/null || true
  systemctl reload postfix >/dev/null 2>&1 || err "Przeladowanie postfix nie powiodlo sie."
}

ACTION="${1:-}"

case "$ACTION" in
  list)
    sql "SELECT domain || '|' || owner_account || '|' || created_at FROM domains ORDER BY domain;"
    ;;

  add)
    DOMAIN="${2:-}"
    OWNER_ACCOUNT="${3:-}"
    DOMAIN="${DOMAIN,,}"
    [[ "$DOMAIN" =~ $DOMAIN_RE ]] || err "nieprawidlowa domena: '${DOMAIN}'."
    [[ "$OWNER_ACCOUNT" =~ $ACCOUNT_RE ]] || err "nieprawidlowe konto hostingowe: '${OWNER_ACCOUNT}' (oczekiwano srv_<numer>)."

    # Domena NIE MOZE byc jednoczesnie "systemowa" (mydestination) i
    # "wirtualna" - Postfix odrzuca taki config przy `postfix check`.
    # Sprawdzane na ZYWO (nie kopia), zeby dzialalo tez gdy admin dopiero
    # co dodal domene panelu.
    if postconf -h mydestination 2>/dev/null | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -qxF "$DOMAIN"; then
      err "Domena '${DOMAIN}' jest juz domena panelu (mydestination) - nie moze byc jednoczesnie wirtualna."
    fi

    EXISTING="$(sql "SELECT 1 FROM domains WHERE domain = '${DOMAIN//\'/\'\'}';")"
    [ -z "$EXISTING" ] || err "Domena '${DOMAIN}' jest juz dodana jako wirtualna."

    CREATED_AT="$(date -Iseconds)"
    sql "INSERT INTO domains (domain, owner_account, created_at) VALUES ('${DOMAIN//\'/\'\'}', '${OWNER_ACCOUNT//\'/\'\'}', '${CREATED_AT}');" \
      || err "Zapis domeny do bazy nie powiodl sie."

    mkdir -p "/var/mail/vhosts/${DOMAIN}"
    chown vmail:vmail "/var/mail/vhosts/${DOMAIN}"
    chmod 750 "/var/mail/vhosts/${DOMAIN}"

    regen_virtual_domains
    echo "OK: domena '${DOMAIN}' dodana (wlasciciel: ${OWNER_ACCOUNT})."
    ;;

  remove)
    DOMAIN="${2:-}"
    DOMAIN="${DOMAIN,,}"
    [[ "$DOMAIN" =~ $DOMAIN_RE ]] || err "nieprawidlowa domena: '${DOMAIN}'."

    DOMAIN_ID="$(sql "SELECT id FROM domains WHERE domain = '${DOMAIN//\'/\'\'}';")"
    [ -n "$DOMAIN_ID" ] || err "Domena '${DOMAIN}' nie jest zarejestrowana jako wirtualna."

    MAILBOX_COUNT="$(sql "SELECT COUNT(*) FROM mailboxes WHERE domain_id = ${DOMAIN_ID};")"
    ALIAS_COUNT="$(sql "SELECT COUNT(*) FROM aliases WHERE domain_id = ${DOMAIN_ID};")"
    if [ "${MAILBOX_COUNT:-0}" -gt 0 ] || [ "${ALIAS_COUNT:-0}" -gt 0 ]; then
      err "Domena '${DOMAIN}' ma jeszcze ${MAILBOX_COUNT} skrzynek i ${ALIAS_COUNT} aliasow - usun je najpierw."
    fi

    sql "DELETE FROM domains WHERE id = ${DOMAIN_ID};" || err "Usuniecie domeny z bazy nie powiodlo sie."
    rm -rf "/var/mail/vhosts/${DOMAIN}"

    regen_virtual_domains
    echo "OK: domena '${DOMAIN}' usunieta."
    ;;

  *)
    err "nieznana akcja '${ACTION}' (oczekiwano add|remove|list)."
    ;;
esac
