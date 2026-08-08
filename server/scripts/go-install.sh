#!/usr/bin/env bash
#
# Instaluje Go (kompilator/narzedzia jezyka - NIE usluga systemd, brak
# demona) dwiema sciezkami:
#   local    - pakiet "golang" z AppStream Alma/Rocky
#   official - najnowsze oficjalne wydanie z go.dev, wypakowane do
#              /usr/local/go, PATH dla nowych sesji logowania dodany przez
#              /etc/profile.d/go.sh (nie dotyczy juz dzialajacego procesu
#              panelu - dlatego panel sam sprawdza tez sciezke absolutna
#              /usr/local/go/bin/go, nie tylko PATH)
#
# Brak tu hasla/uzytkownika do skonfigurowania.

set -uo pipefail

MODE="${1:-}"

err() { echo "BLAD: $*" >&2; exit 1; }

case "$MODE" in
  local)
    dnf install -y golang || err "Instalacja z lokalnego repozytorium nie powiodla sie."
    ;;
  official)
    ARCH="$(uname -m)"
    case "$ARCH" in
      x86_64) GO_ARCH="amd64" ;;
      aarch64) GO_ARCH="arm64" ;;
      *) err "Nieobslugiwana architektura: ${ARCH}." ;;
    esac

    GO_VERSION="$(curl -fsSL 'https://go.dev/VERSION?m=text' | head -1)"
    [ -n "$GO_VERSION" ] || err "Nie udalo sie ustalic najnowszej wersji Go (go.dev/VERSION)."

    TMPFILE="$(mktemp --suffix=.tar.gz)"
    curl -fsSL -o "$TMPFILE" "https://go.dev/dl/${GO_VERSION}.linux-${GO_ARCH}.tar.gz" \
      || err "Pobieranie Go (${GO_VERSION}) nie powiodlo sie."

    rm -rf /usr/local/go
    tar -C /usr/local -xzf "$TMPFILE" || err "Rozpakowanie archiwum Go nie powiodlo sie."
    rm -f "$TMPFILE"

    cat > /etc/profile.d/go.sh <<'PROFEOF'
export PATH=$PATH:/usr/local/go/bin
PROFEOF
    chmod 644 /etc/profile.d/go.sh
    ;;
  *)
    err "Nieznany tryb instalacji: '${MODE}'."
    ;;
esac

GO_BIN="go"
command -v go >/dev/null 2>&1 || GO_BIN="/usr/local/go/bin/go"
"$GO_BIN" version >/dev/null 2>&1 || err "Instalacja zakonczona, ale '${GO_BIN} version' zwrocilo blad."

echo "OK: Go zainstalowany ($("$GO_BIN" version)) (tryb: ${MODE})."
