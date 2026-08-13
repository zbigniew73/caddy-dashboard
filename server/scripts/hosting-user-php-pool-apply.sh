#!/usr/bin/env bash
#
# Zaklada/naprawia (apply), usuwa (remove) albo przeladowuje (reload)
# DEDYKOWANY pool PHP-FPM dla jednej strony konta hostingowego (self-
# service z panelu klienta, /user/ - Strony - szablon PHP/WordPress).
#
# Warstwa PHP w tym projekcie to Remi SCL (patrz
# server/runtime-manager/scripts/php-install.sh) - JEDEN, wspolny proces
# systemd na wersje (phpXX-php-fpm.service), MOZE hostowac wiele poolow
# naraz (kazdy z wlasnym socketem/userem) - dokladnie ten sam mechanizm,
# na ktorym juz dziala dedykowany pool phpMyAdmin/Adminer (patrz
# server/runtime-manager/scripts/phpmyadmin-install.sh - ten skrypt jest
# wzorcem dla mechaniki ponizej, tylko sparametryzowanym per KONTO
# HOSTINGOWE zamiast jednego, sztywnego narzedzia admina).
#
# Wszystkie wartosci liczbowe (max_children/memory_limit) sa WYLICZONE
# WCZESNIEJ w Node (server/services/hostingUserSites.js,
# computePhpPoolSizing() - z limitu RAM pakietu konta) - ten skrypt jest
# celowo "gluchy"/mechaniczny: tylko waliduje i zapisuje, tak jak kazdy
# inny skrypt sudo w tym projekcie.
#
# Katalog na sockety (/run/cd-hosting-php) jest WSPOLNY dla wszystkich
# kont (w odroznieniu od /opt/caddy-dashboard/run uzywanego przez
# phpmyadmin-install.sh, ktory jest per-narzedzie, nie per-konto) - 0755
# root:root (samo przejscie), realny dostep do KONKRETNEGO socketu idzie
# przez listen.owner/listen.group/listen.mode per plik, jak w phpMyAdmin.
# /run to tmpfs (znika po restarcie serwera) - katalog jest wiec
# rejestrowany w /etc/tmpfiles.d, zeby systemd odtwarzal go PRZED
# uruchomieniem phpXX-php-fpm.service przy kazdym boocie (ten sam,
# "samoinstalujacy sie" wzorzec co szablon systemd Redisa w
# hosting-user-redis-apply.sh - zero recznego kroku na VPS).
#
# apply <username> <domain> <phpVersion> <siteSlug> <maxChildren> <memoryLimitMb>
#   Zapisuje/nadpisuje plik poola i przeladowuje wspolna usluge PHP-FPM tej
#   wersji (z kopia zapasowa + rollbackiem przy niepowodzeniu, ten sam
#   wzorzec co php-set-settings.sh/phpmyadmin-install.sh).
# remove <username> <phpVersion> <siteSlug>
#   Usuwa plik poola (idempotentne - brak pliku to sukces) i przeladowuje
#   usluge, JESLI ta usluga jeszcze istnieje (jesli admin w miedzyczasie
#   odinstalowal ta wersje PHP, samo usuniecie pliku juz wystarcza -
#   kasowanie strony NIE moze utknac na brakujacej usludze).
# reload <username> <phpVersion>
#   Samo przeladowanie (przycisk "Restart PHP" w panelu) - miekkie,
#   respawnuje procesy robocze WSZYSTKICH poolow tej wersji PHP (nie tylko
#   tej jednej strony - PHP-FPM nie ma sygnalu do restartu pojedynczego
#   poola), bez przerywania trwajacych polaczen.
#
# Uzycie: hosting-user-php-pool-apply.sh <apply|remove|reload> ...

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

ACTION="${1:-}"
USERNAME="${2:-}"

RUN_DIR="/run/cd-hosting-php"
TMPFILES_CONF="/etc/tmpfiles.d/cd-hosting-php.conf"

