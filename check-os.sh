#!/usr/bin/env bash
#
# Wykrywanie systemu operacyjnego (AlmaLinux/Rocky Linux)

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

(return 0 2>/dev/null) && _CHECK_OS_SOURCED=1 || _CHECK_OS_SOURCED=0

_check_os_detect
_CHECK_OS_STATUS=$?

if [ "$_CHECK_OS_SOURCED" -eq 0 ]; then
  [ "$_CHECK_OS_STATUS" -eq 0 ] && echo "${OS_ID} ${OS_VERSION_MAJOR}"
  exit "$_CHECK_OS_STATUS"
fi

if [ "$_CHECK_OS_STATUS" -eq 0 ]; then
  unset _CHECK_OS_SOURCED _CHECK_OS_STATUS
  return 0
else
  unset _CHECK_OS_SOURCED _CHECK_OS_STATUS
  return 1
fi
