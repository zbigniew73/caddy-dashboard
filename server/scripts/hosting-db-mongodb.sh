#!/usr/bin/env bash
#
# Tworzy/usuwa realna baze MongoDB self-service z panelu klienta (/user/ -
# Bazy). Nazwa bazy JEST NAZWA UZYTKOWNIKA (jeden identyfikator dla obu),
# ten sam wzorzec co mongodb-test-db.sh. Walidacja formatu nazwy
# (srv_<id>_<sufiks>) juz przeszla w Node
# (server/services/hostingUserDatabases.js) - tu powtorzona jako druga
# linia obrony, bo nazwa trafia bezposrednio do stringow JS w mongosh.
#
# Haslo (tylko dla create) idzie na STDIN, nigdy jako argv - patrz
# uzasadnienie w hosting-user-set-password.sh.
#
# Laczy sie jako admin, haslo z /root/.adminmongodb (ten sam plik co
# mongodb-install.sh/mongodb-test-db.sh).
#
# Uzycie: hosting-db-mongodb.sh <create|delete> <dbname>   (haslo na stdin przy create)

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

ACTION="${1:-}"
DB="${2:-}"
PWFILE="/root/.adminmongodb"

[[ "$DB" =~ ^srv_[0-9]+_[A-Za-z0-9_]{1,32}$ ]] || err "Nieprawidlowa nazwa bazy: '${DB}'"
[ -f "$PWFILE" ] || err "Brak pliku ${PWFILE} - haslo administratora MongoDB nieznane."
ADMIN_PASS="$(cat "$PWFILE")"

run_mongosh() {
  mongosh --quiet -u admin -p "$ADMIN_PASS" --authenticationDatabase admin --eval "$1"
}

case "$ACTION" in
  create)
    DBPASS="$(cat -)"
    [ -z "$DBPASS" ] && err "Puste haslo."
    run_mongosh "db.getSiblingDB('${DB}').dropUser('${DB}')" >/dev/null 2>&1 || true
    run_mongosh "db.getSiblingDB('${DB}').createUser({user:'${DB}',pwd:'${DBPASS}',roles:[{role:'readWrite',db:'${DB}'}]})" \
      || err "Utworzenie uzytkownika nie powiodlo sie."
    run_mongosh "db.getSiblingDB('${DB}').createCollection('_init')" >/dev/null 2>&1 || true
    echo "OK: baza '${DB}' utworzona."
    ;;
  delete)
    run_mongosh "db.getSiblingDB('${DB}').dropDatabase()" \
      || err "Usuniecie bazy nie powiodlo sie."
    run_mongosh "db.getSiblingDB('${DB}').dropUser('${DB}')" >/dev/null 2>&1 || true
    echo "OK: baza '${DB}' usunieta."
    ;;
  *)
    err "Nieznana akcja: '${ACTION}' (oczekiwano create/delete)."
    ;;
esac
