#!/usr/bin/env bash
#
# Sprawdza/naprawia uprawnienia katalogu logow Caddy i wszystkich plikow
# logow (globalny /var/log/caddy/caddy.log z bloku wydajnosci - patrz
# server/services/caddyPerformance.js - oraz per-domena
# /var/log/caddy/<domena>.log tworzone przez hosting-user-site.sh).
#
# Powod istnienia: `caddy validate`/`caddy adapt` faktycznie PROWIZJONUJE
# config (w tym modul loggera) i dziala jako root (sudo), wiec to WLASNIE
# ono, nie usluga Caddy (caddy:caddy), moze jako pierwsze utworzyc plik
# loga (root:root, 0600) - wtedy prawdziwa usluga Caddy nie ma juz prawa go
# otworzyc do zapisu, dopoki ktos recznie nie poprawi wlasciciela. Ten
# skrypt to recznie wywolywana naprawa (przycisk w panelu: Uslugi -> Caddy)
# na wypadek gdyby cokolwiek (reinstalacja, reczna edycja Caddyfile, stary
# stan sprzed wprowadzenia tych zabezpieczen) zostawilo logi w zlym stanie -
# idempotentna, bez efektow ubocznych jesli wszystko juz jest poprawne.
#
# "default" (plik default.caddy - domyslny fallback dla nieskonfigurowanych
# domen, patrz install.sh) jest celowo pomijany - nie ma wlasnego bloku
# `log` per-domena, wiec nie ma tez wlasnego pliku loga.
#
# Uzycie: caddy-ensure-logs.sh (bez argumentow, dziala jako root)

set -uo pipefail

LOG_DIR="/var/log/caddy"
SITES_DIR="/etc/caddy/sites"
FIXED=0

mkdir -p "$LOG_DIR" || { echo "BLAD: nie udalo sie utworzyc ${LOG_DIR}." >&2; exit 1; }
chown caddy:caddy "$LOG_DIR"
chmod 0755 "$LOG_DIR"

ensure_log_file() {
  local file="$1"
  if [ ! -f "$file" ]; then
    : > "$file" || { echo "BLAD: nie udalo sie utworzyc ${file}." >&2; return 1; }
  fi
  chown caddy:caddy "$file"
  chmod 0644 "$file"
  FIXED=$((FIXED + 1))
}

ensure_log_file "${LOG_DIR}/caddy.log"

if [ -d "$SITES_DIR" ]; then
  shopt -s nullglob
  for f in "$SITES_DIR"/*.caddy "$SITES_DIR"/*.caddy.disabled; do
    DOMAIN="$(basename "$f")"
    DOMAIN="${DOMAIN%.disabled}"
    DOMAIN="${DOMAIN%.caddy}"
    [ "$DOMAIN" = "default" ] && continue
    ensure_log_file "${LOG_DIR}/${DOMAIN}.log"
  done
  shopt -u nullglob
fi

echo "OK: katalog logow ${LOG_DIR} i ${FIXED} plik(i) logow sprawdzone/naprawione."
