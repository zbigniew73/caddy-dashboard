#!/usr/bin/env bash
#
# Wstawia/zamienia zarzadzany blok globalnych opcji wydajnosci Caddy na
# poczatku Caddyfile (tresc bloku, z markerami, czytana ze stdin). Formatuje
# (caddy fmt) i waliduje (caddy validate) na kopii roboczej PRZED dotknieciem
# prawdziwego pliku - jesli walidacja sie nie powiedzie, oryginalny Caddyfile
# w ogole nie jest ruszany. Po udanym zapisie przeladowuje caddy; przy
# niepowodzeniu przeladowania przywraca poprzednia wersje pliku.

set -uo pipefail

CADDYFILE="/etc/caddy/Caddyfile"
MARK_START="# BEGIN caddy-dashboard-performance"
MARK_END="# END caddy-dashboard-performance"
TMP="$(mktemp)"
ERR_LOG="$(mktemp)"

cleanup() { rm -f "$TMP" "$ERR_LOG"; }
trap cleanup EXIT

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
