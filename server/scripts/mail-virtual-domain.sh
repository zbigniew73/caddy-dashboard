#!/usr/bin/env bash
#
# Zarzadza wirtualnymi domenami pocztowymi (klienci hostingu, NIEZALEZNE
# od kont systemowych/SSH - patrz mail-install.sh, sekcja "Wirtualne
# domeny/skrzynki"). Zrodlo prawdy: MariaDB (baza "mailvirtual", tabela
# "domains"). Postfix odpytuje ja NA ZYWO (mysql: mapa, patrz
# virtual_mailbox_domains w mail-install.sh) - zadnej regeneracji plaskich
# plikow/reloadu tu juz nie ma, zmiana w bazie jest widoczna natychmiast.
#
# Uzycie:
#   mail-virtual-domain.sh add <domena> <owner_account>
#   mail-virtual-domain.sh remove <domena>
#   mail-virtual-domain.sh list

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

MARIADB_PWFILE="/root/.mariadb"
DOMAIN_RE='^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$'
ACCOUNT_RE='^srv_[0-9]+$'

[ -f "$MARIADB_PWFILE" ] || err "Poczta (wirtualne domeny) nie jest zainstalowana/zainicjalizowana - uruchom najpierw instalacje Poczty."
ROOT_PASS="$(cat "$MARIADB_PWFILE")"

# -N -B = bez naglowkow kolumn, tab-separated - identyczny plain output co
# domyslny sqlite3 CLI (server/services/mailVirtual.js parsuje stdout tych
# skryptow linia po linii, split('|') - format musi zostac identyczny).
sql() {
  mariadb -u root -p"${ROOT_PASS}" -N -B -D mailvirtual -e "$1"
}

ACTION="${1:-}"

case "$ACTION" in
  list)
    sql "SELECT CONCAT_WS('|', domain, owner_account, created_at) FROM domains ORDER BY domain;"
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

    echo "OK: domena '${DOMAIN}' usunieta."
    ;;

  *)
    err "nieznana akcja '${ACTION}' (oczekiwano add|remove|list)."
    ;;
esac
