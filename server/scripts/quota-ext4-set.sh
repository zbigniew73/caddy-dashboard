#!/usr/bin/env bash
#
# Ustawia limit dyskowy (ext4, klasyczna quota per-user) dla podanego
# uzytkownika systemowego. Wymaga JEDNORAZOWEGO wczesniejszego setupu na
# danym filesystemie: usrquota,grpquota w /etc/fstab, remount, quotacheck
# -cug, quotaon - patrz karta "Zasoby systemowe" w panelu. Ten skrypt
# TYLKO ustawia limit dla juz istniejacego usera - nie robi setupu
# filesystemu i nie tworzy usera.
#
# Uzycie: quota-ext4-set.sh <username> <soft_mb> <hard_mb> <mountpoint>

set -euo pipefail

USERNAME="${1:-}"
SOFT_MB="${2:-}"
HARD_MB="${3:-}"
MOUNTPOINT="${4:-}"

if ! [[ "$USERNAME" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
  echo "BLAD: nieprawidlowa nazwa uzytkownika: '${USERNAME}'" >&2
  exit 1
fi
if ! id -u "$USERNAME" >/dev/null 2>&1; then
  echo "BLAD: uzytkownik systemowy '${USERNAME}' nie istnieje." >&2
  exit 1
fi
if ! [[ "$SOFT_MB" =~ ^[0-9]+$ ]] || ! [[ "$HARD_MB" =~ ^[0-9]+$ ]]; then
  echo "BLAD: limity musza byc liczbami calkowitymi (MB)." >&2
  exit 1
fi
if [ -z "$MOUNTPOINT" ] || [ ! -d "$MOUNTPOINT" ]; then
  echo "BLAD: nieprawidlowy punkt montowania: '${MOUNTPOINT}'" >&2
  exit 1
fi
if ! mountpoint -q "$MOUNTPOINT"; then
  echo "BLAD: '${MOUNTPOINT}' nie jest osobnym punktem montowania filesystemu (to zwykly katalog na innym mouncie) - quota dziala tylko na realnym mouncie. Sprawdz: findmnt '${MOUNTPOINT}'. Jesli to katalog na filesystemie root, ustaw mountpoint na '/'." >&2
  exit 1
fi

setquota -u "$USERNAME" $((SOFT_MB * 1024)) $((HARD_MB * 1024)) 0 0 "$MOUNTPOINT"
echo "OK: ext4 quota dla ${USERNAME} ustawiona na ${SOFT_MB}/${HARD_MB} MB na ${MOUNTPOINT}"
