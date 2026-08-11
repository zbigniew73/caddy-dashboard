#!/usr/bin/env bash
#
# Tworzy/usuwa realna baze PostgreSQL self-service z panelu klienta
# (/user/ - Bazy). Nazwa bazy JEST NAZWA UZYTKOWNIKA (jeden identyfikator
# dla obu), ten sam wzorzec co postgresql-test-db.sh. Walidacja formatu
# nazwy (srv_<id>_<sufiks>) juz przeszla w Node
# (server/services/hostingUserDatabases.js) - tu powtorzona jako druga
# linia obrony, bo nazwa trafia bezposrednio do zapytan SQL.
#
# Haslo (tylko dla create) idzie na STDIN, nigdy jako argv - patrz
# uzasadnienie w hosting-user-set-password.sh.
#
# Laczy sie jako systemowy user postgres (peer auth), tak samo jak
# postgresql-install.sh/postgresql-test-db.sh.
#
# Uzycie: hosting-db-postgresql.sh <create|delete> <dbname>   (haslo na stdin przy create)

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

ACTION="${1:-}"
DB="${2:-}"

[[ "$DB" =~ ^srv_[0-9]+_[A-Za-z0-9_]{1,32}$ ]] || err "Nieprawidlowa nazwa bazy: '${DB}'"

db_exists() {
  [ "$(runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB}'" 2>/dev/null | tr -d '[:space:]')" = "1" ]
}

role_exists() {
  [ "$(runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB}'" 2>/dev/null | tr -d '[:space:]')" = "1" ]
}

case "$ACTION" in
  create)
    DBPASS="$(cat -)"
    [ -z "$DBPASS" ] && err "Puste haslo."
    if ! role_exists; then
      runuser -u postgres -- psql -c "CREATE ROLE ${DB} LOGIN PASSWORD '${DBPASS}';" \
        || err "Utworzenie uzytkownika nie powiodlo sie."
    fi
    if ! db_exists; then
      runuser -u postgres -- createdb -O "${DB}" "${DB}" \
        || err "Utworzenie bazy nie powiodlo sie."
    fi
    echo "OK: baza '${DB}' utworzona."
    ;;
  delete)
    if db_exists; then
      runuser -u postgres -- dropdb "${DB}" || err "Usuniecie bazy nie powiodlo sie."
    fi
    if role_exists; then
      runuser -u postgres -- psql -c "DROP ROLE ${DB};" || err "Usuniecie uzytkownika nie powiodlo sie."
    fi
    echo "OK: baza '${DB}' usunieta."
    ;;
  *)
    err "Nieznana akcja: '${ACTION}' (oczekiwano create/delete)."
    ;;
esac
