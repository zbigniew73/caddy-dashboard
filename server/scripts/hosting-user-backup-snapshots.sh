#!/usr/bin/env bash
#
# Wypisuje na stdout liste snapshotow restic (JSON, `restic snapshots
# --json`) repozytorium konta hostingowego (self-service z panelu
# klienta, /user/ - Backup - Snapshoty i przywracanie). Node
# (server/services/hostingUserBackup.js) parsuje/przeksztalca ten JSON do
# ksztaltu pod UI - ten skrypt tylko dostarcza surowe dane.
#
# Uzycie: hosting-user-backup-snapshots.sh <username>

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

USERNAME="${1:-}"
[[ "$USERNAME" =~ ^srv_[0-9]+$ ]] || err "Nieprawidlowa nazwa uzytkownika: '${USERNAME}'"
id -u "$USERNAME" >/dev/null 2>&1 || err "Uzytkownik '${USERNAME}' nie istnieje."

USER_HOME="$(getent passwd "$USERNAME" | cut -d: -f6)"
[ -n "$USER_HOME" ] || err "Nie udalo sie ustalic katalogu domowego dla '${USERNAME}'."

ENV_FILE="${USER_HOME}/backup/.scripts/.env"
[ -f "$ENV_FILE" ] || err "Repozytorium backupu nie jest jeszcze skonfigurowane (brak ${ENV_FILE})."

runuser -u "$USERNAME" -- bash -c '
  set -a
  # shellcheck disable=SC1091
  source "$1"
  set +a
  RESTIC_OPTS=()
  if [ -n "${RESTIC_SFTP_COMMAND:-}" ]; then
    RESTIC_OPTS=(-o "sftp.command=${RESTIC_SFTP_COMMAND}")
  fi
  restic "${RESTIC_OPTS[@]}" snapshots --json
' -- "$ENV_FILE"
