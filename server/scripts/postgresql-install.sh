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

if [ ! -f "$PWFILE" ]; then
  PASSWORD="$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c16)"

  runuser -u postgres -- psql -c "ALTER USER postgres WITH PASSWORD '${PASSWORD}';" \
    || err "Wygenerowano haslo, ale nie udalo sie ustawic go dla uzytkownika postgres."

  umask 077
  printf '%s\n' "$PASSWORD" > "$PWFILE"
  chown root:root "$PWFILE"
  chmod 600 "$PWFILE"
fi

echo "OK: PostgreSQL zainstalowany i uruchomiony (${PG_UNIT}). Haslo uzytkownika postgres ustawione w bazie i zapisane w ${PWFILE} (tryb: ${MODE}${VERSION:+ $VERSION})."
