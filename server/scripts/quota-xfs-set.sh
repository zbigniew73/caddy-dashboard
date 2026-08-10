#!/usr/bin/env bash
#
# Ustawia limit dyskowy (XFS, project quota per katalog) dla katalogu
# domowego danego uzytkownika/strony. Wymaga JEDNORAZOWEGO wczesniejszego
# setupu na danym filesystemie: prjquota w /etc/fstab + (re)mount - patrz
# karta "Zasoby systemowe" w panelu. W przeciwienstwie do ext4 (gdzie setup
# jest jednorazowy globalnie), XFS project quota wymaga tych krokow PRZY
# KAZDYM nowym katalogu/userze - stad ten skrypt jest wywolywany per-user,
# nie tylko raz.
#
# Idempotentny - kolejne wywolanie dla tego samego usera nadpisuje wpisy w
# /etc/projects i /etc/projid (usuwa stare, dopisuje nowe), nie duplikuje.
#
# Uzycie: quota-xfs-set.sh <username> <homedir> <soft_mb> <hard_mb> <mountpoint>

set -euo pipefail

USERNAME="${1:-}"
HOMEDIR="${2:-}"
SOFT_MB="${3:-}"
HARD_MB="${4:-}"
MOUNTPOINT="${5:-}"

if ! [[ "$USERNAME" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
  echo "BLAD: nieprawidlowa nazwa uzytkownika: '${USERNAME}'" >&2
  exit 1
fi
if [[ "$HOMEDIR" != /* ]] || [ ! -d "$HOMEDIR" ]; then
  echo "BLAD: nieprawidlowy katalog domowy: '${HOMEDIR}'" >&2
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
  echo "BLAD: '${MOUNTPOINT}' nie jest osobnym punktem montowania filesystemu (to zwykly katalog na innym mouncie) - xfs project quota dziala tylko na realnym mouncie. Sprawdz: findmnt '${MOUNTPOINT}'. Jesli to katalog na filesystemie root, ustaw mountpoint na '/'." >&2
  exit 1
fi
# Gdy MOUNTPOINT to "/" (root), KAZDA absolutna sciezka lezy pod nim -
# trzeba to sprawdzic osobno, bo "$MOUNTPOINT"/* dla MOUNTPOINT="/" daje
# wzorzec "//*" (podwojny slash), ktory nie dopasuje zwyklej sciezki typu
# /home/user (bledny false-negative, HOMEDIR juz zwalidowany wyzej jako
# zaczynajacy sie od pojedynczego "/").
if [ "$MOUNTPOINT" != "/" ]; then
  case "$HOMEDIR" in
    "$MOUNTPOINT"/*|"$MOUNTPOINT") ;;
    *) echo "BLAD: katalog domowy '${HOMEDIR}' nie lezy pod punktem montowania '${MOUNTPOINT}'." >&2; exit 1 ;;
  esac
fi

touch /etc/projects /etc/projid

# Wolny numer projektu = najwyzszy istniejacy w /etc/projid + 1 (od 1000
# w gore). Jednowatkowy panel administracyjny - realnie brak rownoleglych
# wywolan, wiec nie zabezpieczamy przed wyscigiem (race condition).
NEXT_ID="$(awk -F: '{print $2}' /etc/projid 2>/dev/null | sort -n | tail -1)"
NEXT_ID=$(( ${NEXT_ID:-999} + 1 ))

awk -F: -v h="$HOMEDIR" '$2 != h' /etc/projects > /etc/projects.tmp
mv /etc/projects.tmp /etc/projects
awk -F: -v u="$USERNAME" '$1 != u' /etc/projid > /etc/projid.tmp
mv /etc/projid.tmp /etc/projid

echo "${NEXT_ID}:${HOMEDIR}" >> /etc/projects
echo "${USERNAME}:${NEXT_ID}" >> /etc/projid

xfs_quota -x -c "project -s ${USERNAME}" "$MOUNTPOINT"
xfs_quota -x -c "limit -p bsoft=${SOFT_MB}m bhard=${HARD_MB}m ${USERNAME}" "$MOUNTPOINT"

echo "OK: xfs project quota dla ${USERNAME} (${HOMEDIR}) ustawiona na ${SOFT_MB}/${HARD_MB} MB na ${MOUNTPOINT}"
