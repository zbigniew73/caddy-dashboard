#!/usr/bin/env bash
#
# Generuje i instaluje /etc/sudoers.d/caddy-dashboard. Jedyne miejsce, gdzie
# istnieje tresc tego pliku - wywolywane zarowno przez install.sh (podczas
# pelnej instalacji) jak i przez refresh-sudoers.sh (szybka aktualizacja
# samych uprawnien sudo na juz dzialajacej instalacji, bez reinstalacji
# calego panelu). Musi byc uruchomione jako root.
#
# Wymagane zmienne srodowiskowe: INSTALL_DIR, SVC_USER.
#
# Runtime Manager (server/runtime-manager/, osobna usluga systemd,
# caddy-dashboard-runtime.service) dziala jako TEN SAM SVC_USER co glowny
# panel (nie root) - dlatego CDDASH_PHP_* nizej, dokladnie ten sam wzorzec
# co MariaDB/PostgreSQL/Redis itd.

set -euo pipefail

: "${INSTALL_DIR:?INSTALL_DIR nie jest ustawiony}"
: "${SVC_USER:?SVC_USER nie jest ustawiony}"

SUDOERS_TMP="$(mktemp)"
cat > "$SUDOERS_TMP" <<EOF
Cmnd_Alias CDDASH_SYSTEMCTL = /usr/bin/systemctl start *.service, /usr/bin/systemctl stop *.service, /usr/bin/systemctl restart *.service, /usr/bin/systemctl reload *.service, /usr/bin/systemctl enable *.service, /usr/bin/systemctl disable *.service
Cmnd_Alias CDDASH_DNF = /usr/bin/dnf install -y *, /usr/bin/dnf remove -y *
Cmnd_Alias CDDASH_FIREWALL = /usr/bin/firewall-cmd *
Cmnd_Alias CDDASH_SSH_PORT = ${INSTALL_DIR}/server/scripts/ssh-set-port.sh *
Cmnd_Alias CDDASH_REBOOT = /usr/bin/systemctl reboot
Cmnd_Alias CDDASH_FAIL2BAN = ${INSTALL_DIR}/server/scripts/fail2ban-write-config.sh
Cmnd_Alias CDDASH_CADDY_PERF = ${INSTALL_DIR}/server/scripts/caddy-set-performance.sh, ${INSTALL_DIR}/server/scripts/caddy-set-performance.sh get
Cmnd_Alias CDDASH_MARIADB_INSTALL = ${INSTALL_DIR}/server/scripts/mariadb-install.sh local, ${INSTALL_DIR}/server/scripts/mariadb-install.sh official 10.11, ${INSTALL_DIR}/server/scripts/mariadb-install.sh official 11.8
Cmnd_Alias CDDASH_MARIADB_PERF = ${INSTALL_DIR}/server/scripts/mariadb-set-performance.sh
Cmnd_Alias CDDASH_MARIADB_TESTDB = ${INSTALL_DIR}/server/scripts/mariadb-test-db.sh create, ${INSTALL_DIR}/server/scripts/mariadb-test-db.sh drop, ${INSTALL_DIR}/server/scripts/mariadb-test-db.sh status
Cmnd_Alias CDDASH_POSTGRESQL_INSTALL = ${INSTALL_DIR}/server/scripts/postgresql-install.sh local, ${INSTALL_DIR}/server/scripts/postgresql-install.sh official 16, ${INSTALL_DIR}/server/scripts/postgresql-install.sh official 17
Cmnd_Alias CDDASH_POSTGRESQL_PERF = ${INSTALL_DIR}/server/scripts/postgresql-set-performance.sh
Cmnd_Alias CDDASH_POSTGRESQL_TESTDB = ${INSTALL_DIR}/server/scripts/postgresql-test-db.sh create, ${INSTALL_DIR}/server/scripts/postgresql-test-db.sh drop, ${INSTALL_DIR}/server/scripts/postgresql-test-db.sh status
Cmnd_Alias CDDASH_MONGODB_INSTALL = ${INSTALL_DIR}/server/scripts/mongodb-install.sh 7.0, ${INSTALL_DIR}/server/scripts/mongodb-install.sh 8.0
Cmnd_Alias CDDASH_MONGODB_PERF = ${INSTALL_DIR}/server/scripts/mongodb-set-performance.sh
Cmnd_Alias CDDASH_REDIS_INSTALL = ${INSTALL_DIR}/server/scripts/redis-install.sh local, ${INSTALL_DIR}/server/scripts/redis-install.sh official
Cmnd_Alias CDDASH_REDIS_PERF = ${INSTALL_DIR}/server/scripts/redis-set-performance.sh
Cmnd_Alias CDDASH_PHP_REPOS = ${INSTALL_DIR}/server/runtime-manager/scripts/remi-setup-repos.sh
Cmnd_Alias CDDASH_PHP_LIST = ${INSTALL_DIR}/server/runtime-manager/scripts/remi-list-available.sh
Cmnd_Alias CDDASH_PHP_INSTALL = ${INSTALL_DIR}/server/runtime-manager/scripts/php-install.sh [0-9][0-9]
Cmnd_Alias CDDASH_PHP_SETTINGS = ${INSTALL_DIR}/server/runtime-manager/scripts/php-set-settings.sh [0-9][0-9]
Cmnd_Alias CDDASH_PHP_OPCACHE = ${INSTALL_DIR}/server/runtime-manager/scripts/php-set-opcache.sh [0-9][0-9]
Cmnd_Alias CDDASH_PHP_MODULE = ${INSTALL_DIR}/server/runtime-manager/scripts/php-toggle-module.sh [0-9][0-9] * install, ${INSTALL_DIR}/server/runtime-manager/scripts/php-toggle-module.sh [0-9][0-9] * remove
Cmnd_Alias CDDASH_PHP_MODULE_LIST = ${INSTALL_DIR}/server/runtime-manager/scripts/remi-list-php-modules.sh [0-9][0-9]
Cmnd_Alias CDDASH_FRANKENPHP_REPO = ${INSTALL_DIR}/server/runtime-manager/scripts/frankenphp-setup-repo.sh
Cmnd_Alias CDDASH_FRANKENPHP_LIST = ${INSTALL_DIR}/server/runtime-manager/scripts/frankenphp-list-versions.sh
Cmnd_Alias CDDASH_FRANKENPHP_INSTALL = ${INSTALL_DIR}/server/runtime-manager/scripts/frankenphp-install.sh [0-9].[0-9]

