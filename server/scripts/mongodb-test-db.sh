#!/usr/bin/env bash
#
# Tworzy/usuwa jedna, stala testowa baze MongoDB - nazwa bazy, uzytkownik
# i haslo sa CELOWO zaszyte na sztywno (user sam podal te dokladne dane,
# to wygodna, jednorazowa baza do szybkich prob, nie produkcyjna).
#
# W przeciwienstwie do MariaDB/PostgreSQL, MongoDB od instalacji ma
# WLACZONA autoryzacje (patrz mongodb-install.sh) - laczymy sie jako
# admin, haslo czytamy z /root/.adminmongodb (ten sam plik co
# mongodb-install.sh zapisuje).
#
# MongoDB nie ma "CREATE DATABASE" - baza powstaje niejawnie przy
# pierwszym zapisie, stad tworzymy pusta kolekcje startowa "_init" zeby
# baza faktycznie istniala (byla widoczna w `show dbs`) zaraz po create,
# a nie dopiero po pierwszym uzyciu przez admina.
#
# Uzytkownicy per-baza w MongoDB sa przechowywani w admin.system.users,
# niezaleznie od tego czy sama baza danych (kolekcje) istnieje - stad
# create() najpierw probuje (best-effort) usunac ewentualnego
# istniejacego uzytkownika testowego, zeby dzialanie bylo w pelni
# idempotentne niezaleznie od tego w jakim stanie zostawilo poprzednie
# create/drop.

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

ACTION="${1:-}"
DB="baza123"
DBUSER="baza123"
DBPASS="pass!123"
PWFILE="/root/.adminmongodb"

[ -f "$PWFILE" ] || err "Brak pliku ${PWFILE} - haslo administratora MongoDB nieznane (baza nie zostala zainstalowana przez ten panel?)."
ADMIN_PASS="$(cat "$PWFILE")"

run_mongosh() {
  mongosh --quiet -u admin -p "$ADMIN_PASS" --authenticationDatabase admin --eval "$1"
}

case "$ACTION" in
  create)
    run_mongosh "db.getSiblingDB('${DB}').dropUser('${DBUSER}')" >/dev/null 2>&1 || true
    run_mongosh "db.getSiblingDB('${DB}').createUser({user:'${DBUSER}',pwd:'${DBPASS}',roles:[{role:'readWrite',db:'${DB}'}]})" \
      || err "Utworzenie uzytkownika testowego nie powiodlo sie."
    run_mongosh "db.getSiblingDB('${DB}').createCollection('_init')" >/dev/null 2>&1 || true
    echo "OK: testowa baza '${DB}' i uzytkownik '${DBUSER}' utworzeni."
    ;;
  drop)
    run_mongosh "db.getSiblingDB('${DB}').dropDatabase()" \
      || err "Usuniecie testowej bazy nie powiodlo sie."
    run_mongosh "db.getSiblingDB('${DB}').dropUser('${DBUSER}')" >/dev/null 2>&1 || true
    echo "OK: testowa baza '${DB}' i uzytkownik '${DBUSER}' usunieci."
    ;;
  status)
    FOUND="$(run_mongosh "console.log(db.adminCommand({listDatabases:1}).databases.some(d=>d.name==='${DB}'))" 2>/dev/null | tr -d '[:space:]')"
    [ "$FOUND" = "true" ] && echo "exists" || echo "missing"
    ;;
  *)
    err "Nieznana akcja: '${ACTION}' (oczekiwano create/drop/status)."
    ;;
esac
