#!/usr/bin/env bash
#
# Zarzadza aliasami/przekierowaniami w ramach juz dodanej wirtualnej
# domeny pocztowej - patrz mail-virtual-domain.sh. Zrodlo prawdy: SQLite
# (/etc/caddy-dashboard/mail-virtual.db, tabela "aliases"). Kazda zmiana
# regeneruje plaski plik Postfixa (virtual_alias_maps) i przeladowuje
# usluge. Cel (<destination>) MOZE byc dowolnym adresem (rowniez spoza
# tej domeny/serwera) - alias to zwykle przekierowanie, nie musi
# wskazywac na istniejaca lokalna skrzynke.
#
# Limit aliasow per DOMENA (ta sama polityka "na jedna strone www" co w
# mail-virtual-account.sh) - <max_aliases> to juz rozstrzygnieta wartosc
# limitu z server/services/mailLimits.js, skrypt tylko egzekwuje COUNT(*).
#
# Uzycie:
#   mail-virtual-alias.sh add <domena> <source_localpart> <destination> <max_aliases>
#   mail-virtual-alias.sh remove <domena> <source_localpart> <destination>
#   mail-virtual-alias.sh list <domena>

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

VMAIL_DB="/etc/caddy-dashboard/mail-virtual.db"
VIRTUAL_ALIAS_FILE="/etc/postfix/virtual-aliases"
DOMAIN_RE='^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$'
LOCALPART_RE='^[a-z0-9][a-z0-9._-]{0,63}$'
EMAIL_RE='^[a-z0-9._%+-]+@([a-z0-9-]+\.)+[a-z]{2,}$'

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

regen_virtual_aliases() {
  sql "SELECT source || ' ' || destination FROM aliases JOIN domains ON domains.id = aliases.domain_id;" \
    > "$VIRTUAL_ALIAS_FILE"
  postmap "$VIRTUAL_ALIAS_FILE" || err "postmap ${VIRTUAL_ALIAS_FILE} nie powiodlo sie."
  chmod 644 "$VIRTUAL_ALIAS_FILE" "${VIRTUAL_ALIAS_FILE}.db" 2>/dev/null || true
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
    sql "SELECT source || '|' || destination || '|' || created_at FROM aliases WHERE domain_id = ${DOMAIN_ID} ORDER BY source;"
    ;;

  add)
    SOURCE_LOCALPART="${3:-}"
    SOURCE_LOCALPART="${SOURCE_LOCALPART,,}"
    DESTINATION="${4:-}"
    DESTINATION="${DESTINATION,,}"
    MAX_ALIASES="${5:-}"
    [[ "$SOURCE_LOCALPART" =~ $LOCALPART_RE ]] || err "nieprawidlowy login zrodlowy: '${SOURCE_LOCALPART}'."
    [[ "$DESTINATION" =~ $EMAIL_RE ]] || err "nieprawidlowy adres docelowy: '${DESTINATION}'."
    [[ "$MAX_ALIASES" =~ ^[0-9]+$ ]] || err "nieprawidlowy limit aliasow: '${MAX_ALIASES}'."

    DOMAIN_ID="$(get_domain_id "$DOMAIN")"
    [ -n "$DOMAIN_ID" ] || err "Domena '${DOMAIN}' nie jest zarejestrowana jako wirtualna."

    SOURCE="${SOURCE_LOCALPART}@${DOMAIN}"
    EXISTING="$(sql "SELECT 1 FROM aliases WHERE domain_id = ${DOMAIN_ID} AND source = '$(esc "$SOURCE")' AND destination = '$(esc "$DESTINATION")';")"
    [ -z "$EXISTING" ] || err "Alias '${SOURCE} -> ${DESTINATION}' juz istnieje."

    CURRENT_COUNT="$(sql "SELECT COUNT(*) FROM aliases WHERE domain_id = ${DOMAIN_ID};")"
    [ "${CURRENT_COUNT:-0}" -lt "$MAX_ALIASES" ] || err "Osiagnieto limit aliasow dla domeny '${DOMAIN}' (${CURRENT_COUNT}/${MAX_ALIASES})."

    CREATED_AT="$(date -Iseconds)"
    sql "INSERT INTO aliases (domain_id, source, destination, created_at) VALUES (${DOMAIN_ID}, '$(esc "$SOURCE")', '$(esc "$DESTINATION")', '${CREATED_AT}');" \
      || err "Zapis aliasu do bazy nie powiodl sie."

    regen_virtual_aliases
    echo "OK: alias '${SOURCE} -> ${DESTINATION}' dodany."
    ;;

  remove)
    SOURCE_LOCALPART="${3:-}"
    SOURCE_LOCALPART="${SOURCE_LOCALPART,,}"
    DESTINATION="${4:-}"
    DESTINATION="${DESTINATION,,}"
    [[ "$SOURCE_LOCALPART" =~ $LOCALPART_RE ]] || err "nieprawidlowy login zrodlowy: '${SOURCE_LOCALPART}'."

    DOMAIN_ID="$(get_domain_id "$DOMAIN")"
    [ -n "$DOMAIN_ID" ] || err "Domena '${DOMAIN}' nie jest zarejestrowana jako wirtualna."

    SOURCE="${SOURCE_LOCALPART}@${DOMAIN}"
    EXISTING="$(sql "SELECT 1 FROM aliases WHERE domain_id = ${DOMAIN_ID} AND source = '$(esc "$SOURCE")' AND destination = '$(esc "$DESTINATION")';")"
    [ -n "$EXISTING" ] || err "Alias '${SOURCE} -> ${DESTINATION}' nie istnieje."

    sql "DELETE FROM aliases WHERE domain_id = ${DOMAIN_ID} AND source = '$(esc "$SOURCE")' AND destination = '$(esc "$DESTINATION")';" \
      || err "Usuniecie aliasu z bazy nie powiodlo sie."

    regen_virtual_aliases
    echo "OK: alias '${SOURCE} -> ${DESTINATION}' usuniety."
    ;;

  *)
    err "nieznana akcja '${ACTION}' (oczekiwano add|remove|list)."
    ;;
esac
