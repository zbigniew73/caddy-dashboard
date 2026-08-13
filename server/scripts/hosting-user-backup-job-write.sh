#!/usr/bin/env bash
#
# Zapisuje (tworzy lub nadpisuje - operacja idempotentna, ten sam wzorzec
# co hosting-user-site.sh apply) tresc skryptu jednego zadania backupu
# konta hostingowego pod ~/backup/.scripts/<job-id>.sh (self-service z
# panelu klienta, /user/ - Backup - Zadania). Tresc skryptu (dump
# wybranych baz + `restic backup` wybranych katalogow public/ + `restic
# forget`) jest budowana WCZESNIEJ w Node
# (server/services/hostingUserBackup.js, buildJobScript()) - ten skrypt
# tylko wykonuje uprzywilejowany zapis do katalogu usera.
#
# 0700, wlasciciel = ten sam user, ktory pozniej faktycznie go uruchamia
# (przez wlasny crontab - patrz hosting-user-crontab-set.sh - albo
# recznie przez "Uruchom teraz" - patrz hosting-user-backup-run.sh) - w
# tresci skryptu sa haslo(a) do baz danych, ktore ten user i tak juz zna
# (widzi je w zakladce Bazy), wiec to nie jest nowa granica zaufania.
#
# Uzycie: hosting-user-backup-job-write.sh <username> <job-id>   (tresc skryptu na stdin)

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

USERNAME="${1:-}"
JOB_ID="${2:-}"
[[ "$USERNAME" =~ ^srv_[0-9]+$ ]] || err "Nieprawidlowa nazwa uzytkownika: '${USERNAME}'"
[[ "$JOB_ID" =~ ^[0-9a-fA-F-]{36}$ ]] || err "Nieprawidlowy identyfikator zadania: '${JOB_ID}'"
id -u "$USERNAME" >/dev/null 2>&1 || err "Uzytkownik '${USERNAME}' nie istnieje."

USER_HOME="$(getent passwd "$USERNAME" | cut -d: -f6)"
[ -n "$USER_HOME" ] || err "Nie udalo sie ustalic katalogu domowego dla '${USERNAME}'."

SCRIPT_CONTENT="$(cat -)"
[ -n "$SCRIPT_CONTENT" ] || err "Pusta tresc skryptu."

SCRIPTS_DIR="${USER_HOME}/backup/.scripts"
mkdir -p "$SCRIPTS_DIR"
chown "${USERNAME}:${USERNAME}" "$SCRIPTS_DIR"
chmod 0700 "$SCRIPTS_DIR"

TMP_JOB="$(mktemp)"
printf '%s\n' "$SCRIPT_CONTENT" > "$TMP_JOB"
install -m 700 -o "$USERNAME" -g "$USERNAME" "$TMP_JOB" "${SCRIPTS_DIR}/${JOB_ID}.sh"
rm -f "$TMP_JOB"

echo "OK: skrypt zadania backupu ${JOB_ID} zapisany dla ${USERNAME}."
