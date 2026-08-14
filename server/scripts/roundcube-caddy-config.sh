#!/usr/bin/env bash
#
# Zarzadza blokiem Caddy dla Roundcube BEZPOSREDNIO w /etc/caddy/Caddyfile
# (markery # BEGIN/END, WLASNE - rozne od bloku wydajnosci w
# caddy-set-performance.sh - oba wspoluzytkuja jeden plik bez kolizji, bo
# kazdy skrypt dotyka tylko linii miedzy SWOIMI markerami). Admin wybral
# to swiadomie zamiast osobnych plikow w /etc/caddy/sites/ (ktorych
# uzywaja WYLACZNIE strony kont hostingowych).
#
# Blok obejmuje DWIE nazwy hosta na raz - webmail.<domena> (realny
# reverse proxy do Roundcube) i mail.<domena> (nic nie serwuje - Postfix/
# Dovecot su na wlasnych portach, nie 80/443 - istnieje WYLACZNIE zeby
# Caddy automatycznie wystapil o certyfikat Let's Encrypt dla tej nazwy).
# Podmiana certyfikatu self-signed Postfixa/Dovecota na ten wydany tutaj
# to OSOBNY, PRZYSZLY krok (patrz projekt memory) - nie tutaj.
#
# Ten sam wzorzec co caddy-set-performance.sh: nowa tresc kopiowana do
# tymczasowego pliku RAZEM z reszta Caddyfile (po wyciecu starego bloku),
# fmt+adapt+validate PRZED dotknieciem prawdziwego pliku, backup+rollback
# jesli reload sie nie powiedzie.
#
# Uzycie:
#   roundcube-caddy-config.sh get                 (bez stdin)
#   roundcube-caddy-config.sh apply                (nowa tresc BLOKU na stdin,
#                                                    BEZ markerow - skrypt sam
#                                                    je dokleja)
#   roundcube-caddy-config.sh remove               (bez stdin)

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

CADDYFILE="/etc/caddy/Caddyfile"
MARK_START="# BEGIN caddy-dashboard-roundcube"
MARK_END="# END caddy-dashboard-roundcube"

ACTION="${1:-}"

read_current() {
  if [ -f "$CADDYFILE" ]; then cat "$CADDYFILE"; else printf ''; fi
}

strip_block() {
  awk -v s="$MARK_START" -v e="$MARK_END" '
    $0==s {skip=1; next}
    $0==e {skip=0; next}
    skip!=1 {print}
  '
}

