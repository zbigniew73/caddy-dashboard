#!/usr/bin/env bash
#
# Wstawia/zamienia zarzadzany blok globalnych opcji wydajnosci Caddy na
# poczatku Caddyfile (tresc bloku, z markerami, czytana ze stdin). Formatuje
# (caddy fmt), adaptuje (caddy adapt) i waliduje (caddy validate) na kopii
# roboczej PRZED dotknieciem prawdziwego pliku - jesli ktorykolwiek z tych
# krokow sie nie powiedzie, oryginalny Caddyfile w ogole nie jest ruszany.
# Po udanym zapisie przeladowuje caddy; przy niepowodzeniu przeladowania
# przywraca poprzednia wersje pliku.

set -uo pipefail

CADDYFILE="/etc/caddy/Caddyfile"
MARK_START="# BEGIN caddy-dashboard-performance"
MARK_END="# END caddy-dashboard-performance"
TMP="$(mktemp)"
ERR_LOG="$(mktemp)"

cleanup() { rm -f "$TMP" "$ERR_LOG"; }
trap cleanup EXIT

if [ "${1:-}" = "get" ]; then
  if [ -f "$CADDYFILE" ]; then
    cat "$CADDYFILE"
  fi
  exit 0
fi

# get-sites: zrzuca zawartosc wszystkich prawdziwych plikow strony pod
# /etc/caddy/sites (wlaczajac .caddy.disabled - zatrzymana strona to
# nadal "strona", ten sam wzorzec co hosting-account-sites-count.sh),
# pomijajac default.caddy (fallback dla nieskonfigurowanych domen, nie
# jest "strona" w sensie liczonym przez kafelek). Uzywane przez
# getSiteCount() w caddyPerformance.js do policzenia PRAWDZIWEJ liczby
# stron - glowny Caddyfile ma tylko `import /etc/caddy/sites/*.caddy`
# (patrz install.sh), wiec bez tej akcji countSiteBlocks() nie widzialby
# nic z tego katalogu. Panel dziala jako osobny user serwisowy (nie w
# grupie caddy), wiec nie ma prawa czytac tego katalogu bezposrednio -
# stad przez sudo, tak samo jak hosting-account-sites-count.sh.
if [ "${1:-}" = "get-sites" ]; then
  SITES_DIR="/etc/caddy/sites"
  if [ -d "$SITES_DIR" ]; then
    find "$SITES_DIR" -maxdepth 1 -type f \( -name '*.caddy' -o -name '*.caddy.disabled' \) \
      ! -name 'default.caddy' ! -name 'default.caddy.disabled' -print0 \
      | while IFS= read -r -d '' f; do
          cat "$f"
          echo
        done
  fi
  exit 0
fi

NEW_BLOCK="$(cat)"

if [ -z "$NEW_BLOCK" ]; then
  echo "BLAD: pusta tresc bloku wydajnosci." >&2
  exit 1
fi

if [ -f "$CADDYFILE" ]; then
  CURRENT="$(cat "$CADDYFILE")"
else
  CURRENT=""
fi

STRIPPED="$(printf '%s\n' "$CURRENT" | awk -v s="$MARK_START" -v e="$MARK_END" '
  $0==s {skip=1; next}
  $0==e {skip=0; next}
  skip!=1 {print}
')"

{
  printf '%s\n\n' "$NEW_BLOCK"
  printf '%s' "$STRIPPED"
} > "$TMP"

if ! caddy fmt --overwrite "$TMP" >"$ERR_LOG" 2>&1; then
  echo "BLAD: caddy fmt nie powiodlo sie: $(cat "$ERR_LOG")" >&2
  exit 1
fi

if ! caddy adapt --config "$TMP" --adapter caddyfile >"$ERR_LOG" 2>&1; then
  echo "BLAD: nowy Caddyfile nie przeszedl adaptacji: $(cat "$ERR_LOG")" >&2
  exit 1
fi

if ! caddy validate --config "$TMP" --adapter caddyfile >"$ERR_LOG" 2>&1; then
  echo "BLAD: nowy Caddyfile nie przeszedl walidacji: $(cat "$ERR_LOG")" >&2
  exit 1
fi

BACKUP="${CADDYFILE}.bak-$(date +%Y%m%d%H%M%S)"
if [ -f "$CADDYFILE" ]; then
  cp -p "$CADDYFILE" "$BACKUP" || { echo "BLAD: nie udalo sie zrobic backupu ${CADDYFILE}." >&2; exit 1; }
fi

cp "$TMP" "$CADDYFILE"

if systemctl reload caddy 2>"$ERR_LOG"; then
  echo "OK: Caddyfile zaktualizowany, caddy przeladowany."
  exit 0
fi

ERR_MSG="$(cat "$ERR_LOG")"
if [ -f "$BACKUP" ]; then
  cp -p "$BACKUP" "$CADDYFILE"
  systemctl reload caddy >/dev/null 2>&1 || true
fi
echo "BLAD: nie udalo sie przeladowac caddy z nowa konfiguracja: ${ERR_MSG} - przywrocono poprzedni Caddyfile." >&2
exit 1
