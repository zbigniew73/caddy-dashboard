#!/usr/bin/env bash
#
# Tworzy/usuwa jedna, stala testowa baze PostgreSQL - nazwa bazy,
# uzytkownik i haslo sa CELOWO zaszyte na sztywno (user sam podal te
# dokladne dane, to wygodna, jednorazowa baza do szybkich prob, nie
# produkcyjna). Laczy sie jako systemowy user postgres (peer auth), tak
# samo jak postgresql-install.sh.
#
# CREATE DATABASE nie wspiera IF NOT EXISTS w PostgreSQL (w
# przeciwienstwie do MariaDB) - stad rowny sprawdzenie istnienia PRZED
# utworzeniem zamiast polegania na bledzie "already exists".

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

ACTION="${1:-}"
DB="baza123"
DBUSER="baza123"
DBPASS="pass!123"

db_exists() {
  [ "$(runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB}'" 2>/dev/null | tr -d '[:space:]')" = "1" ]
}

role_exists() {
  [ "$(runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DBUSER}'" 2>/dev/null | tr -d '[:space:]')" = "1" ]
}

case "$ACTION" in
  create)
    if ! role_exists; then
      runuser -u postgres -- psql -c "CREATE ROLE ${DBUSER} LOGIN PASSWORD '${DBPASS}';" \
        || err "Utworzenie uzytkownika testowego nie powiodlo sie."
    fi
    if ! db_exists; then
      runuser -u postgres -- createdb -O "${DBUSER}" "${DB}" \
        || err "Utworzenie testowej bazy nie powiodlo sie."
    fi
    echo "OK: testowa baza '${DB}' i uzytkownik '${DBUSER}' utworzeni."
    ;;
  drop)
    if db_exists; then
      runuser -u postgres -- dropdb "${DB}" || err "Usuniecie testowej bazy nie powiodlo sie."
    fi
    if role_exists; then
      runuser -u postgres -- psql -c "DROP ROLE ${DBUSER};" || err "Usuniecie uzytkownika testowego nie powiodlo sie."
    fi
    echo "OK: testowa baza '${DB}' i uzytkownik '${DBUSER}' usunieci."
    ;;
  status)
    db_exists && echo "exists" || echo "missing"
    ;;
  *)
    err "Nieznana akcja: '${ACTION}' (oczekiwano create/drop/status)."
    ;;
esac
