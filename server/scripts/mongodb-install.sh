#!/usr/bin/env bash
#
# Instaluje MongoDB z oficjalnego repozytorium MongoDB Inc. (repo.mongodb.org).
# AlmaLinux/Rocky NIE maja MongoDB w domyslnych repozytoriach (licencja
# SSPL nie jest dopuszczona do RHEL/EPEL) - to jedyna dostepna sciezka
# instalacji, wersja 7.0 albo 8.0.
#
# Po instalacji: generuje losowe 16-znakowe haslo, tworzy uzytkownika
# administracyjnego "admin" w bazie admin (dopoki autoryzacja jeszcze
# wylaczona - domyslny stan swiezej instalacji), WLACZA autoryzacje w
# mongod.conf i restartuje usluge z nia. Haslo zapisuje w /root/.adminmongodb
# dopiero PO potwierdzonym sukcesie wszystkich krokow.
#
# Uwaga: NIE /root/.mongodb - mongosh sam automatycznie tworzy katalog
# ~/.mongodb/ (historia komend, telemetria), wiec ta nazwa koliduje z
# katalogiem i zapis pliku pod ta sciezka po cichu sie nie udaje.

set -uo pipefail

VERSION="${1:-}"
PWFILE="/root/.adminmongodb"
CONF="/etc/mongod.conf"

err() { echo "BLAD: $*" >&2; exit 1; }

[[ "$VERSION" == "7.0" || "$VERSION" == "8.0" ]] || err "Nieprawidlowa wersja MongoDB: '${VERSION}'."

OS_MAJOR="$(rpm -E %{rhel})"

cat > "/etc/yum.repos.d/mongodb-org-${VERSION}.repo" <<REPOEOF
[mongodb-org-${VERSION}]
name=MongoDB Repository
baseurl=https://repo.mongodb.org/yum/redhat/${OS_MAJOR}/mongodb-org/${VERSION}/x86_64/
gpgcheck=1
enabled=1
gpgkey=https://pgp.mongodb.com/server-${VERSION}.asc
REPOEOF

dnf install -y mongodb-org || err "Instalacja pakietu mongodb-org nie powiodla sie."

systemctl enable --now mongod || err "Zainstalowano, ale nie udalo sie uruchomic/wlaczyc uslugi mongod."

# Pierwsze uruchomienie (swiezy, pusty katalog danych) potrafi trwac dluzej
# niz zwykly restart - czekamy az mongod faktycznie odpowiada, zanim
# sprobujemy sie polaczyc mongosh (bez tego: connect ECONNREFUSED).
READY=""
for _ in $(seq 1 30); do
  if mongosh --quiet --eval "db.runCommand({ping:1})" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done
[ -n "$READY" ] || err "mongod nie odpowiada na porcie 27017 po 30 sekundach od uruchomienia."

if [ ! -f "$PWFILE" ]; then
  PASSWORD="$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c16)"

  mongosh --quiet --eval "db.getSiblingDB('admin').createUser({user:'admin',pwd:'${PASSWORD}',roles:[{role:'root',db:'admin'}]})" \
    || err "Wygenerowano haslo, ale nie udalo sie utworzyc uzytkownika admin w MongoDB."

  BACKUP="${CONF}.bak-$(date +%Y%m%d%H%M%S)"
  cp -p "$CONF" "$BACKUP" || err "Uzytkownik admin utworzony, ale nie udalo sie zrobic backupu ${CONF}."
  printf '\nsecurity:\n  authorization: enabled\n' >> "$CONF"

  if ! systemctl restart mongod 2>/tmp/mongodb-install.err; then
    ERR_MSG="$(cat /tmp/mongodb-install.err 2>/dev/null)"
    rm -f /tmp/mongodb-install.err
    cp -p "$BACKUP" "$CONF"
    systemctl restart mongod >/dev/null 2>&1 || true
    err "Restart mongod z wlaczona autoryzacja nie powiodl sie: ${ERR_MSG} - przywrocono poprzednia konfiguracje (uzytkownik admin zostal utworzony w bazie, ale autoryzacja jest nadal WYLACZONA - sprobuj ponownie)."
  fi
  rm -f /tmp/mongodb-install.err

  LIVE=""
  for _ in 1 2 3 4 5; do
    if systemctl is-active --quiet mongod; then
      LIVE=1
      break
    fi
    sleep 1
  done
  if [ -z "$LIVE" ]; then
    cp -p "$BACKUP" "$CONF"
    systemctl restart mongod >/dev/null 2>&1 || true
    err "mongod nie dziala poprawnie po wlaczeniu autoryzacji - przywrocono poprzednia konfiguracje (autoryzacja WYLACZONA)."
  fi

  umask 077
  if ! printf '%s\n' "$PASSWORD" > "$PWFILE"; then
    err "Autoryzacja wlaczona i uzytkownik admin ustawiony w bazie (haslo: ${PASSWORD}), ale zapis ${PWFILE} nie powiodl sie - zapisz to haslo recznie."
  fi
  if ! chown root:root "$PWFILE" || ! chmod 600 "$PWFILE"; then
    err "Haslo zapisane w ${PWFILE}, ale nie udalo sie ustawic wlasciciela/uprawnien pliku - sprawdz recznie (powinno byc chown root:root, chmod 600)."
  fi
fi

echo "OK: MongoDB ${VERSION} zainstalowany i uruchomiony (autoryzacja wlaczona). Haslo administratora ustawione i zapisane w ${PWFILE}."
