#!/usr/bin/env bash
#
# Zaklada/uruchamia/zatrzymuje/kasuje BACKEND FrankenPHP (Worker Mode) dla
# strony hostingowej z szablonem 'frankenphp' (Laravel lub Symfony).
# Klucz to <username> <domain> - domena jest juz globalnie unikalna
# (walidowane w hostingUserSites.js), wiec bez osobnego "slug" jak przy
# aplikacjach Python/Node.
#
# ARCHITEKTURA (uzasadnienie w pelnym planie tej sesji - skrocone tutaj):
# FrankenPHP to sam-w-sobie proces Caddy - domyslna usluga systemowa
# (frankenphp.service, /etc/frankenphp/Caddyfile) probuje zbindowac
# http://* ORAZ wlasne Caddy admin API na 127.0.0.1:2019, kolidujac z
# systemowym Caddy panelu. Dlatego KAZDA strona 'frankenphp' dostaje
# WLASNY, PRYWATNY proces, nasluchujacy TYLKO na 127.0.0.1:<port>, z
# wylaczonym admin API (Caddy: `admin off` - dokumentacja Caddy,
# caddyserver.com/docs/caddyfile/options) - zero portu do kolizji, ani
# miedzy soba, ani z systemowym Caddy. Systemowy Caddy robi zwykly
# `reverse_proxy 127.0.0.1:<port>` (buildSiteBlock w hostingUserSites.js)
# - dokladnie tak jak zaleca oficjalna dokumentacja Laravel Octane
# ("you should serve your Octane application behind a traditional web
# server").
#
# Laravel i Symfony ida DWIEMA roznymi sciezkami (potwierdzone w
# dokumentacji obu frameworkow):
#   - Laravel: pakiet laravel/octane, `artisan octane:install
#     --server=frankenphp` SAM SCIAGA WLASNA, projektowo-lokalna kopie
#     binarki FrankenPHP - NIE potrzebuje systemowej instalacji admina.
#     Runtime: `artisan octane:frankenphp --host=127.0.0.1 --port=<P>
#     --admin-port=<P2>` (Octane's WLASNY, wewnetrzny port reload/status -
#     DRUGI port, rozny od publicznego).
#   - Symfony: pakiet runtime/frankenphp-symfony + BEZPOSREDNIO systemowa
#     binarke `frankenphp run --config <plik>` z malym, per-aplikacyjnym
#     Caddyfile (`admin off` + `php_server { worker ./public/index.php }`)
#     - WYMAGA systemowej instalacji FrankenPHP (Runtime Manager admina).
#
# create <username> <domain> <framework> <phpCliPath>
#   Scaffold przez composer (self-instalowany, jesli brak) - do JUZ
#   istniejacego ~/domains/<domain>/ (zalozonego wczesniej przez
#   hosting-user-site.sh apply). phpCliPath to ZWYKLA binarka PHP CLI
#   (listPhpCliPaths() w hostingUserCron.js) - do uruchamiania
#   composera/artisana, NIE ta sama binarka co runtime FrankenPHP.
# start <username> <domain> <framework> <phpCliPath> <port> <adminPort>
#   adminPort ZAWSZE obecny w argv (stala liczba wildcardow w sudoers) -
#   ignorowany dla symfony (Caddy `admin off` nie potrzebuje portu w
#   ogole).
# stop / restart <username> <domain>
#   `systemctl disable --now` / `restart` (best-effort dla stop).
# status <username> <domain>
#   `ACTIVE=<ActiveState>` + do 20 linii `LOG=<linia>` z journalctl.
# delete <username> <domain>
#   Zatrzymuje usluge, kasuje jednostke - NIE kasuje ~/domains/<domain>
#   (to juz robi hosting-user-site.sh delete).
#
# Uzycie: hosting-user-frankenphp-site.sh <create|start|stop|restart|status|delete> ...

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

ACTION="${1:-}"
USERNAME="${2:-}"
DOMAIN="${3:-}"

