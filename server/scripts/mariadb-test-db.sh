#!/usr/bin/env bash
#
# Tworzy/usuwa jedna, stala testowa baze MariaDB - nazwa bazy, uzytkownik
# i haslo sa CELOWO zaszyte na sztywno (user sam podal te dokladne dane,
# to wygodna, jednorazowa baza do szybkich prob, nie produkcyjna). Root
# laczy sie bez hasla przez unix_socket, tak samo jak mariadb-install.sh.

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

ACTION="${1:-}"
DB="baza123"
DBUSER="baza123"
DBPASS="pass!123"

case "$ACTION" in
  create)
    mariadb -u root <<SQL || err "Utworzenie testowej bazy nie powiodlo sie."
CREATE DATABASE IF NOT EXISTS \`${DB}\`;
CREATE USER IF NOT EXISTS '${DBUSER}'@'localhost' IDENTIFIED BY '${DBPASS}';
GRANT ALL PRIVILEGES ON \`${DB}\`.* TO '${DBUSER}'@'localhost';
FLUSH PRIVILEGES;
SQL
    echo "OK: testowa baza '${DB}' i uzytkownik '${DBUSER}' utworzeni."
    ;;
  drop)
    mariadb -u root <<SQL || err "Usuniecie testowej bazy nie powiodlo sie."
DROP DATABASE IF EXISTS \`${DB}\`;
DROP USER IF EXISTS '${DBUSER}'@'localhost';
FLUSH PRIVILEGES;
SQL
    echo "OK: testowa baza '${DB}' i uzytkownik '${DBUSER}' usunieci."
    ;;
  status)
    FOUND="$(mariadb -u root -N -B -e "SHOW DATABASES LIKE '${DB}';" 2>/dev/null)"
    [ "$FOUND" = "$DB" ] && echo "exists" || echo "missing"
    ;;
  *)
    err "Nieznana akcja: '${ACTION}' (oczekiwano create/drop/status)."
    ;;
esac
