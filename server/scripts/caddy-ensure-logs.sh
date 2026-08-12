#!/usr/bin/env bash
#
# Sprawdza/naprawia uprawnienia katalogu logow Caddy i wszystkich plikow
# logow (globalny /var/log/caddy/caddy.log z bloku wydajnosci - patrz
# server/services/caddyPerformance.js - oraz per-domena
# /var/log/caddy/<domena>.log tworzone przez hosting-user-site.sh), samego
# pliku domyslnego fallbacku /etc/caddy/sites/default.caddy (patrz
# install.sh) - jesli go brakuje, tworzy go od nowa; jesli istnieje, tylko
# poprawia wlasciciela/uprawnienia (tresci NIE dotyka, na wypadek recznych
# zmian) - a takze (opcjonalnie, patrz nizej) wlasciciela plikow
# per-domena /etc/caddy/sites/<domena>.caddy(.disabled).
#
# Powod istnienia: `caddy validate`/`caddy adapt` faktycznie PROWIZJONUJE
# config (w tym modul loggera) i dziala jako root (sudo), wiec to WLASNIE
# ono, nie usluga Caddy (caddy:caddy), moze jako pierwsze utworzyc plik
# loga (root:root, 0600) - wtedy prawdziwa usluga Caddy nie ma juz prawa go
# otworzyc do zapisu, dopoki ktos recznie nie poprawi wlasciciela. Ten sam
# problem (plik nalezacy do root, bez grupy caddy) moze dotknac
# default.caddy ORAZ plikow per-domena, jesli ktos edytuje je recznie jako
# root (np. przez SSH) bez pilnowania `chown`. Ten skrypt to recznie
# wywolywana naprawa (przycisk w panelu: Uslugi -> Caddy) na wypadek gdyby
# cokolwiek (reinstalacja, reczna edycja, stary stan sprzed wprowadzenia
# tych zabezpieczen) zostawilo logi/default.caddy/pliki stron w zlym
# stanie - idempotentna, bez efektow ubocznych jesli wszystko juz jest
# poprawne.
#
# "default" jest pomijany przy naprawie LOGOW - default.caddy nie ma
# wlasnego bloku `log` per-domena, wiec nie ma tez wlasnego pliku loga.
#
# Naprawa wlasciciela plikow per-domena (chown <wlasciciel>:caddy 0640 -
# ten sam wzorzec co hosting-user-site.sh apply: wlasciciel strony ma
# prawo modyfikacji (rw-), grupa caddy ma prawo odczytu (r--) zeby usluga
# Caddy mogla zaimportowac config), a takze samego katalogu ze strona
# (~<wlasciciel>/domains/<domena>/{public,tmp,...} - chown -R
# <wlasciciel>:caddy + chmod 2750 na katalogach, ten sam wzorzec i
# uzasadnienie SGID co w hosting-user-site.sh) jest OPCJONALNA - wymaga
# par "<username> <domena>" na stdin (jedna para na linie; wysyla je panel
# na podstawie data/hosting-sites.json - patrz
# server/services/caddyLogs.js). Uruchomienie recznie bez potoku (stdin =
# terminal) pomija ten krok.
#
# Uzycie: caddy-ensure-logs.sh (bez argumentow, dziala jako root; pary
# "<username> <domena>" opcjonalnie na stdin)

set -uo pipefail

LOG_DIR="/var/log/caddy"
SITES_DIR="/etc/caddy/sites"
DEFAULT_SITE_FILE="${SITES_DIR}/default.caddy"
FIXED=0
FIXED_SITE_FILES=0
FIXED_DOMAIN_DIRS=0

mkdir -p "$LOG_DIR" || { echo "BLAD: nie udalo sie utworzyc ${LOG_DIR}." >&2; exit 1; }
chown caddy:caddy "$LOG_DIR"
chmod 0755 "$LOG_DIR"

if [ -d "$SITES_DIR" ]; then
  if [ ! -f "$DEFAULT_SITE_FILE" ]; then
    cat > "$DEFAULT_SITE_FILE" <<'EOF'
:80, :443 {
	respond "Caddy Dashboard - No site configured for this domain" 404
}
EOF
  fi
  chown root:caddy "$DEFAULT_SITE_FILE"
  chmod 0640 "$DEFAULT_SITE_FILE"
fi

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

if [ ! -t 0 ]; then
  while IFS=' ' read -r SITE_USER SITE_DOMAIN; do
    [ -z "${SITE_USER:-}" ] && continue
    if ! [[ "$SITE_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
      echo "OSTRZEZENIE: pomijam nieprawidlowa nazwe uzytkownika '${SITE_USER}'." >&2
      continue
    fi
    if ! [[ "$SITE_DOMAIN" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$ ]]; then
      echo "OSTRZEZENIE: pomijam nieprawidlowa domene '${SITE_DOMAIN}'." >&2
      continue
    fi
    for suffix in .caddy .caddy.disabled; do
      SITE_FILE="${SITES_DIR}/${SITE_DOMAIN}${suffix}"
      if [ -f "$SITE_FILE" ]; then
        chown "${SITE_USER}:caddy" "$SITE_FILE"
        chmod 0640 "$SITE_FILE"
        FIXED_SITE_FILES=$((FIXED_SITE_FILES + 1))
      fi
    done

    SITE_USER_HOME="$(getent passwd "$SITE_USER" | cut -d: -f6)"
    if [ -n "$SITE_USER_HOME" ]; then
      DOMAIN_DIR="${SITE_USER_HOME}/domains/${SITE_DOMAIN}"
      if [ -d "$DOMAIN_DIR" ]; then
        chown -R "${SITE_USER}:caddy" "$DOMAIN_DIR"
        find "$DOMAIN_DIR" -type d -exec chmod 2750 {} \;
        FIXED_DOMAIN_DIRS=$((FIXED_DOMAIN_DIRS + 1))
      fi
    fi
  done
fi

echo "OK: katalog logow ${LOG_DIR}, ${FIXED} plik(i) logow, ${DEFAULT_SITE_FILE}, ${FIXED_SITE_FILES} plik(i) konfiguracji stron oraz ${FIXED_DOMAIN_DIRS} katalog(i) domen sprawdzone/naprawione."
