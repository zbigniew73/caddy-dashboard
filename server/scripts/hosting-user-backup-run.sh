#!/usr/bin/env bash
#
# Uruchamia TERAZ (przycisk "Uruchom teraz" w panelu klienta, /user/ -
# Backup - Zadania) skrypt jednego, juz zapisanego zadania backupu -
# DOKLADNIE ten sam mechanizm, ktory pozniej odpala go crontab usera o
# zaplanowanej porze (patrz hosting-user-backup-job-write.sh) - "uruchom
# teraz" i "uruchomienie zaplanowane" to jeden i ten sam skrypt, bez
# dublowania logiki "jak dziala backup" w dwoch miejscach.
#
# `runuser -u <username> --` odpala go z uprawnieniami TEGO usera (wlasny
# ~/backup, wlasne ~/tmp, wlasne katalogi ~/domains/*/public - user i tak
# ma juz do wszystkiego tego dostep przez SSH, wiec zero nowej granicy
# zaufania). `timeout` to zabezpieczenie przed zawieszonym/bardzo dlugim
# transferem do zdalnego repozytorium (S3/B2/SFTP) - ten sam,
# synchroniczny spawn+wait co reszta akcji w tym panelu (brak
# jakiejkolwiek kolejki zadan w tym projekcie), 15 minut to praktyczny,
# ale arbitralny limit.
#
# Uzycie: hosting-user-backup-run.sh <username> <job-id>

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

USERNAME="${1:-}"
JOB_ID="${2:-}"
[[ "$USERNAME" =~ ^srv_[0-9]+$ ]] || err "Nieprawidlowa nazwa uzytkownika: '${USERNAME}'"
[[ "$JOB_ID" =~ ^[0-9a-fA-F-]{36}$ ]] || err "Nieprawidlowy identyfikator zadania: '${JOB_ID}'"
id -u "$USERNAME" >/dev/null 2>&1 || err "Uzytkownik '${USERNAME}' nie istnieje."

USER_HOME="$(getent passwd "$USERNAME" | cut -d: -f6)"
[ -n "$USER_HOME" ] || err "Nie udalo sie ustalic katalogu domowego dla '${USERNAME}'."

JOB_SCRIPT="${USER_HOME}/backup/.scripts/${JOB_ID}.sh"
[ -f "$JOB_SCRIPT" ] || err "Nie znaleziono skryptu zadania backupu '${JOB_ID}'."

timeout 900 runuser -u "$USERNAME" -- bash "$JOB_SCRIPT"
STATUS=$?
if [ "$STATUS" -eq 0 ]; then
  echo "OK: zadanie backupu ${JOB_ID} zakonczone powodzeniem."
else
  err "zadanie backupu ${JOB_ID} zakonczone bledem (kod ${STATUS})."
fi
