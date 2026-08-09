#!/usr/bin/env bash
#
# Idempotentnie wlacza EPEL + Remi - wymagane dla rownoleglych wersji PHP
# (php82/php83/php84/php85 to pakiety SCL z Remi, nie ma ich w bazowych
# repozytoriach Alma/Rocky). Bezpieczne do wielokrotnego uruchomienia -
# wolane przed KAZDA instalacja wersji PHP (patrz routes/php.js), nie
# tylko raz.

set -euo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

OS_MAJOR="$(rpm -E %{rhel} 2>/dev/null || true)"
[[ "$OS_MAJOR" == "9" || "$OS_MAJOR" == "10" ]] \
  || err "Nieobslugiwana wersja systemu (rpm -E %{rhel} zwrocilo: '${OS_MAJOR}') - wymagany AlmaLinux/Rocky 9 lub 10."

rpm -q epel-release >/dev/null 2>&1 \
  || dnf install -y "https://dl.fedoraproject.org/pub/epel/epel-release-latest-${OS_MAJOR}.noarch.rpm" \
  || err "Instalacja EPEL nie powiodla sie."

rpm -q remi-release >/dev/null 2>&1 \
  || dnf install -y "https://rpms.remirepo.net/enterprise/remi-release-${OS_MAJOR}.rpm" \
  || err "Instalacja repozytorium Remi nie powiodla sie."

dnf install -y 'dnf-command(config-manager)' >/dev/null 2>&1 || true
if command -v crb >/dev/null 2>&1; then
  crb enable || err "Wlaczenie repozytorium CRB (crb enable) nie powiodlo sie."
else
  dnf config-manager --set-enabled crb || err "Wlaczenie repozytorium CRB (config-manager) nie powiodlo sie."
fi

echo "OK: EPEL i Remi wlaczone (RHEL ${OS_MAJOR})."
