#!/usr/bin/env bash
#
# Tworzy/usuwa jedna, stala testowa baze MariaDB - nazwa bazy, uzytkownik
# i haslo sa CELOWO zaszyte na sztywno (user sam podal te dokladne dane,
# to wygodna, jednorazowa baza do szybkich prob, nie produkcyjna).
#
# Root NIE laczy sie juz bez hasla przez unix_socket - potwierdzone na
# zywym serwerze (2026-08-09, "Access denied for user 'root'@'localhost'
# (using password: NO)"): mariadb-install.sh od razu po instalacji
# ustawia haslo na root@localhost (`ALTER USER ... IDENTIFIED BY`), wiec
# passwordless unix_socket dziala TYLKO w krotkim oknie tuz po swiezej
# instalacji, zanim haslo zostanie ustawione. Haslo czytamy z
# /root/.mariadb (ten sam plik co mariadb-install.sh zapisuje).

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

ACTION="${1:-}"
DB="baza123"
DBUSER="baza123"
DBPASS="pass!123"
PWFILE="/root/.mariadb"

[ -f "$PWFILE" ] || err "Brak pliku ${PWFILE} - haslo root MariaDB nieznane (baza nie zostala zainstalowana przez ten panel?)."
ROOT_PASS="$(cat "$PWFILE")"

case "$ACTION" in
  create)
    mariadb -u root -p"${ROOT_PASS}" <<SQL || err "Utworzenie testowej bazy nie powiodlo sie."
CREATE DATABASE IF NOT EXISTS \`${DB}\`;
CREATE USER IF NOT EXISTS '${DBUSER}'@'localhost' IDENTIFIED BY '${DBPASS}';
GRANT ALL PRIVILEGES ON \`${DB}\`.* TO '${DBUSER}'@'localhost';
FLUSH PRIVILEGES;
SQL
    echo "OK: testowa baza '${DB}' i uzytkownik '${DBUSER}' utworzeni."
    ;;
  drop)
    mariadb -u root -p"${ROOT_PASS}" <<SQL || err "Usuniecie testowej bazy nie powiodlo sie."
DROP DATABASE IF EXISTS \`${DB}\`;
DROP USER IF EXISTS '${DBUSER}'@'localhost';
FLUSH PRIVILEGES;
SQL
    echo "OK: testowa baza '${DB}' i uzytkownik '${DBUSER}' usunieci."
    ;;
  status)
    FOUND="$(mariadb -u root -p"${ROOT_PASS}" -N -B -e "SHOW DATABASES LIKE '${DB}';" 2>/dev/null)"
    [ "$FOUND" = "$DB" ] && echo "exists" || echo "missing"
    ;;
  *)
    err "Nieznana akcja: '${ACTION}' (oczekiwano create/drop/status)."
    ;;
esac
