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
Cmnd_Alias CDDASH_CADDY_LOGS = ${INSTALL_DIR}/server/scripts/caddy-ensure-logs.sh
Cmnd_Alias CDDASH_MARIADB_INSTALL = ${INSTALL_DIR}/server/scripts/mariadb-install.sh local, ${INSTALL_DIR}/server/scripts/mariadb-install.sh official 10.11, ${INSTALL_DIR}/server/scripts/mariadb-install.sh official 11.8
Cmnd_Alias CDDASH_MARIADB_PERF = ${INSTALL_DIR}/server/scripts/mariadb-set-performance.sh
Cmnd_Alias CDDASH_MARIADB_TESTDB = ${INSTALL_DIR}/server/scripts/mariadb-test-db.sh create, ${INSTALL_DIR}/server/scripts/mariadb-test-db.sh drop, ${INSTALL_DIR}/server/scripts/mariadb-test-db.sh status
Cmnd_Alias CDDASH_POSTGRESQL_INSTALL = ${INSTALL_DIR}/server/scripts/postgresql-install.sh local, ${INSTALL_DIR}/server/scripts/postgresql-install.sh official 16, ${INSTALL_DIR}/server/scripts/postgresql-install.sh official 17
Cmnd_Alias CDDASH_POSTGRESQL_PERF = ${INSTALL_DIR}/server/scripts/postgresql-set-performance.sh
Cmnd_Alias CDDASH_POSTGRESQL_TESTDB = ${INSTALL_DIR}/server/scripts/postgresql-test-db.sh create, ${INSTALL_DIR}/server/scripts/postgresql-test-db.sh drop, ${INSTALL_DIR}/server/scripts/postgresql-test-db.sh status
Cmnd_Alias CDDASH_MONGODB_INSTALL = ${INSTALL_DIR}/server/scripts/mongodb-install.sh 7.0, ${INSTALL_DIR}/server/scripts/mongodb-install.sh 8.0
Cmnd_Alias CDDASH_MONGODB_PERF = ${INSTALL_DIR}/server/scripts/mongodb-set-performance.sh
Cmnd_Alias CDDASH_MONGODB_TESTDB = ${INSTALL_DIR}/server/scripts/mongodb-test-db.sh create, ${INSTALL_DIR}/server/scripts/mongodb-test-db.sh drop, ${INSTALL_DIR}/server/scripts/mongodb-test-db.sh status
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
Cmnd_Alias CDDASH_PHPMYADMIN_INSTALL = ${INSTALL_DIR}/server/runtime-manager/scripts/phpmyadmin-install.sh
Cmnd_Alias CDDASH_PHPMYADMIN_UNINSTALL = ${INSTALL_DIR}/server/runtime-manager/scripts/phpmyadmin-uninstall.sh
Cmnd_Alias CDDASH_ADMINER_INSTALL = ${INSTALL_DIR}/server/runtime-manager/scripts/adminer-install.sh
Cmnd_Alias CDDASH_ADMINER_UNINSTALL = ${INSTALL_DIR}/server/runtime-manager/scripts/adminer-uninstall.sh
Cmnd_Alias CDDASH_HOSTING_SLICE = ${INSTALL_DIR}/server/scripts/hosting-slice-set.sh [0-9]*
Cmnd_Alias CDDASH_QUOTA_EXT4 = ${INSTALL_DIR}/server/scripts/quota-ext4-set.sh *
Cmnd_Alias CDDASH_QUOTA_XFS = ${INSTALL_DIR}/server/scripts/quota-xfs-set.sh *
Cmnd_Alias CDDASH_QUOTA_VERIFY = ${INSTALL_DIR}/server/scripts/quota-verify.sh *
Cmnd_Alias CDDASH_ACCOUNT_CREATE = ${INSTALL_DIR}/server/scripts/hosting-account-create.sh *
Cmnd_Alias CDDASH_ACCOUNT_DELETE = ${INSTALL_DIR}/server/scripts/hosting-account-delete.sh *
Cmnd_Alias CDDASH_ACCOUNT_SLICE_SET = ${INSTALL_DIR}/server/scripts/hosting-account-slice-set.sh [0-9]* [0-9]*
Cmnd_Alias CDDASH_ACCOUNT_SLICE_REMOVE = ${INSTALL_DIR}/server/scripts/hosting-account-slice-remove.sh [0-9]*
Cmnd_Alias CDDASH_ACCOUNT_SITES_COUNT = ${INSTALL_DIR}/server/scripts/hosting-account-sites-count.sh *
Cmnd_Alias CDDASH_ACCOUNT_DISK_USAGE = ${INSTALL_DIR}/server/scripts/hosting-account-disk-usage.sh *
Cmnd_Alias CDDASH_HOSTING_USER_PWSTATUS = ${INSTALL_DIR}/server/scripts/hosting-user-password-status.sh *
Cmnd_Alias CDDASH_HOSTING_USER_SETPW = ${INSTALL_DIR}/server/scripts/hosting-user-set-password.sh *
Cmnd_Alias CDDASH_HOSTING_USER_CRONTAB_GET = ${INSTALL_DIR}/server/scripts/hosting-user-crontab-get.sh *
Cmnd_Alias CDDASH_HOSTING_USER_CRONTAB_SET = ${INSTALL_DIR}/server/scripts/hosting-user-crontab-set.sh *
Cmnd_Alias CDDASH_HOSTING_USER_CPU_TICKS = ${INSTALL_DIR}/server/scripts/hosting-user-cpu-ticks.sh *
Cmnd_Alias CDDASH_HOSTING_DB_MARIADB = ${INSTALL_DIR}/server/scripts/hosting-db-mariadb.sh create *, ${INSTALL_DIR}/server/scripts/hosting-db-mariadb.sh delete *
Cmnd_Alias CDDASH_HOSTING_DB_POSTGRESQL = ${INSTALL_DIR}/server/scripts/hosting-db-postgresql.sh create *, ${INSTALL_DIR}/server/scripts/hosting-db-postgresql.sh delete *
Cmnd_Alias CDDASH_HOSTING_DB_MONGODB = ${INSTALL_DIR}/server/scripts/hosting-db-mongodb.sh create *, ${INSTALL_DIR}/server/scripts/hosting-db-mongodb.sh delete *
Cmnd_Alias CDDASH_HOSTING_SITE = ${INSTALL_DIR}/server/scripts/hosting-user-site.sh apply * * * *, ${INSTALL_DIR}/server/scripts/hosting-user-site.sh check * *, ${INSTALL_DIR}/server/scripts/hosting-user-site.sh get * *, ${INSTALL_DIR}/server/scripts/hosting-user-site.sh enable * *, ${INSTALL_DIR}/server/scripts/hosting-user-site.sh disable * *, ${INSTALL_DIR}/server/scripts/hosting-user-site.sh delete * *
Cmnd_Alias CDDASH_HOSTING_REDIS_APPLY = ${INSTALL_DIR}/server/scripts/hosting-user-redis-apply.sh *
Cmnd_Alias CDDASH_HOSTING_REDIS_STOP = ${INSTALL_DIR}/server/scripts/hosting-user-redis-stop.sh *
Cmnd_Alias CDDASH_HOSTING_REDIS_INFO = ${INSTALL_DIR}/server/scripts/hosting-user-redis-info.sh *
Cmnd_Alias CDDASH_HOSTING_USER_SSHKEYS_GET = ${INSTALL_DIR}/server/scripts/hosting-user-ssh-keys-get.sh *
Cmnd_Alias CDDASH_HOSTING_USER_SSHKEYS_SET = ${INSTALL_DIR}/server/scripts/hosting-user-ssh-keys-set.sh *
Cmnd_Alias CDDASH_PAM_CHECK = ${INSTALL_DIR}/server/scripts/pam-login-check.cjs *
Cmnd_Alias CDDASH_CRON_JOBS_COUNT = ${INSTALL_DIR}/server/scripts/cron-jobs-count.sh
Cmnd_Alias CDDASH_HOSTING_BACKUP_REPO_INIT = ${INSTALL_DIR}/server/scripts/hosting-user-backup-repo-init.sh *
Cmnd_Alias CDDASH_HOSTING_BACKUP_JOB_WRITE = ${INSTALL_DIR}/server/scripts/hosting-user-backup-job-write.sh * *
Cmnd_Alias CDDASH_HOSTING_BACKUP_JOB_DELETE = ${INSTALL_DIR}/server/scripts/hosting-user-backup-job-delete.sh * *
Cmnd_Alias CDDASH_HOSTING_BACKUP_RUN = ${INSTALL_DIR}/server/scripts/hosting-user-backup-run.sh * *
Cmnd_Alias CDDASH_HOSTING_BACKUP_SNAPSHOTS = ${INSTALL_DIR}/server/scripts/hosting-user-backup-snapshots.sh *
Cmnd_Alias CDDASH_HOSTING_BACKUP_RESTORE = ${INSTALL_DIR}/server/scripts/hosting-user-backup-restore.sh * *
Cmnd_Alias CDDASH_HOSTING_PHP_POOL = ${INSTALL_DIR}/server/scripts/hosting-user-php-pool-apply.sh apply * * * * * *, ${INSTALL_DIR}/server/scripts/hosting-user-php-pool-apply.sh remove * * *, ${INSTALL_DIR}/server/scripts/hosting-user-php-pool-apply.sh reload * *
Cmnd_Alias CDDASH_HOSTING_PYTHON_VENV = ${INSTALL_DIR}/server/scripts/hosting-user-python-venv.sh create * *, ${INSTALL_DIR}/server/scripts/hosting-user-python-venv.sh install * *, ${INSTALL_DIR}/server/scripts/hosting-user-python-venv.sh status *, ${INSTALL_DIR}/server/scripts/hosting-user-python-venv.sh remove *
Cmnd_Alias CDDASH_HOSTING_PYTHON_APP = ${INSTALL_DIR}/server/scripts/hosting-user-python-app.sh start * * *, ${INSTALL_DIR}/server/scripts/hosting-user-python-app.sh stop *, ${INSTALL_DIR}/server/scripts/hosting-user-python-app.sh status *

