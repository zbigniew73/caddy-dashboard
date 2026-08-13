#!/usr/bin/env bash
#
# Zapisuje/naprawia plik ~/backup/.scripts/.env konta hostingowego (self-
# service z panelu klienta, /user/ - Backup - Ustawienia) i inicjalizuje
# (lub, jesli juz istnieje, po prostu potwierdza) repozytorium restic
# opisane w tym pliku. Tresc .env (RESTIC_REPOSITORY, RESTIC_PASSWORD,
# oraz - zaleznie od typu repozytorium wybranego w panelu - AWS_*/B2_*)
# jest budowana i walidowana WCZESNIEJ w Node
# (server/services/hostingUserBackup.js) - ten skrypt tylko wykonuje
# uprzywilejowany zapis (plik ma trafic do katalogu usera z poprawnym
# wlascicielem) i samo `restic init` jako TEN user (nie jako root - to
# JEGO repozytorium, jego wlasne dane, ten sam trust boundary co reszta
# ~/backup, ktore od zawsze jest 0700 wylacznie jego).
#
# ~/backup/.scripts/ jest wspolny dla WSZYSTKICH zadan backupu tego konta
# (kazde zadanie ma tam wlasny skrypt <job-id>.sh, patrz
# hosting-user-backup-job-write.sh) - .env jest zrodlem prawdy o
# repozytorium, kazdy skrypt zadania i kazde inne wywolanie (snapshoty,
# restore) go source'uje zamiast dublowac dane repo w kazdym miejscu.
#
# Dla repozytorium LOCAL (RESTIC_REPOSITORY zaczyna sie od "/") katalog
# docelowy jest tworzony (jako ten sam user) PRZED `restic init` - dla
# repozytoriow zdalnych (s3:/b2:/sftp:) nic lokalnie nie trzeba tworzyc.
#
# SFTP jest szczegolnym przypadkiem: backend restic "sftp" laczy sie
# przez lokalna komende `ssh ... -s sftp` (`-o sftp.command=...`, budowane
# w Node), NIE przez haslo - jesli .env zawiera RESTIC_SFTP_PRIVATE_KEY
# (wklejony przez usera klucz prywatny), materializujemy go TU jako
# prawdziwy plik ~/.ssh/id_backup_restic (0600, wlasciciel usera) - klucz
# w .env to tylko tresc do zapisania, SSH i tak wymaga prawdziwego pliku.
#

# `restic init` na repo ktore juz istnieje konczy sie bledem
# ("already initialized") - to NIE jest realny blad z punktu widzenia
# tego skryptu (user mogl kliknac "Zapisz" ponownie bez zmiany typu/
# lokalizacji, np. zeby zmienic tylko haslo do wyswietlenia w UI), wiec
# tolerujemy ten konkretny komunikat.
#
# Uzycie: hosting-user-backup-repo-init.sh <username>   (tresc .env na stdin)

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

USERNAME="${1:-}"
[[ "$USERNAME" =~ ^srv_[0-9]+$ ]] || err "Nieprawidlowa nazwa uzytkownika: '${USERNAME}'"
id -u "$USERNAME" >/dev/null 2>&1 || err "Uzytkownik '${USERNAME}' nie istnieje."

USER_HOME="$(getent passwd "$USERNAME" | cut -d: -f6)"
[ -n "$USER_HOME" ] || err "Nie udalo sie ustalic katalogu domowego dla '${USERNAME}'."

ENV_CONTENT="$(cat -)"
[ -n "$ENV_CONTENT" ] || err "Pusta tresc .env."

SCRIPTS_DIR="${USER_HOME}/backup/.scripts"
mkdir -p "$SCRIPTS_DIR"
chown "${USERNAME}:${USERNAME}" "$SCRIPTS_DIR"
chmod 0700 "$SCRIPTS_DIR"

TMP_ENV="$(mktemp)"
printf '%s\n' "$ENV_CONTENT" > "$TMP_ENV"
install -m 600 -o "$USERNAME" -g "$USERNAME" "$TMP_ENV" "${SCRIPTS_DIR}/.env"
rm -f "$TMP_ENV"

ERR_LOG="$(mktemp)"
if runuser -u "$USERNAME" -- bash -c '
  set -a
  # shellcheck disable=SC1091
  source "$1"
  set +a
  case "$RESTIC_REPOSITORY" in
    /*) mkdir -p "$RESTIC_REPOSITORY" ;;
  esac
  if [ -n "${RESTIC_SFTP_PRIVATE_KEY:-}" ]; then
    mkdir -p "$HOME/.ssh"
    chmod 700 "$HOME/.ssh"
    printf "%s\n" "$RESTIC_SFTP_PRIVATE_KEY" > "$HOME/.ssh/id_backup_restic"
    chmod 600 "$HOME/.ssh/id_backup_restic"
  fi
  RESTIC_OPTS=()
  if [ -n "${RESTIC_SFTP_COMMAND:-}" ]; then
    RESTIC_OPTS=(-o "sftp.command=${RESTIC_SFTP_COMMAND}")
  fi
  restic "${RESTIC_OPTS[@]}" init
' -- "${SCRIPTS_DIR}/.env" >"$ERR_LOG" 2>&1; then
  cat "$ERR_LOG"
  rm -f "$ERR_LOG"
  echo "OK: repozytorium restic zainicjalizowane dla ${USERNAME}."
else
  if grep -qi "already initialized\|already exists" "$ERR_LOG"; then
    rm -f "$ERR_LOG"
    echo "OK: repozytorium restic dla ${USERNAME} jest juz zainicjalizowane."
  else
    MSG="$(cat "$ERR_LOG")"
    rm -f "$ERR_LOG"
    err "restic init nie powiodlo sie: ${MSG}"
  fi
fi
