#!/usr/bin/env bash
#
# Instaluje MariaDB dwiema sciezkami: "local" (pakiet z domyslnego
# repozytorium Alma/Rocky) albo "official" <wersja> (oficjalne repo
# MariaDB.com, wersja 10.11 albo 11.8). Po instalacji generuje losowe
# 16-znakowe haslo, ustawia je jako haslo uzytkownika root@localhost w samej
# bazie (przez unix_socket, dostepne od razu po swiezej instalacji) i dopiero
# PO potwierdzonym sukcesie zapisuje je w /root/.mariadb.

set -uo pipefail

MODE="${1:-}"
VERSION="${2:-}"
PWFILE="/root/.mariadb"

err() { echo "BLAD: $*" >&2; exit 1; }

case "$MODE" in
  local)
    dnf install -y mariadb-server mariadb || err "Instalacja z lokalnego repozytorium nie powiodla sie."
    ;;
  official)
    [[ "$VERSION" == "10.11" || "$VERSION" == "11.8" ]] || err "Nieprawidlowa wersja MariaDB: '${VERSION}'."
    curl -LsS https://downloads.mariadb.com/MariaDB/mariadb_repo_setup | bash -s -- --mariadb-server-version="${VERSION}" \
      || err "Konfiguracja oficjalnego repozytorium MariaDB nie powiodla sie."
    dnf clean all
    dnf install -y mariadb-server mariadb || err "Instalacja z oficjalnego repozytorium nie powiodla sie."
    ;;
  *)
    err "Nieznany tryb instalacji: '${MODE}'."
    ;;
esac

systemctl enable --now mariadb || err "Pakiet zainstalowany, ale nie udalo sie uruchomic/wlaczyc uslugi mariadb."

if [ ! -f "$PWFILE" ]; then
  PASSWORD="$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c16)"

  mariadb -u root <<SQL || err "Wygenerowano haslo, ale nie udalo sie ustawic go jako haslo root w MariaDB."
ALTER USER 'root'@'localhost' IDENTIFIED BY '${PASSWORD}';
FLUSH PRIVILEGES;
SQL

  umask 077
  printf '%s\n' "$PASSWORD" > "$PWFILE"
  chown root:root "$PWFILE"
  chmod 600 "$PWFILE"
fi

echo "OK: MariaDB zainstalowany i uruchomiony. Haslo root ustawione w bazie i zapisane w ${PWFILE} (tryb: ${MODE}${VERSION:+ $VERSION})."
