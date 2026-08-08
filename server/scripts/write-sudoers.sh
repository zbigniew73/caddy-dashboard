#!/usr/bin/env bash
#
# Generuje i instaluje /etc/sudoers.d/caddy-dashboard. Jedyne miejsce, gdzie
# istnieje tresc tego pliku - wywolywane zarowno przez install.sh (podczas
# pelnej instalacji) jak i przez refresh-sudoers.sh (szybka aktualizacja
# samych uprawnien sudo na juz dzialajacej instalacji, bez reinstalacji
# calego panelu). Musi byc uruchomione jako root.
#
# Wymagane zmienne srodowiskowe: INSTALL_DIR, SVC_USER.

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

${SVC_USER} ALL=(root) NOPASSWD: CDDASH_SYSTEMCTL, CDDASH_DNF, CDDASH_FIREWALL, CDDASH_SSH_PORT, CDDASH_REBOOT, CDDASH_FAIL2BAN, CDDASH_CADDY_PERF, CDDASH_MARIADB_INSTALL, CDDASH_MARIADB_PERF
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
