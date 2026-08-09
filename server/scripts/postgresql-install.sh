#!/usr/bin/env bash
#
# Instaluje PostgreSQL dwiema sciezkami: "local" (pakiet z domyslnego
# modulu AppStream Alma/Rocky) albo "official" <wersja> (oficjalne repo
# PGDG - postgresql.org, wersja 16 albo 17). Inicjalizuje klaster
# (postgresql-setup initdb), uruchamia usluge, generuje losowe 16-znakowe
# haslo, ustawia je jako haslo uzytkownika postgres w samej bazie (przez
# peer auth lokalnie, dostepne od razu po swiezej instalacji) i dopiero
# PO potwierdzonym sukcesie zapisuje je w /root/.postgresql.

set -uo pipefail

MODE="${1:-}"
VERSION="${2:-}"
PWFILE="/root/.postgresql"

err() { echo "BLAD: $*" >&2; exit 1; }

source "$(dirname "${BASH_SOURCE[0]}")/lib-gen-password.sh"

case "$MODE" in
  local)
    dnf install -y postgresql-server postgresql || err "Instalacja z lokalnego repozytorium nie powiodla sie."
    PG_UNIT="postgresql.service"
    PG_SETUP_BIN="/usr/bin/postgresql-setup"
    PG_SETUP_ARGS=(--initdb)
    ;;
  official)
    [[ "$VERSION" == "16" || "$VERSION" == "17" ]] || err "Nieprawidlowa wersja PostgreSQL: '${VERSION}'."
    OS_MAJOR="$(rpm -E %{rhel})"
    dnf install -y "https://download.postgresql.org/pub/repos/yum/reporpms/EL-${OS_MAJOR}-x86_64/pgdg-redhat-repo-latest.noarch.rpm" \
      || err "Dodanie oficjalnego repozytorium PostgreSQL (PGDG) nie powiodlo sie."
    dnf -qy module disable postgresql >/dev/null 2>&1 || true
    dnf install -y "postgresql${VERSION}-server" "postgresql${VERSION}" \
      || err "Instalacja z oficjalnego repozytorium nie powiodla sie."
    PG_UNIT="postgresql-${VERSION}.service"
    PG_SETUP_BIN="/usr/pgsql-${VERSION}/bin/postgresql-${VERSION}-setup"
    PG_SETUP_ARGS=(initdb)
    ;;
  *)
    err "Nieznany tryb instalacji: '${MODE}'."
    ;;
esac

"$PG_SETUP_BIN" "${PG_SETUP_ARGS[@]}" || err "Inicjalizacja klastra PostgreSQL (initdb) nie powiodla sie."

systemctl enable --now "$PG_UNIT" || err "Zainstalowano, ale nie udalo sie uruchomic/wlaczyc uslugi ${PG_UNIT}."

# Domyslny pg_hba.conf na AlmaLinux/Rocky ma dla polaczen sieciowych
# (host 127.0.0.1/32 i ::1/128) metode "ident" - to NIGDY nie dziala dla
# logowania haslem z zewnetrznego narzedzia (np. Adminer) - potwierdzone
# na zywym serwerze (2026-08-09): "FATAL: Ident authentication failed
# for user...". Przelaczamy te dwie linie na scram-sha-256 (nowoczesna,
# zalecana metoda haslowa PostgreSQL 10+), zostawiamy WSZYSTKO INNE
# (w tym "local all all peer" dla polaczen przez socket) bez zmian.
# Sciezka do pg_hba.conf jest wykrywana dynamicznie (SHOW hba_file) -
# rozna w zaleznosci od trybu instalacji (local: /var/lib/pgsql/data/,
# official: /var/lib/pgsql/${VERSION}/data/), nie zgadywana na sztywno.
HBA_FILE="$(runuser -u postgres -- psql -tAc 'SHOW hba_file;' 2>/dev/null | tr -d '[:space:]')"
if [ -n "$HBA_FILE" ] && [ -f "$HBA_FILE" ]; then
  HBA_BACKUP="${HBA_FILE}.bak-$(date +%Y%m%d%H%M%S)"
  cp -p "$HBA_FILE" "$HBA_BACKUP"
  sed -i -E \
    -e '/^host[[:space:]]+all[[:space:]]+all[[:space:]]+127\.0\.0\.1\/32[[:space:]]+ident/ s/ident$/scram-sha-256/' \
    -e '/^host[[:space:]]+all[[:space:]]+all[[:space:]]+::1\/128[[:space:]]+ident/ s/ident$/scram-sha-256/' \
    "$HBA_FILE"
  if ! systemctl reload "$PG_UNIT" 2>/tmp/postgresql-hba.err; then
    ERR_MSG="$(cat /tmp/postgresql-hba.err 2>/dev/null)"
    rm -f /tmp/postgresql-hba.err
    cp -p "$HBA_BACKUP" "$HBA_FILE"
    systemctl reload "$PG_UNIT" >/dev/null 2>&1 || true
    err "Zmiana pg_hba.conf (ident -> scram-sha-256) nie powiodla sie przy przeladowaniu: ${ERR_MSG} - przywrocono poprzednia wersje."
  fi
  rm -f /tmp/postgresql-hba.err
else
  echo "UWAGA: nie udalo sie ustalic sciezki pg_hba.conf (SHOW hba_file) - polaczenia haslem po TCP (127.0.0.1/::1) moga nie dzialac, sprawdz recznie." >&2
fi

if [ ! -f "$PWFILE" ]; then
  PASSWORD="$(gen_password)"

  runuser -u postgres -- psql -c "ALTER USER postgres WITH PASSWORD '${PASSWORD}';" \
    || err "Wygenerowano haslo, ale nie udalo sie ustawic go dla uzytkownika postgres."

  umask 077
  printf '%s\n' "$PASSWORD" > "$PWFILE"
  chown root:root "$PWFILE"
  chmod 600 "$PWFILE"
fi

echo "OK: PostgreSQL zainstalowany i uruchomiony (${PG_UNIT}). Haslo uzytkownika postgres ustawione w bazie i zapisane w ${PWFILE} (tryb: ${MODE}${VERSION:+ $VERSION})."
