#!/usr/bin/env bash
#
# Wykrywa dystrybucje i glowna wersje systemu. Caly projekt wspiera
# WYLACZNIE AlmaLinux/Rocky Linux 9 lub 10 - ten skrypt jest jedynym
# miejscem, gdzie to sprawdzamy, zeby inne skrypty (install.sh, przyszle
# instalatory Caddy/MySQL/PHP...) nie musialy powtarzac tej logiki.
#
# Uzycie jako samodzielny skrypt (wypisuje "almalinux 9" na stdout i
# konczy z kodem 0, albo blad na stderr i kod 1):
#
#   ./check-os.sh
#   ./check-os.sh && echo "system wspierany"
#
# Uzycie jako zrodlo zmiennych w innym skrypcie (bez konczenia powloki
# wywolujacej - ustawia OS_ID i OS_VERSION_MAJOR, zwraca 0/1):
#
#   source check-os.sh || { echo "system niewspierany" >&2; exit 1; }
#   echo "$OS_ID $OS_VERSION_MAJOR"

_check_os_detect() {
  OS_ID=""
  OS_VERSION_MAJOR=""

  if [ ! -f /etc/os-release ]; then
    echo "[BLAD] Brak /etc/os-release - nie da sie wykryc dystrybucji." >&2
    return 1
  fi
  . /etc/os-release
  OS_ID="$ID"
  OS_VERSION_MAJOR="${VERSION_ID%%.*}"

  case "$OS_ID" in
    almalinux|rocky) ;;
    *)
      echo "[BLAD] Wykryto '${OS_ID:-nieznany}' - wspierane sa tylko: almalinux, rocky." >&2
      return 1
      ;;
  esac

  case "$OS_VERSION_MAJOR" in
    9|10) ;;
    *)
      echo "[BLAD] Wykryto ${OS_ID} ${VERSION_ID:-?} - wspierane wersje glowne: 9, 10." >&2
      return 1
      ;;
  esac

  return 0
}

# Trik na wykrycie czy plik jest zrodlowany (source) czy uruchomiony
# bezposrednio - w pierwszym przypadku uzywamy `return`, w drugim `exit`,
# zeby source nie zamykal powloki wywolujacej.
(return 0 2>/dev/null) && _CHECK_OS_SOURCED=1 || _CHECK_OS_SOURCED=0

_check_os_detect
_CHECK_OS_STATUS=$?

if [ "$_CHECK_OS_SOURCED" -eq 0 ]; then
  [ "$_CHECK_OS_STATUS" -eq 0 ] && echo "${OS_ID} ${OS_VERSION_MAJOR}"
  exit "$_CHECK_OS_STATUS"
fi

# Sourced: `return` musi byc ostatnia komenda z wlasciwym kodem wprost w
# kazdej galezi - `unset` sam zawsze zwraca 0, wiec nie moze poprzedzac
# `return` bez argumentu (nadpisalby prawdziwy wynik detekcji).
if [ "$_CHECK_OS_STATUS" -eq 0 ]; then
  unset _CHECK_OS_SOURCED _CHECK_OS_STATUS
  return 0
else
  unset _CHECK_OS_SOURCED _CHECK_OS_STATUS
  return 1
fi