if ! [[ "$USERNAME" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
  err "Nieprawidlowa nazwa uzytkownika: '${USERNAME}'"
fi
if ! id -u "$USERNAME" >/dev/null 2>&1; then
  err "Uzytkownik '${USERNAME}' nie istnieje."
fi
# Defense-in-depth - hostingUserSites.js juz waliduje domene (DOMAIN_RE)
# przed wywolaniem tego skryptu, ten sam bezpieczny zestaw znakow
# powtorzony tutaj (ten sam duch co walidacja slug w
# hosting-user-python-app.sh/hosting-user-node-app.sh).
if ! [[ "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$ ]]; then
  err "Nieprawidlowa domena: '${DOMAIN}'"
fi

USER_HOME="$(getent passwd "$USERNAME" | cut -d: -f6)"
[ -n "$USER_HOME" ] || err "Nie udalo sie ustalic katalogu domowego dla '${USERNAME}'."
UID_NUM="$(id -u "$USERNAME")"

DOMAIN_DIR="${USER_HOME}/domains/${DOMAIN}"
UNIT_NAME="cd-frankenphp-${USERNAME}-${DOMAIN}.service"
UNIT_FILE="/etc/systemd/system/${UNIT_NAME}"

case "$ACTION" in
  create)
    FRAMEWORK="${4:-}"
    PHP_CLI_PATH="${5:-}"

    case "$FRAMEWORK" in
      laravel|symfony) ;;
      *) err "Nieznany framework: '${FRAMEWORK}' (laravel|symfony)" ;;
    esac
    if ! [[ "$PHP_CLI_PATH" =~ ^/usr/bin/php$|^/usr/local/bin/php[0-9]{2}$ ]]; then
      err "Nieprawidlowa sciezka PHP CLI: '${PHP_CLI_PATH}'"
    fi
    [ -x "$PHP_CLI_PATH" ] || err "Plik '${PHP_CLI_PATH}' nie istnieje lub nie jest wykonywalny."
    [ -d "$DOMAIN_DIR" ] || err "Katalog strony '${DOMAIN_DIR}' nie istnieje - strona musi byc juz zalozona."

    if ! command -v composer >/dev/null 2>&1; then
      dnf install -y composer || err "Composer nie jest zainstalowany i automatyczna instalacja (dnf install composer) nie powiodla sie."
    fi
    COMPOSER_PATH="$(command -v composer)"

    if [ "$FRAMEWORK" = "symfony" ] && ! command -v frankenphp >/dev/null 2>&1; then
      err "FrankenPHP nie jest zainstalowany na tym serwerze - zainstaluj go najpierw z panelu admina (Uslugi -> FrankenPHP)."
    fi

    # `composer create-project` wymaga PUSTEGO katalogu docelowego -
    # hosting-user-site.sh (apply, wywolane wczesniej) zaklada
    # ${DOMAIN_DIR}/public dla KAZDEGO szablonu (bez placeholdera dla
    # frankenphp, patrz tam), ale sam PUSTY katalog "public" w srodku
    # DOMAIN_DIR nadal liczy sie jako "niepuste" dla composera - rmdir
    # (nie rm -rf!) usuwa go TYLKO jesli faktycznie jest pusty, wiec to
    # bezpieczne nawet gdyby ktos juz recznie cos tam wgral przez SSH
    # (wtedy rmdir po prostu zawiedzie i create-project ponizej zglosi
    # jasny blad "not empty" zamiast cichej utraty danych).
    rmdir "${DOMAIN_DIR}/public" 2>/dev/null || true

    case "$FRAMEWORK" in
      laravel)
        if ! runuser -u "$USERNAME" -- env -C "$DOMAIN_DIR" "$COMPOSER_PATH" create-project laravel/laravel . --no-interaction; then
          err "composer create-project laravel/laravel nie powiodlo sie."
        fi
        if ! runuser -u "$USERNAME" -- env -C "$DOMAIN_DIR" "$COMPOSER_PATH" require laravel/octane --no-interaction; then
          err "composer require laravel/octane nie powiodlo sie."
        fi
        if ! runuser -u "$USERNAME" -- env -C "$DOMAIN_DIR" "$PHP_CLI_PATH" artisan octane:install --server=frankenphp --no-interaction; then
          err "artisan octane:install --server=frankenphp nie powiodlo sie."
        fi
        ;;
      symfony)
        if ! runuser -u "$USERNAME" -- env -C "$DOMAIN_DIR" "$COMPOSER_PATH" create-project symfony/skeleton . --no-interaction; then
          err "composer create-project symfony/skeleton nie powiodlo sie."
        fi
        if ! runuser -u "$USERNAME" -- env -C "$DOMAIN_DIR" "$COMPOSER_PATH" require webapp --no-interaction; then
          err "composer require webapp nie powiodlo sie."
        fi
        if ! runuser -u "$USERNAME" -- env -C "$DOMAIN_DIR" "$COMPOSER_PATH" require runtime/frankenphp-symfony --no-interaction; then
          err "composer require runtime/frankenphp-symfony nie powiodlo sie."
        fi
        ;;
    esac

    echo "OK: aplikacja ${FRAMEWORK} dla ${DOMAIN} utworzona."
    ;;

  start)
    FRAMEWORK="${4:-}"
    PHP_CLI_PATH="${5:-}"
    PORT="${6:-}"
    ADMIN_PORT="${7:-}"

    case "$FRAMEWORK" in
      laravel|symfony) ;;
      *) err "Nieznany framework: '${FRAMEWORK}' (laravel|symfony)" ;;
    esac
    if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
      err "Nieprawidlowy port: '${PORT}' (1-65535)"
    fi
    [ -d "$DOMAIN_DIR" ] || err "Katalog strony '${DOMAIN_DIR}' nie istnieje."

    case "$FRAMEWORK" in
      laravel)
        if ! [[ "$PHP_CLI_PATH" =~ ^/usr/bin/php$|^/usr/local/bin/php[0-9]{2}$ ]]; then
          err "Nieprawidlowa sciezka PHP CLI: '${PHP_CLI_PATH}'"
        fi
        [ -x "$PHP_CLI_PATH" ] || err "Plik '${PHP_CLI_PATH}' nie istnieje lub nie jest wykonywalny."
        [ -f "${DOMAIN_DIR}/artisan" ] || err "Brak ${DOMAIN_DIR}/artisan - uruchom create najpierw."
        if ! [[ "$ADMIN_PORT" =~ ^[0-9]+$ ]] || [ "$ADMIN_PORT" -lt 1 ] || [ "$ADMIN_PORT" -gt 65535 ]; then
          err "Nieprawidlowy admin-port: '${ADMIN_PORT}' (1-65535)"
        fi
        EXEC_CMD="${PHP_CLI_PATH} ${DOMAIN_DIR}/artisan octane:frankenphp --host=127.0.0.1 --port=${PORT} --admin-port=${ADMIN_PORT}"
        ;;
      symfony)
        [ -f "${DOMAIN_DIR}/public/index.php" ] || err "Brak ${DOMAIN_DIR}/public/index.php - uruchom create najpierw."
        command -v frankenphp >/dev/null 2>&1 || err "FrankenPHP nie jest zainstalowany na tym serwerze."

        TMP_CADDYFILE="$(mktemp)"
        cat > "$TMP_CADDYFILE" <<EOF
{
	admin off
}
127.0.0.1:${PORT} {
	root ${DOMAIN_DIR}/public
	encode zstd br gzip
	php_server {
		worker ./public/index.php
	}
}
EOF
        install -m 644 -o "$USERNAME" -g "$USERNAME" "$TMP_CADDYFILE" "${DOMAIN_DIR}/Caddyfile"
        rm -f "$TMP_CADDYFILE"

        EXEC_CMD="$(command -v frankenphp) run --config ${DOMAIN_DIR}/Caddyfile"
        ;;
    esac

    TMP_UNIT="$(mktemp)"
    cat > "$TMP_UNIT" <<EOF
