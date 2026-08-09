#!/usr/bin/env bash
#
# Instaluje Redis dwiema sciezkami: "local" (modul AppStream Alma/Rocky)
# albo "official" (oficjalne repozytorium Redis Ltd, packages.redis.io -
# zawsze najnowsza wersja; Redis Ltd, w przeciwienstwie do MongoDB, nie
# utrzymuje rownoleglych repozytoriow per-wersja, wiec nie ma tu wyboru
# konkretnego numeru).
#
# Uwaga: Alma/Rocky 9.5+/10 zastapily pakiet "redis" forkiem "valkey" po
# zmianie licencji Redis Ltd w 2024 (SSPL, niedopuszczona do RHEL/EPEL) -
# sciezka "local" probuje "redis", potem fallback na "valkey". Sciezka
# "official" zawsze instaluje prawdziwy pakiet "redis" z wlasnego
# repozytorium Redis Ltd, tego problemu nie dotyczy.
#
# Po instalacji: generuje losowe 16-znakowe haslo i ustawia je jako
# requirepass. W Redis to dziala NATYCHMIAST bez restartu (CONFIG SET),
# trwaly zapis do redis.conf robi CONFIG REWRITE. Haslo zapisuje w
# /root/.redispw dopiero PO potwierdzonej weryfikacji polaczenia z haslem.

set -uo pipefail

MODE="${1:-}"
PWFILE="/root/.redispw"

err() { echo "BLAD: $*" >&2; exit 1; }

source "$(dirname "${BASH_SOURCE[0]}")/lib-gen-password.sh"

case "$MODE" in
  local)
    if ! dnf install -y redis 2>/dev/null && ! dnf install -y valkey; then
      err "Instalacja z lokalnego repozytorium nie powiodla sie (probowano pakietow redis i valkey)."
    fi
    ;;
  official)
    rpm --import https://packages.redis.io/gpg || err "Import klucza GPG Redis nie powiodl sie."
    OS_MAJOR="$(rpm -E %{rhel})"
    dnf -qy module disable redis >/dev/null 2>&1 || true
    cat > /etc/yum.repos.d/redis.repo <<REPOEOF
[Redis]
name=Redis
baseurl=https://packages.redis.io/rpm/rhel${OS_MAJOR}
enabled=1
gpgcheck=1
REPOEOF
    dnf install -y redis || err "Instalacja z oficjalnego repozytorium nie powiodla sie."
    ;;
  *)
    err "Nieznany tryb instalacji: '${MODE}'."
    ;;
esac

SVC_UNIT=""
for u in redis.service valkey.service; do
  if systemctl list-unit-files "$u" --no-legend 2>/dev/null | grep -q "$u"; then
    SVC_UNIT="$u"
    break
  fi
done
[ -n "$SVC_UNIT" ] || err "Nie znaleziono jednostki systemd redis.service ani valkey.service po instalacji."

systemctl enable --now "$SVC_UNIT" || err "Zainstalowano, ale nie udalo sie uruchomic/wlaczyc uslugi ${SVC_UNIT}."

CLI="redis-cli"
command -v redis-cli >/dev/null 2>&1 || CLI="valkey-cli"
command -v "$CLI" >/dev/null 2>&1 || err "Nie znaleziono ani redis-cli, ani valkey-cli po instalacji."

READY=""
for _ in $(seq 1 30); do
  if "$CLI" ping >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done
[ -n "$READY" ] || err "${SVC_UNIT} nie odpowiada po 30 sekundach od uruchomienia."

if [ ! -f "$PWFILE" ]; then
  PASSWORD="$(gen_password)"

  "$CLI" CONFIG SET requirepass "$PASSWORD" >/dev/null \
    || err "Nie udalo sie ustawic hasla (requirepass) w Redis."
  "$CLI" -a "$PASSWORD" --no-auth-warning CONFIG REWRITE >/dev/null \
    || err "Haslo ustawione, ale trwaly zapis (CONFIG REWRITE) nie powiodl sie."
  "$CLI" -a "$PASSWORD" --no-auth-warning ping 2>/dev/null | grep -q PONG \
    || err "Haslo ustawione, ale weryfikacja polaczenia z haslem nie powiodla sie."

  umask 077
  if ! printf '%s\n' "$PASSWORD" > "$PWFILE"; then
    err "Haslo ustawione w Redis (haslo: ${PASSWORD}), ale zapis ${PWFILE} nie powiodl sie - zapisz to haslo recznie."
  fi
  if ! chown root:root "$PWFILE" || ! chmod 600 "$PWFILE"; then
    err "Haslo zapisane w ${PWFILE}, ale nie udalo sie ustawic wlasciciela/uprawnien pliku - sprawdz recznie (powinno byc chown root:root, chmod 600)."
  fi
fi

echo "OK: Redis zainstalowany i uruchomiony (${SVC_UNIT}). Haslo (requirepass) ustawione i zapisane w ${PWFILE} (tryb: ${MODE})."