case "$ACTION" in
  get)
    CURRENT="$(read_current)"
    STARTIDX=$(printf '%s\n' "$CURRENT" | grep -n -F -x "$MARK_START" | head -n1 | cut -d: -f1)
    ENDIDX=$(printf '%s\n' "$CURRENT" | grep -n -F -x "$MARK_END" | head -n1 | cut -d: -f1)
    if [ -z "$STARTIDX" ] || [ -z "$ENDIDX" ] || [ "$ENDIDX" -le "$STARTIDX" ]; then
      exit 0
    fi
    printf '%s\n' "$CURRENT" | sed -n "$((STARTIDX+1)),$((ENDIDX-1))p"
    exit 0
    ;;

  apply)
    NEW_BLOCK="$(cat)"
    [ -z "$NEW_BLOCK" ] && err "pusta tresc bloku Roundcube."

    TMP="$(mktemp)"
    ERR_LOG="$(mktemp)"
    trap 'rm -f "$TMP" "$ERR_LOG"' EXIT

    # Blok dopisywany NA KONCU pliku, nigdy na poczatku - jesli admin ma
    # juz skonfigurowany profil wydajnosci Caddy (caddy-set-performance.sh),
    # to blok BEZ klucza domeny (globalne opcje `{ admin ... }`), a Caddy
    # wymaga, zeby taki blok byl ZAWSZE pierwszy w pliku - wstawienie
    # czegokolwiek przed nim psuje adaptacje ("server block without any
    # key ... must be first"). Dopisywanie na koncu nigdy nie narusza tej
    # kolejnosci, niezaleznie czy blok wydajnosci istnieje czy nie.
    STRIPPED="$(read_current | strip_block)"
    {
      printf '%s' "$STRIPPED"
      printf '\n\n%s\n' "$MARK_START"
      printf '%s\n' "$NEW_BLOCK"
      printf '%s\n' "$MARK_END"
    } > "$TMP"

    caddy fmt --overwrite "$TMP" >"$ERR_LOG" 2>&1 || err "caddy fmt nie powiodlo sie: $(cat "$ERR_LOG")"
    caddy adapt --config "$TMP" --adapter caddyfile >"$ERR_LOG" 2>&1 || err "nowy Caddyfile (z blokiem Roundcube) nie przeszedl adaptacji: $(cat "$ERR_LOG")"
    caddy validate --config "$TMP" --adapter caddyfile >"$ERR_LOG" 2>&1 || err "nowy Caddyfile (z blokiem Roundcube) nie przeszedl walidacji: $(cat "$ERR_LOG")"

    BACKUP="${CADDYFILE}.bak-$(date +%Y%m%d%H%M%S)"
    [ -f "$CADDYFILE" ] && { cp -p "$CADDYFILE" "$BACKUP" || err "nie udalo sie zrobic backupu ${CADDYFILE}."; }

    cp "$TMP" "$CADDYFILE"

    if systemctl reload caddy 2>"$ERR_LOG"; then
      echo "OK: blok Roundcube zapisany w Caddyfile, caddy przeladowany."
      exit 0
    fi

    ERR_MSG="$(cat "$ERR_LOG")"
    if [ -f "$BACKUP" ]; then
      cp -p "$BACKUP" "$CADDYFILE"
      systemctl reload caddy >/dev/null 2>&1 || true
    fi
    err "nie udalo sie przeladowac caddy z nowym blokiem Roundcube: ${ERR_MSG} - przywrocono poprzedni Caddyfile."
    ;;

  remove)
    CURRENT="$(read_current)"
    if ! printf '%s\n' "$CURRENT" | grep -qFx "$MARK_START"; then
      echo "OK: blok Roundcube juz nie istnieje w Caddyfile."
      exit 0
    fi

    TMP="$(mktemp)"
    ERR_LOG="$(mktemp)"
    trap 'rm -f "$TMP" "$ERR_LOG"' EXIT

    printf '%s\n' "$CURRENT" | strip_block > "$TMP"

    caddy fmt --overwrite "$TMP" >"$ERR_LOG" 2>&1 || err "caddy fmt nie powiodlo sie: $(cat "$ERR_LOG")"
    caddy adapt --config "$TMP" --adapter caddyfile >"$ERR_LOG" 2>&1 || err "Caddyfile (po usunieciu bloku Roundcube) nie przeszedl adaptacji: $(cat "$ERR_LOG")"
    caddy validate --config "$TMP" --adapter caddyfile >"$ERR_LOG" 2>&1 || err "Caddyfile (po usunieciu bloku Roundcube) nie przeszedl walidacji: $(cat "$ERR_LOG")"

    BACKUP="${CADDYFILE}.bak-$(date +%Y%m%d%H%M%S)"
    cp -p "$CADDYFILE" "$BACKUP" || err "nie udalo sie zrobic backupu ${CADDYFILE}."

    cp "$TMP" "$CADDYFILE"

    if systemctl reload caddy 2>"$ERR_LOG"; then
      echo "OK: blok Roundcube usuniety z Caddyfile, caddy przeladowany."
      exit 0
    fi

    ERR_MSG="$(cat "$ERR_LOG")"
    cp -p "$BACKUP" "$CADDYFILE"
    systemctl reload caddy >/dev/null 2>&1 || true
    err "nie udalo sie przeladowac caddy po usunieciu bloku Roundcube: ${ERR_MSG} - przywrocono poprzedni Caddyfile."
    ;;

  *)
    err "nieznana akcja '${ACTION}' (oczekiwano get|apply|remove)"
    ;;
esac