if ! [[ "$USERNAME" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
  err "Nieprawidlowa nazwa uzytkownika: '${USERNAME}'"
fi
if ! id -u "$USERNAME" >/dev/null 2>&1; then
  err "Uzytkownik '${USERNAME}' nie istnieje."
fi

# Katalog na sockety - tworzony/rejestrowany na KAZDE wywolanie (idempotentne,
# bez efektow ubocznych jesli juz poprawnie ustawiony) - patrz komentarz
# wyzej o /run jako tmpfs.
if [ ! -f "$TMPFILES_CONF" ]; then
  cat > "$TMPFILES_CONF" <<EOF
d ${RUN_DIR} 0755 root root -
EOF
fi
mkdir -p "$RUN_DIR"
chmod 0755 "$RUN_DIR"
chown root:root "$RUN_DIR"
command -v systemd-tmpfiles >/dev/null 2>&1 && systemd-tmpfiles --create "$TMPFILES_CONF" >/dev/null 2>&1

ensure_live() {
  local service="$1"
  for _ in 1 2 3 4 5; do
    systemctl is-active --quiet "$service" && return 0
    sleep 1
  done
  return 1
}

case "$ACTION" in
  apply)
    DOMAIN="${3:-}"
    PHP_VERSION="${4:-}"
    SITE_SLUG="${5:-}"
    MAX_CHILDREN="${6:-}"
    MEMORY_LIMIT_MB="${7:-}"

    if ! [[ "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$ ]]; then
      err "Nieprawidlowa domena: '${DOMAIN}'"
    fi
    if ! [[ "$PHP_VERSION" =~ ^[0-9]{2}$ ]]; then
      err "Nieprawidlowa wersja PHP: '${PHP_VERSION}'"
    fi
    if ! [[ "$SITE_SLUG" =~ ^[0-9a-f]{12}$ ]]; then
      err "Nieprawidlowy identyfikator strony: '${SITE_SLUG}'"
    fi
    if ! [[ "$MAX_CHILDREN" =~ ^[0-9]+$ ]]; then
      err "Nieprawidlowa liczba procesow: '${MAX_CHILDREN}'"
    fi
    if ! [[ "$MEMORY_LIMIT_MB" =~ ^[0-9]+$ ]]; then
      err "Nieprawidlowy limit pamieci: '${MEMORY_LIMIT_MB}'"
    fi
    # Defense-in-depth - Node juz przycina te wartosci, ale skrypt nie ma
    # ufac wylacznie wywolujacemu (ten sam duch co reszta projektu).
    [ "$MAX_CHILDREN" -lt 2 ] && MAX_CHILDREN=2
    [ "$MAX_CHILDREN" -gt 20 ] && MAX_CHILDREN=20
    [ "$MEMORY_LIMIT_MB" -lt 16 ] && MEMORY_LIMIT_MB=16
    [ "$MEMORY_LIMIT_MB" -gt 512 ] && MEMORY_LIMIT_MB=512

    rpm -q "php${PHP_VERSION}" >/dev/null 2>&1 \
      || err "PHP ${PHP_VERSION} nie jest zainstalowany - zainstaluj go najpierw z panelu admina (Runtime Manager)."

    USER_HOME="$(getent passwd "$USERNAME" | cut -d: -f6)"
    [ -n "$USER_HOME" ] || err "Nie udalo sie ustalic katalogu domowego dla '${USERNAME}'."
    PUBLIC_ROOT="${USER_HOME}/domains/${DOMAIN}/public"

    CADDY_GROUP="$(id -gn caddy 2>/dev/null)"
    [ -n "$CADDY_GROUP" ] || err "Nie udalo sie ustalic grupy systemowej usera 'caddy' (id -gn caddy) - czy Caddy jest zainstalowany?"

    POOL_NAME="cdsite-${SITE_SLUG}"
    SOCKET_PATH="${RUN_DIR}/php-${SITE_SLUG}-v${PHP_VERSION}.sock"
    POOL_FILE="/etc/opt/remi/php${PHP_VERSION}/php-fpm.d/${POOL_NAME}.conf"
    FPM_SERVICE="php${PHP_VERSION}-php-fpm"

    [ -d "$(dirname "$POOL_FILE")" ] \
      || err "Katalog $(dirname "$POOL_FILE") nie istnieje - ${FPM_SERVICE} nie wyglada na poprawnie zainstalowany mimo ze rpm -q php${PHP_VERSION} przeszlo."

    POOL_FILE_BACKUP=""
    if [ -f "$POOL_FILE" ]; then
      POOL_FILE_BACKUP="${POOL_FILE}.bak-$(date +%Y%m%d%H%M%S)"
      cp -p "$POOL_FILE" "$POOL_FILE_BACKUP"
    fi

    cat > "$POOL_FILE" <<POOLCONF || err "Zapisanie ${POOL_FILE} nie powiodlo sie."
[${POOL_NAME}]
user = ${USERNAME}
group = ${USERNAME}
listen = ${SOCKET_PATH}
listen.owner = ${USERNAME}
listen.group = ${CADDY_GROUP}
listen.mode = 0660
pm = ondemand
pm.max_children = ${MAX_CHILDREN}
pm.process_idle_timeout = 30s
php_admin_value[memory_limit] = ${MEMORY_LIMIT_MB}M
php_admin_value[open_basedir] = ${PUBLIC_ROOT}:${USER_HOME}/tmp
php_admin_value[upload_tmp_dir] = ${USER_HOME}/tmp
php_admin_value[session.save_path] = ${USER_HOME}/tmp
POOLCONF
    [ -s "$POOL_FILE" ] || err "Zapisanie ${POOL_FILE} nie powiodlo sie (plik pusty lub brak)."

    rollback_pool_file() {
      if [ -n "$POOL_FILE_BACKUP" ]; then
        cp -p "$POOL_FILE_BACKUP" "$POOL_FILE"
      else
        rm -f "$POOL_FILE"
      fi
      systemctl reload "$FPM_SERVICE" >/dev/null 2>&1 || true
    }

    ERR_LOG="$(mktemp)"
    if ! systemctl reload "$FPM_SERVICE" 2>"$ERR_LOG"; then
      MSG="$(cat "$ERR_LOG")"
      rm -f "$ERR_LOG"
      rollback_pool_file
      err "Przeladowanie ${FPM_SERVICE} z nowym poolem ${POOL_NAME} nie powiodlo sie: ${MSG} - przywrocono poprzedni stan poola."
    fi
    rm -f "$ERR_LOG"

    if ! ensure_live "$FPM_SERVICE"; then
      rollback_pool_file
      err "${FPM_SERVICE} nie jest aktywny po przeladowaniu z nowym poolem ${POOL_NAME} - przywrocono poprzedni stan poola."
    fi

    [ -n "$POOL_FILE_BACKUP" ] && rm -f "$POOL_FILE_BACKUP"
    echo "OK: pool PHP-FPM ${POOL_NAME} (PHP ${PHP_VERSION}) zapisany, socket ${SOCKET_PATH}."
    ;;

  remove)
    PHP_VERSION="${3:-}"
    SITE_SLUG="${4:-}"

    if ! [[ "$PHP_VERSION" =~ ^[0-9]{2}$ ]]; then
      err "Nieprawidlowa wersja PHP: '${PHP_VERSION}'"
    fi
    if ! [[ "$SITE_SLUG" =~ ^[0-9a-f]{12}$ ]]; then
      err "Nieprawidlowy identyfikator strony: '${SITE_SLUG}'"
    fi

    POOL_NAME="cdsite-${SITE_SLUG}"
    POOL_FILE="/etc/opt/remi/php${PHP_VERSION}/php-fpm.d/${POOL_NAME}.conf"
    FPM_SERVICE="php${PHP_VERSION}-php-fpm"

    if [ ! -f "$POOL_FILE" ]; then
      echo "OK: pool PHP-FPM ${POOL_NAME} juz usuniety."
      exit 0
    fi
    rm -f "$POOL_FILE"

    if ! systemctl list-unit-files "${FPM_SERVICE}.service" >/dev/null 2>&1; then
      echo "OK: pool PHP-FPM ${POOL_NAME} usuniety (usluga ${FPM_SERVICE} juz nie istnieje - PHP ${PHP_VERSION} zostalo odinstalowane, pomijam przeladowanie)."
      exit 0
    fi

    systemctl reload "$FPM_SERVICE" >/dev/null 2>&1 || true
    echo "OK: pool PHP-FPM ${POOL_NAME} usuniety."
    ;;

  reload)
    PHP_VERSION="${3:-}"
    if ! [[ "$PHP_VERSION" =~ ^[0-9]{2}$ ]]; then
      err "Nieprawidlowa wersja PHP: '${PHP_VERSION}'"
    fi
    FPM_SERVICE="php${PHP_VERSION}-php-fpm"

    ERR_LOG="$(mktemp)"
    if ! systemctl reload "$FPM_SERVICE" 2>"$ERR_LOG"; then
      MSG="$(cat "$ERR_LOG")"
      rm -f "$ERR_LOG"
      err "Przeladowanie ${FPM_SERVICE} nie powiodlo sie: ${MSG}"
    fi
    rm -f "$ERR_LOG"

    if ! ensure_live "$FPM_SERVICE"; then
      err "${FPM_SERVICE} nie jest aktywny po przeladowaniu."
    fi
    echo "OK: ${FPM_SERVICE} przeladowany."
    ;;

  *)
    err "Nieznana akcja: '${ACTION}' (apply|remove|reload)"
    ;;
esac