${SVC_USER} ALL=(root) NOPASSWD: CDDASH_SYSTEMCTL, CDDASH_DNF, CDDASH_FIREWALL, CDDASH_SSH_PORT, CDDASH_REBOOT, CDDASH_FAIL2BAN, CDDASH_CADDY_PERF, CDDASH_CADDY_LOGS, CDDASH_MARIADB_INSTALL, CDDASH_MARIADB_PERF, CDDASH_MARIADB_TESTDB, CDDASH_POSTGRESQL_INSTALL, CDDASH_POSTGRESQL_PERF, CDDASH_POSTGRESQL_TESTDB, CDDASH_MONGODB_INSTALL, CDDASH_MONGODB_PERF, CDDASH_MONGODB_TESTDB, CDDASH_REDIS_INSTALL, CDDASH_REDIS_PERF, CDDASH_PHP_REPOS, CDDASH_PHP_LIST, CDDASH_PHP_INSTALL, CDDASH_PHP_SETTINGS, CDDASH_PHP_OPCACHE, CDDASH_PHP_MODULE, CDDASH_PHP_MODULE_LIST, CDDASH_FRANKENPHP_REPO, CDDASH_FRANKENPHP_LIST, CDDASH_FRANKENPHP_INSTALL, CDDASH_PHPMYADMIN_INSTALL, CDDASH_PHPMYADMIN_UNINSTALL, CDDASH_ADMINER_INSTALL, CDDASH_ADMINER_UNINSTALL, CDDASH_HOSTING_SLICE, CDDASH_QUOTA_EXT4, CDDASH_QUOTA_XFS, CDDASH_QUOTA_VERIFY, CDDASH_ACCOUNT_CREATE, CDDASH_ACCOUNT_DELETE, CDDASH_ACCOUNT_SLICE_SET, CDDASH_ACCOUNT_SLICE_REMOVE, CDDASH_ACCOUNT_SITES_COUNT, CDDASH_ACCOUNT_DISK_USAGE, CDDASH_HOSTING_USER_PWSTATUS, CDDASH_HOSTING_USER_SETPW, CDDASH_HOSTING_USER_CRONTAB_GET, CDDASH_HOSTING_USER_CRONTAB_SET, CDDASH_HOSTING_USER_CPU_TICKS, CDDASH_HOSTING_SITE, CDDASH_HOSTING_DB_MARIADB, CDDASH_HOSTING_DB_POSTGRESQL, CDDASH_HOSTING_DB_MONGODB, CDDASH_HOSTING_REDIS_APPLY, CDDASH_HOSTING_REDIS_STOP, CDDASH_HOSTING_REDIS_INFO, CDDASH_HOSTING_USER_SSHKEYS_GET, CDDASH_HOSTING_USER_SSHKEYS_SET, CDDASH_CRON_JOBS_COUNT, CDDASH_PAM_CHECK, CDDASH_HOSTING_BACKUP_REPO_INIT, CDDASH_HOSTING_BACKUP_JOB_WRITE, CDDASH_HOSTING_BACKUP_JOB_DELETE, CDDASH_HOSTING_BACKUP_RUN, CDDASH_HOSTING_BACKUP_SNAPSHOTS, CDDASH_HOSTING_BACKUP_RESTORE, CDDASH_HOSTING_PHP_POOL, CDDASH_HOSTING_PYTHON_VENV, CDDASH_HOSTING_PYTHON_APP
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
