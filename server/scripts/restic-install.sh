#!/usr/bin/env bash
#
# Instaluje restic (samodzielne narzedzie CLI do backupow - NIE usluga
# systemd, brak demona) dwiema sciezkami:
#   local    - pakiet z EPEL (juz wlaczone przez install.sh)
#   official - najnowsze wydanie binarne z GitHub Releases restic/restic,
#              bez posrednictwa menedzera pakietow (oficjalna metoda z
#              dokumentacji restic dla dystrybucji bez pakietu/starszych wersji)
#
# Brak tu hasla/uzytkownika do skonfigurowania - haslo szyfrujace samo
# repozytorium backupow ustawia sie osobno, per-repozytorium, dopiero gdy
# user zdecyduje GDZIE maja isc backupy (lokalny dysk, S3, SFTP...), co nie
# jest czescia samej instalacji narzedzia.

set -uo pipefail

MODE="${1:-}"

err() { echo "BLAD: $*" >&2; exit 1; }

case "$MODE" in
  local)
    dnf install -y restic || err "Instalacja z lokalnego repozytorium (EPEL) nie powiodla sie."
    ;;
  official)
    ARCH="$(uname -m)"
    case "$ARCH" in
      x86_64) RESTIC_ARCH="amd64" ;;
      aarch64) RESTIC_ARCH="arm64" ;;
      *) err "Nieobslugiwana architektura: ${ARCH}." ;;
    esac

    DOWNLOAD_URL="$(curl -fsSL https://api.github.com/repos/restic/restic/releases/latest \
      | grep -o "\"browser_download_url\": *\"[^\"]*linux_${RESTIC_ARCH}\.bz2\"" \
      | head -1 | cut -d'"' -f4)"
    [ -n "$DOWNLOAD_URL" ] || err "Nie udalo sie ustalic adresu najnowszego wydania restic z GitHub API."

    TMPFILE="$(mktemp)"
    curl -fsSL -o "${TMPFILE}.bz2" "$DOWNLOAD_URL" || err "Pobieranie restic nie powiodlo sie."
    bzip2 -d "${TMPFILE}.bz2" || err "Dekompresja pobranego pliku restic nie powiodla sie."
    install -m 755 -o root -g root "$TMPFILE" /usr/local/bin/restic || err "Instalacja binarki restic do /usr/local/bin nie powiodla sie."
    rm -f "$TMPFILE"
    ;;
  *)
    err "Nieznany tryb instalacji: '${MODE}'."
    ;;
esac

command -v restic >/dev/null 2>&1 || err "Instalacja zakonczona, ale komenda 'restic' nie jest dostepna na PATH."
restic version >/dev/null 2>&1 || err "Instalacja zakonczona, ale 'restic version' zwrocilo blad."

echo "OK: restic zainstalowany ($(restic version | head -1)) (tryb: ${MODE})."
