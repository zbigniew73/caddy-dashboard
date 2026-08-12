#!/usr/bin/env bash
#
# Zarzadza plikiem konfiguracji Caddy pojedynczej strony konta hostingowego
# (PLASKO: /etc/caddy/sites/<domain>.caddy, bez podkatalogu per-konto -
# patrz hosting-account-create.sh: Caddy `import` dopuszcza tylko jeden
# wildcard w calym wzorcu, wiec `import /etc/caddy/sites/*.caddy` w glownym
# Caddyfile, izolacja miedzy kontami idzie przez uprawnienia PLIKU
# (chown <username>:caddy, 0640), nie przez katalog) - ten sam wzorzec
# walidacja-przed-podmiana-z-rollbackiem co caddy-set-performance.sh, tylko
# celem jest plik PER-STRONA, a nie sam Caddyfile. Domena jest globalnie
# unikalna (wymuszane w hostingUserSites.js), wiec plaska nazwa pliku nigdy
# nie koliduje miedzy kontami.
#
# "Zatrzymana" strona = plik ma rozszerzenie .caddy.disabled (NIE pasuje do
# glob *.caddy, wiec Caddy go w ogole nie importuje) - `caddy validate`
# dziala tylko na tym co jest faktycznie zaimportowane, wiec edycja
# (`apply`) zatrzymanej strony jest walidowana dopiero przy nastepnym
# `enable` (akceptowalny kompromis: bledny config zatrzymanej strony nie
# psuje niczego, dopoki ktos jej nie uruchomi).
#
# apply <username> <domain>   - tresc bloku Caddy na stdin. Zapisuje ja do
#                                pliku odpowiadajacego OBECNEMU stanowi
#                                strony (aktywny/zatrzymany - edycja NIE
#                                zmienia stanu). Przy PIERWSZYM utworzeniu
#                                (brak obu plikow) zaklada tez
#                                ~<username>/domains/<domain>/{public,tmp,logs}
#                                z placeholderem index.html (tylko jesli
#                                public/ jest puste).
# enable <username> <domain>  - <domain>.caddy.disabled -> <domain>.caddy
# disable <username> <domain> - <domain>.caddy -> <domain>.caddy.disabled
# delete <username> <domain>  - usuwa .caddy/.caddy.disabled. Dane strony
#                                na dysku (~/domains/<domain>) ZOSTAJA - ta
#                                sama filozofia co hosting-account-delete.sh
#                                (panel nie kasuje bezpowrotnie plikow usera).
#
# Uzycie: hosting-user-site.sh <apply|enable|disable|delete> <username> <domain>

set -uo pipefail

SITES_BASE_DIR="/etc/caddy/sites"
CADDYFILE="/etc/caddy/Caddyfile"

ACTION="${1:-}"
USERNAME="${2:-}"
DOMAIN="${3:-}"

