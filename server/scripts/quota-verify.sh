#!/usr/bin/env bash
#
# Weryfikuje, czy globalny mechanizm limitu dysku (ext4 quota / XFS project
# quota) na WSKAZANYM punkcie montowania FAKTYCZNIE dziala (accounting +
# enforcement wlaczone) - nic nie modyfikuje, tylko odczytuje biezacy stan.
# Panel wywoluje ten skrypt przy kazdym "Zastosuj" w karcie "Zasoby
# systemowe" (Mechanizm limitu dysku) i dopiero pozytywny wynik odblokowuje
# tworzenie kont hostingowych z egzekwowanym limitem - patrz
# hostingAccounts.js createAccount / setDiskQuotaVerified w
# hostingPackages.js.
#
# Uzycie: quota-verify.sh <ext4|xfs> <mountpoint>

set -euo pipefail

FSTYPE="${1:-}"
MOUNTPOINT="${2:-}"

if [ -z "$MOUNTPOINT" ] || [ ! -d "$MOUNTPOINT" ]; then
  echo "BLAD: nieprawidlowy punkt montowania: '${MOUNTPOINT}'" >&2
  exit 1
fi
if ! mountpoint -q "$MOUNTPOINT"; then
  echo "BLAD: '${MOUNTPOINT}' nie jest osobnym punktem montowania filesystemu (sprawdz: findmnt '${MOUNTPOINT}')." >&2
  exit 1
fi

REAL_FSTYPE="$(findmnt -no FSTYPE "$MOUNTPOINT")"
OPTIONS="$(findmnt -no OPTIONS "$MOUNTPOINT")"

case "$FSTYPE" in
  xfs)
    if [ "$REAL_FSTYPE" != "xfs" ]; then
      echo "BLAD: '${MOUNTPOINT}' to filesystem '${REAL_FSTYPE}', nie xfs." >&2
      exit 1
    fi
    if ! echo ",${OPTIONS}," | grep -Eq ',(prjquota|pquota),'; then
      echo "BLAD: brak prjquota/pquota w opcjach mountu '${MOUNTPOINT}' (aktualne: ${OPTIONS}). Zobacz instrukcje w karcie 'Zasoby systemowe'." >&2
      exit 1
    fi
    STATE="$(LC_ALL=C xfs_quota -x -c 'state -p' "$MOUNTPOINT" 2>&1)" || {
      echo "BLAD: xfs_quota -x -c 'state -p' na '${MOUNTPOINT}' zwrocilo blad: ${STATE}" >&2
      exit 1
    }
    if ! echo "$STATE" | grep -q 'Accounting: ON'; then
      echo "BLAD: XFS project quota accounting jest WYLACZONE na '${MOUNTPOINT}'." >&2
      exit 1
    fi
    if ! echo "$STATE" | grep -q 'Enforcement: ON'; then
      echo "BLAD: XFS project quota enforcement jest WYLACZONE na '${MOUNTPOINT}'." >&2
      exit 1
    fi
    echo "OK: XFS project quota dziala prawidlowo na '${MOUNTPOINT}' (mount options: ${OPTIONS}; accounting+enforcement ON)."
    ;;
  ext4)
    if [ "$REAL_FSTYPE" != "ext4" ]; then
      echo "BLAD: '${MOUNTPOINT}' to filesystem '${REAL_FSTYPE}', nie ext4." >&2
      exit 1
    fi
    if ! echo ",${OPTIONS}," | grep -q ',usrquota,'; then
      echo "BLAD: brak usrquota w opcjach mountu '${MOUNTPOINT}' (aktualne: ${OPTIONS}). Zobacz instrukcje w karcie 'Zasoby systemowe'." >&2
      exit 1
    fi
    QUOTAON="$(LC_ALL=C quotaon -p -u "$MOUNTPOINT" 2>&1 || true)"
    if ! echo "$QUOTAON" | grep -qi 'is on'; then
      echo "BLAD: user quota nie jest wlaczona (quotaon) na '${MOUNTPOINT}': ${QUOTAON}" >&2
      exit 1
    fi
    echo "OK: ext4 user quota dziala prawidlowo na '${MOUNTPOINT}' (mount options: ${OPTIONS}; quotaon: ON)."
    ;;
  *)
    echo "BLAD: nieznany typ filesystemu do weryfikacji: '${FSTYPE}'" >&2
    exit 1
    ;;
esac
