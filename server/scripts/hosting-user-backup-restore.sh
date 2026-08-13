#!/usr/bin/env bash
#
# Przywraca WYBRANY snapshot restic do katalogu STAGINGOWEGO pod
# ~/backup/restore/ (self-service z panelu klienta, /user/ - Backup -
# Snapshoty i przywracanie - przycisk "Przywroc"). CELOWO NIE nadpisuje
# na miejscu ~/domains/<domena>/public - przywracanie "w miejscu" mogloby
# bezpowrotnie skasowac aktualne pliki strony przez pomylke, wiec v1
# zawsze laduje przywrocone pliki do NOWEGO, oddzielnego katalogu, ktory
# user sam przejrzy i skopiuje co potrzebuje przez SSH/SFTP.
#
# Uzycie: hosting-user-backup-restore.sh <username> <snapshot-id>

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

USERNAME="${1:-}"
SNAPSHOT_ID="${2:-}"
[[ "$USERNAME" =~ ^srv_[0-9]+$ ]] || err "Nieprawidlowa nazwa uzytkownika: '${USERNAME}'"
[[ "$SNAPSHOT_ID" =~ ^([0-9a-f]{8,64}|latest)$ ]] || err "Nieprawidlowy identyfikator snapshotu: '${SNAPSHOT_ID}'"
id -u "$USERNAME" >/dev/null 2>&1 || err "Uzytkownik '${USERNAME}' nie istnieje."

USER_HOME="$(getent passwd "$USERNAME" | cut -d: -f6)"
[ -n "$USER_HOME" ] || err "Nie udalo sie ustalic katalogu domowego dla '${USERNAME}'."

ENV_FILE="${USER_HOME}/backup/.scripts/.env"
[ -f "$ENV_FILE" ] || err "Repozytorium backupu nie jest jeszcze skonfigurowane (brak ${ENV_FILE})."

STAGING_DIR="${USER_HOME}/backup/restore/${SNAPSHOT_ID}-$(date +%s)"

ERR_LOG="$(mktemp)"
if runuser -u "$USERNAME" -- bash -c '
  set -a
  # shellcheck disable=SC1091
  source "$1"
  set +a
  mkdir -p "$2"
  RESTIC_OPTS=()
  if [ -n "${RESTIC_SFTP_COMMAND:-}" ]; then
    RESTIC_OPTS=(-o "sftp.command=${RESTIC_SFTP_COMMAND}")
  fi
  restic "${RESTIC_OPTS[@]}" restore "$3" --target "$2"
' -- "$ENV_FILE" "$STAGING_DIR" "$SNAPSHOT_ID" >"$ERR_LOG" 2>&1; then
  cat "$ERR_LOG"
  rm -f "$ERR_LOG"
  echo "OK: snapshot ${SNAPSHOT_ID} przywrocony do ${STAGING_DIR}"
else
  MSG="$(cat "$ERR_LOG")"
  rm -f "$ERR_LOG"
  err "restic restore nie powiodlo sie: ${MSG}"
fi
