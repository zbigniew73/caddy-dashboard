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
# Caddy mogla zaimportowac config - TO jest jedyne miejsce gdzie grupa
# caddy jeszcze wystepuje, dotyczy samego pliku *.caddy w SITES_BASE_DIR,
# nie tresci strony), a takze KATALOGU DOMOWEGO, ~/domains, katalogu
# strony i public/ (DirectAdmin-style - bez grupy caddy, same uprawnienia
# "other": chown <wlasciciel>:<wlasciciel> + chmod 0711 na
# home/domains/<domena>, chmod 0755 na public/ - wzorzec z
# hosting-account-create.sh / hosting-user-site.sh) jest OPCJONALNA -
# wymaga par "<username> <domena>" na stdin (jedna para na linie; wysyla
# je panel na podstawie data/hosting-sites.json - patrz
# server/services/caddyLogs.js). Uruchomienie recznie bez potoku (stdin =
# terminal) pomija ten krok.
#
# Katalog domowy jest NAJCZESTSZYM realnym zrodlem 403 z Caddy - jesli ma
# domyslne uprawnienia z `useradd -m` (0700, wlasciciel:wlasciciel, bez
# bitu x dla "other"), Caddy nie dotrze do niczego ponizej (~/domains,
# ~/domains/<domena>/public), NIEZALEZNIE jak dobre sa uprawnienia
# glebiej w sciezce - dotyczy to zwlaszcza kont zalozonych PRZED
# wprowadzeniem poprawki 0711 w hosting-account-create.sh. Naprawa NIE
# schodzi rekurencyjnie w glab public/ (i celowo nie dotyka ~/tmp,
# ktory nie jest serwowany) - domyslny umask (022) na koncie usera sam
# nadaje "other read/execute" nowym plikom wgrywanym przez SSH/SFTP,
# wiec wystarczy poprawic tylko strukture zalozona przez panel.
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
FIXED_HOME_DIRS=0
declare -A HOME_DIR_DONE

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
      # Katalog domowy i ~/domains naprawiane RAZ na uzytkownika (nie per
      # domena) - to samo konto moze miec kilka stron. Bez poprawnego
      # 0711 (tylko przejscie dla "other") na SAMYM katalogu domowym,
      # Caddy nie dotrze do niczego ponizej, NIEZALEZNIE jak dobre sa
      # uprawnienia glebiej w sciezce (patrz komentarz w
      # hosting-account-create.sh) - konta zalozone PRZED wprowadzeniem
      # tej poprawki maja czesto katalog domowy 0700 wlasciciel:wlasciciel
      # (domyslne useradd -m), co daje dokladnie 403 z Caddy.
      if [ -z "${HOME_DIR_DONE[$SITE_USER]:-}" ] && [ -d "$SITE_USER_HOME" ]; then
        chown "${SITE_USER}:${SITE_USER}" "$SITE_USER_HOME"
        chmod 0711 "$SITE_USER_HOME"
        USER_DOMAINS_DIR="${SITE_USER_HOME}/domains"
        if [ -d "$USER_DOMAINS_DIR" ]; then
          chown "${SITE_USER}:${SITE_USER}" "$USER_DOMAINS_DIR"
          chmod 0711 "$USER_DOMAINS_DIR"
        fi
        HOME_DIR_DONE[$SITE_USER]=1
        FIXED_HOME_DIRS=$((FIXED_HOME_DIRS + 1))
      fi

      DOMAIN_DIR="${SITE_USER_HOME}/domains/${SITE_DOMAIN}"
      if [ -d "$DOMAIN_DIR" ]; then
        chown "${SITE_USER}:${SITE_USER}" "$DOMAIN_DIR"
        chmod 0711 "$DOMAIN_DIR"
        if [ -d "${DOMAIN_DIR}/public" ]; then
          chown "${SITE_USER}:${SITE_USER}" "${DOMAIN_DIR}/public"
          chmod 0755 "${DOMAIN_DIR}/public"
        fi
        FIXED_DOMAIN_DIRS=$((FIXED_DOMAIN_DIRS + 1))
      fi
    fi
  done
fi

echo "OK: katalog logow ${LOG_DIR}, ${FIXED} plik(i) logow, ${DEFAULT_SITE_FILE}, ${FIXED_SITE_FILES} plik(i) konfiguracji stron, ${FIXED_HOME_DIRS} katalog(i) domowych oraz ${FIXED_DOMAIN_DIRS} katalog(i) domen sprawdzone/naprawione."