${SVC_USER} ALL=(root) NOPASSWD: CDDASH_SYSTEMCTL, CDDASH_DNF, CDDASH_FIREWALL, CDDASH_SSH_PORT, CDDASH_REBOOT, CDDASH_FAIL2BAN, CDDASH_CADDY_PERF, CDDASH_MARIADB_INSTALL, CDDASH_MARIADB_PERF, CDDASH_MARIADB_TESTDB, CDDASH_POSTGRESQL_INSTALL, CDDASH_POSTGRESQL_PERF, CDDASH_POSTGRESQL_TESTDB, CDDASH_MONGODB_INSTALL, CDDASH_MONGODB_PERF, CDDASH_REDIS_INSTALL, CDDASH_REDIS_PERF, CDDASH_PHP_REPOS, CDDASH_PHP_LIST, CDDASH_PHP_INSTALL, CDDASH_PHP_SETTINGS, CDDASH_PHP_OPCACHE, CDDASH_PHP_MODULE, CDDASH_PHP_MODULE_LIST, CDDASH_FRANKENPHP_REPO, CDDASH_FRANKENPHP_LIST, CDDASH_FRANKENPHP_INSTALL
EOF

if visudo -c -f "$SUDOERS_TMP" >/dev/null 2>&1; then
  install -m 440 -o root -g root "$SUDOERS_TMP" /etc/sudoers.d/caddy-dashboard
  rm -f "$SUDOERS_TMP"
  echo "OK: sudoers zaktualizowany: /etc/sudoers.d/caddy-dashboard"
else
  ERR="$(visudo -c -f "$SUDOERS_TMP" 2>&1 || true)"
  rm -f "$SUDOERS_TMP"
  echo "BLAD: nowa konfiguracja sudoers nie przeszla walidacji (visudo -c): ${ERR}" >&2
  exit 1
fi
