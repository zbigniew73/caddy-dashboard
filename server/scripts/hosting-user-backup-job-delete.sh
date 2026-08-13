#!/usr/bin/env bash
#
# Usuwa skrypt jednego zadania backupu (self-service z panelu klienta,
# /user/ - Backup - Zadania - Usun). Sama sciezka jest budowana TU, z juz
# zwalidowanych argumentow (nigdy nie ufamy pelnej sciezce podanej przez
# wywolujacego) - ten sam wzorzec obrony co np.
# hosting-account-disk-usage.sh. Brak pliku (juz usuniety/nigdy nie
# istnial) to sukces, nie blad - operacja ma byc idempotentna.
#
# Uzycie: hosting-user-backup-job-delete.sh <username> <job-id>

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

USERNAME="${1:-}"
JOB_ID="${2:-}"
[[ "$USERNAME" =~ ^srv_[0-9]+$ ]] || err "Nieprawidlowa nazwa uzytkownika: '${USERNAME}'"
[[ "$JOB_ID" =~ ^[0-9a-fA-F-]{36}$ ]] || err "Nieprawidlowy identyfikator zadania: '${JOB_ID}'"
id -u "$USERNAME" >/dev/null 2>&1 || err "Uzytkownik '${USERNAME}' nie istnieje."

USER_HOME="$(getent passwd "$USERNAME" | cut -d: -f6)"
[ -n "$USER_HOME" ] || err "Nie udalo sie ustalic katalogu domowego dla '${USERNAME}'."

rm -f "${USER_HOME}/backup/.scripts/${JOB_ID}.sh"
echo "OK: skrypt zadania backupu ${JOB_ID} usuniety dla ${USERNAME}."