if ! [[ "$USERNAME" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
  echo "BLAD: nieprawidlowa nazwa uzytkownika: '${USERNAME}'" >&2
  exit 1
fi
if ! [[ "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$ ]]; then
  echo "BLAD: nieprawidlowa domena: '${DOMAIN}'" >&2
  exit 1
fi
if ! id -u "$USERNAME" >/dev/null 2>&1; then
  echo "BLAD: uzytkownik '${USERNAME}' nie istnieje." >&2
  exit 1
fi

if [ ! -d "$SITES_BASE_DIR" ]; then
  echo "BLAD: katalog stron nie istnieje: ${SITES_BASE_DIR}" >&2
  exit 1
fi

ACTIVE_FILE="${SITES_BASE_DIR}/${DOMAIN}.caddy"
DISABLED_FILE="${SITES_BASE_DIR}/${DOMAIN}.caddy.disabled"

case "$ACTION" in
  apply)
    NEW_BLOCK="$(cat)"
    if [ -z "$NEW_BLOCK" ]; then
      echo "BLAD: pusta tresc konfiguracji strony." >&2
      exit 1
    fi

    TMP="$(mktemp)"
    ERR_LOG="$(mktemp)"
    printf '%s\n' "$NEW_BLOCK" > "$TMP"

    if ! caddy fmt --overwrite "$TMP" >"$ERR_LOG" 2>&1; then
      echo "BLAD: caddy fmt nie powiodlo sie: $(cat "$ERR_LOG")" >&2
      rm -f "$TMP" "$ERR_LOG"
      exit 1
    fi

    IS_NEW=1
    TARGET_FILE="$ACTIVE_FILE"
    if [ -f "$ACTIVE_FILE" ]; then
      IS_NEW=0
      TARGET_FILE="$ACTIVE_FILE"
    elif [ -f "$DISABLED_FILE" ]; then
      IS_NEW=0
      TARGET_FILE="$DISABLED_FILE"
    fi

    BACKUP=""
    if [ "$IS_NEW" = "0" ]; then
      BACKUP="$(mktemp)"
      cp -p "$TARGET_FILE" "$BACKUP"
    fi

    cp "$TMP" "$TARGET_FILE"
    rm -f "$TMP"
    chown "${USERNAME}:caddy" "$TARGET_FILE"
    chmod 0640 "$TARGET_FILE"

    if ! caddy validate --config "$CADDYFILE" --adapter caddyfile >"$ERR_LOG" 2>&1; then
      echo "BLAD: nowy config strony nie przeszedl walidacji: $(cat "$ERR_LOG")" >&2
      if [ -n "$BACKUP" ]; then cp -p "$BACKUP" "$TARGET_FILE"; rm -f "$BACKUP"; else rm -f "$TARGET_FILE"; fi
      rm -f "$ERR_LOG"
      exit 1
    fi
    rm -f "$ERR_LOG"

    if [ "$TARGET_FILE" = "$ACTIVE_FILE" ]; then
      ERR_LOG="$(mktemp)"
      if ! systemctl reload caddy 2>"$ERR_LOG"; then
        MSG="$(cat "$ERR_LOG")"
        rm -f "$ERR_LOG"
        if [ -n "$BACKUP" ]; then cp -p "$BACKUP" "$TARGET_FILE"; else rm -f "$TARGET_FILE"; fi
        systemctl reload caddy >/dev/null 2>&1 || true
        rm -f "$BACKUP"
        echo "BLAD: nie udalo sie przeladowac caddy: ${MSG} - przywrocono poprzedni config strony." >&2
        exit 1
      fi
      rm -f "$ERR_LOG"
    fi
    rm -f "$BACKUP"

    if [ "$IS_NEW" = "1" ]; then
      USER_HOME="$(getent passwd "$USERNAME" | cut -d: -f6)"
      DOMAIN_DIR="${USER_HOME}/domains/${DOMAIN}"
      mkdir -p "${DOMAIN_DIR}/public" "${DOMAIN_DIR}/tmp" "${DOMAIN_DIR}/logs"
      chown -R "${USERNAME}:caddy" "$DOMAIN_DIR"
      find "$DOMAIN_DIR" -type d -exec chmod 0750 {} \;
      if [ -z "$(ls -A "${DOMAIN_DIR}/public" 2>/dev/null)" ]; then
        cat > "${DOMAIN_DIR}/public/index.html" <<HTML
<!doctype html>
<html><head><meta charset="utf-8"><title>${DOMAIN}</title></head>
<body><p>Strona ${DOMAIN} zostala utworzona. Wgraj swoje pliki przez SSH/SFTP do katalogu ~/domains/${DOMAIN}/public.</p></body></html>
HTML
        chown "${USERNAME}:caddy" "${DOMAIN_DIR}/public/index.html"
        chmod 0640 "${DOMAIN_DIR}/public/index.html"
      fi
    fi
    echo "OK: config strony ${DOMAIN} zapisany."
    ;;

  enable)
    if [ ! -f "$DISABLED_FILE" ]; then
      if [ -f "$ACTIVE_FILE" ]; then
        echo "OK: strona ${DOMAIN} juz jest wlaczona."
        exit 0
      fi
      echo "BLAD: nie znaleziono konfiguracji strony ${DOMAIN}." >&2
      exit 1
    fi
    mv -f "$DISABLED_FILE" "$ACTIVE_FILE"
    ERR_LOG="$(mktemp)"
    if ! caddy validate --config "$CADDYFILE" --adapter caddyfile >"$ERR_LOG" 2>&1; then
      echo "BLAD: config strony nie przeszedl walidacji, nie mozna wlaczyc: $(cat "$ERR_LOG")" >&2
      mv -f "$ACTIVE_FILE" "$DISABLED_FILE"
      rm -f "$ERR_LOG"
      exit 1
    fi
    if ! systemctl reload caddy 2>"$ERR_LOG"; then
      MSG="$(cat "$ERR_LOG")"
      rm -f "$ERR_LOG"
      mv -f "$ACTIVE_FILE" "$DISABLED_FILE"
      systemctl reload caddy >/dev/null 2>&1 || true
      echo "BLAD: nie udalo sie przeladowac caddy: ${MSG}" >&2
      exit 1
    fi
    rm -f "$ERR_LOG"
    echo "OK: strona ${DOMAIN} wlaczona."
    ;;

  disable)
    if [ ! -f "$ACTIVE_FILE" ]; then
      if [ -f "$DISABLED_FILE" ]; then
        echo "OK: strona ${DOMAIN} juz jest wylaczona."
        exit 0
      fi
      echo "BLAD: nie znaleziono konfiguracji strony ${DOMAIN}." >&2
      exit 1
    fi
    mv -f "$ACTIVE_FILE" "$DISABLED_FILE"
    ERR_LOG="$(mktemp)"
    if ! systemctl reload caddy 2>"$ERR_LOG"; then
      MSG="$(cat "$ERR_LOG")"
      rm -f "$ERR_LOG"
      mv -f "$DISABLED_FILE" "$ACTIVE_FILE"
      systemctl reload caddy >/dev/null 2>&1 || true
      echo "BLAD: nie udalo sie przeladowac caddy: ${MSG}" >&2
      exit 1
    fi
    rm -f "$ERR_LOG"
    echo "OK: strona ${DOMAIN} wylaczona."
    ;;

  delete)
    if [ ! -f "$ACTIVE_FILE" ] && [ ! -f "$DISABLED_FILE" ]; then
      echo "OK: konfiguracja strony ${DOMAIN} juz nie istnieje."
      exit 0
    fi
    BACKUP="$(mktemp)"
    WAS_ACTIVE=0
    if [ -f "$ACTIVE_FILE" ]; then
      WAS_ACTIVE=1
      cp -p "$ACTIVE_FILE" "$BACKUP"
    else
      cp -p "$DISABLED_FILE" "$BACKUP"
    fi
    rm -f "$ACTIVE_FILE" "$DISABLED_FILE"
    if [ "$WAS_ACTIVE" = "1" ]; then
      ERR_LOG="$(mktemp)"
      if ! systemctl reload caddy 2>"$ERR_LOG"; then
        MSG="$(cat "$ERR_LOG")"
        rm -f "$ERR_LOG"
        cp -p "$BACKUP" "$ACTIVE_FILE"
        systemctl reload caddy >/dev/null 2>&1 || true
        rm -f "$BACKUP"
        echo "BLAD: nie udalo sie przeladowac caddy po usunieciu strony: ${MSG} - przywrocono config." >&2
        exit 1
      fi
      rm -f "$ERR_LOG"
    fi
    rm -f "$BACKUP"
    echo "OK: konfiguracja strony ${DOMAIN} usunieta (pliki w ~/domains/${DOMAIN} POZOSTALY nietkniete)."
    ;;

  *)
    echo "BLAD: nieznana akcja: '${ACTION}' (apply|enable|disable|delete)" >&2
    exit 1
    ;;
esac
