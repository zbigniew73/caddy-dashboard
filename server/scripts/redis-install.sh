#!/usr/bin/env bash
#
# Instaluje Redis dwiema sciezkami: "local" (modul AppStream Alma/Rocky)
# albo "official" (oficjalne repozytorium Redis Ltd, packages.redis.io -
# zawsze najnowsza wersja; Redis Ltd, w przeciwienstwie do MongoDB, nie
# utrzymuje rownoleglych repozytoriow per-wersja, wiec nie ma tu wyboru
# konkretnego numeru).
#
# Po instalacji: generuje losowe 16-znakowe haslo i ustawia je jako
# requirepass. W Redis to dziala NATYCHMIAST bez restartu (CONFIG SET),
# trwaly zapis do redis.conf robi CONFIG REWRITE. Haslo zapisuje w
# /root/.redispw dopiero PO potwierdzonej weryfikacji polaczenia z haslem.

set -uo pipefail

MODE="${1:-}"
PWFILE="/root/.redispw"

err() { echo "BLAD: $*" >&2; exit 1; }

case "$MODE" in
  local)
    dnf install -y redis || err "Instalacja z lokalnego repozytorium nie powiodla sie."
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

systemctl enable --now redis || err "Zainstalowano, ale nie udalo sie uruchomic/wlaczyc uslugi redis."

READY=""
for _ in $(seq 1 30); do
  if redis-cli ping >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done
[ -n "$READY" ] || err "redis nie odpowiada po 30 sekundach od uruchomienia."

if [ ! -f "$PWFILE" ]; then
  PASSWORD="$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c16)"

  redis-cli CONFIG SET requirepass "$PASSWORD" >/dev/null \
    || err "Nie udalo sie ustawic hasla (requirepass) w Redis."
  redis-cli -a "$PASSWORD" --no-auth-warning CONFIG REWRITE >/dev/null \
    || err "Haslo ustawione, ale trwaly zapis (CONFIG REWRITE) nie powiodl sie."
  redis-cli -a "$PASSWORD" --no-auth-warning ping 2>/dev/null | grep -q PONG \
    || err "Haslo ustawione, ale weryfikacja polaczenia z haslem nie powiodla sie."

  umask 077
  if ! printf '%s\n' "$PASSWORD" > "$PWFILE"; then
    err "Haslo ustawione w Redis (haslo: ${PASSWORD}), ale zapis ${PWFILE} nie powiodl sie - zapisz to haslo recznie."
  fi
  if ! chown root:root "$PWFILE" || ! chmod 600 "$PWFILE"; then
    err "Haslo zapisane w ${PWFILE}, ale nie udalo sie ustawic wlasciciela/uprawnien pliku - sprawdz recznie (powinno byc chown root:root, chmod 600)."
  fi
fi

echo "OK: Redis zainstalowany i uruchomiony. Haslo (requirepass) ustawione i zapisane w ${PWFILE} (tryb: ${MODE})."
