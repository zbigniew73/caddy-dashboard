#!/usr/bin/env bash
#
# Tworzy/usuwa realna baze MariaDB self-service z panelu klienta (/user/ -
# Bazy). Nazwa bazy JEST NAZWA UZYTKOWNIKA (jeden identyfikator dla obu,
# ten sam wzorzec co mariadb-test-db.sh). Walidacja formatu nazwy
# (srv_<id>_<sufiks>) juz przeszla w Node
# (server/services/hostingUserDatabases.js) - tu powtorzona jako druga
# linia obrony, bo nazwa trafia bezposrednio do zapytan SQL.
#
# Haslo (tylko dla create) idzie na STDIN, nigdy jako argv - patrz
# uzasadnienie w hosting-user-set-password.sh (konta hostingowe maja pelny
# SSH, argv jest widoczne dla innych lokalnych userow).
#
# Root laczy sie haslem z /root/.mariadb (ten sam plik co
# mariadb-install.sh/mariadb-test-db.sh).
#
# Uzycie: hosting-db-mariadb.sh <create|delete> <dbname>   (haslo na stdin przy create)

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

ACTION="${1:-}"
DB="${2:-}"
PWFILE="/root/.mariadb"

[[ "$DB" =~ ^srv_[0-9]+_[A-Za-z0-9_]{1,32}$ ]] || err "Nieprawidlowa nazwa bazy: '${DB}'"
[ -f "$PWFILE" ] || err "Brak pliku ${PWFILE} - haslo root MariaDB nieznane."
ROOT_PASS="$(cat "$PWFILE")"

case "$ACTION" in
  create)
    DBPASS="$(cat -)"
    [ -z "$DBPASS" ] && err "Puste haslo."
    mariadb -u root -p"${ROOT_PASS}" <<SQL || err "Utworzenie bazy nie powiodlo sie."
CREATE DATABASE IF NOT EXISTS \`${DB}\`;
CREATE USER IF NOT EXISTS '${DB}'@'localhost' IDENTIFIED BY '${DBPASS}';
GRANT ALL PRIVILEGES ON \`${DB}\`.* TO '${DB}'@'localhost';
FLUSH PRIVILEGES;
SQL
    echo "OK: baza '${DB}' utworzona."
    ;;
  delete)
    mariadb -u root -p"${ROOT_PASS}" <<SQL || err "Usuniecie bazy nie powiodlo sie."
DROP DATABASE IF EXISTS \`${DB}\`;
DROP USER IF EXISTS '${DB}'@'localhost';
FLUSH PRIVILEGES;
SQL
    echo "OK: baza '${DB}' usunieta."
    ;;
  *)
    err "Nieznana akcja: '${ACTION}' (oczekiwano create/delete)."
    ;;
esac