[Unit]
Description=FrankenPHP (${FRAMEWORK}) site ${DOMAIN} (${USERNAME})
After=network.target

[Service]
Type=simple
ExecStart=${EXEC_CMD}
User=${USERNAME}
Group=${USERNAME}
WorkingDirectory=${DOMAIN_DIR}
Slice=user-${UID_NUM}.slice
Restart=on-failure
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
EOF
    install -m 644 -o root -g root "$TMP_UNIT" "$UNIT_FILE"
    rm -f "$TMP_UNIT"

    systemctl daemon-reload
    loginctl enable-linger "$USERNAME" >/dev/null 2>&1 || true
    systemctl restart "$UNIT_NAME" || err "Nie udalo sie uruchomic aplikacji dla ${DOMAIN} - sprawdz journalctl -u ${UNIT_NAME}"
    systemctl enable "$UNIT_NAME" >/dev/null 2>&1 || true

    echo "OK: aplikacja ${FRAMEWORK} dla ${DOMAIN} uruchomiona na porcie ${PORT}."
    ;;

  stop)
    systemctl disable --now "$UNIT_NAME" 2>&1 || true
    echo "OK: aplikacja dla ${DOMAIN} zatrzymana."
    ;;

  restart)
    systemctl restart "$UNIT_NAME" || err "Nie udalo sie zrestartowac aplikacji dla ${DOMAIN} - sprawdz journalctl -u ${UNIT_NAME}"
    echo "OK: aplikacja dla ${DOMAIN} zrestartowana."
    ;;

  status)
    ACTIVE_STATE="$(systemctl show "$UNIT_NAME" --no-page -p ActiveState 2>/dev/null | sed -n 's/^ActiveState=//p')"
    echo "ACTIVE=${ACTIVE_STATE:-unknown}"
    journalctl -u "$UNIT_NAME" -n 20 --no-pager --output=cat 2>/dev/null | while IFS= read -r line; do
      [ -n "$line" ] && echo "LOG=${line}"
    done
    ;;

  delete)
    systemctl disable --now "$UNIT_NAME" 2>&1 || true
    rm -f "$UNIT_FILE"
    systemctl daemon-reload
    echo "OK: aplikacja dla ${DOMAIN} usunieta."
    ;;

  *)
    err "Nieznana akcja: '${ACTION}' (create|start|stop|restart|status|delete)"
    ;;
esac
