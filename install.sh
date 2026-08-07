#!/usr/bin/env bash
#
# Skrypt instalacyjny Caddy Dashboard - SZKIELET (2026-08-07).
#
# Cel: na czystym VPS (AlmaLinux/Rocky) postawic caddy-dashboard w
# /opt/caddy-dashboard jedna komenda:
#
#   curl -fsSL https://raw.githubusercontent.com/zbigniew73/caddy-dashboard/main/install.sh | sudo bash
#
# albo pobrac i uruchomic recznie:
#
#   sudo bash install.sh
#
# Co robi: klonuje/aktualizuje repo w /opt/caddy-dashboard, instaluje
# Node.js (jesli brak), npm install, tworzy .env (SESSION_SECRET
# generowany automatycznie, AUTH_USERS/HOST pytane interaktywnie),
# przygotowuje jednostke systemd (bez automatycznego enable/start).
#
# CO JESZCZE NIEDOPRACOWANE (szkielet, nie finalna wersja):
# - instalacja Node.js zaklada dnf module (sprawdzone na RHEL9-owym
#   modelu pakietow) - do przetestowania na docelowym Alma/Rocky VPS;
# - nie otwiera portu w firewalld automatycznie (patrz zakladka
#   FIREWALL w panelu - zarzadzanie portami to osobna, niezrobiona
#   jeszcze funkcja);
# - usluga systemd domyslnie proponowana jako User=root (PAM+shadow -
#   patrz README) - dedykowany user o wezszych uprawnieniach to temat
#   do przemyslenia pozniej, nie zalatwiony tutaj.

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/zbigniew73/caddy-dashboard.git}"
BRANCH="${BRANCH:-main}"
INSTALL_DIR="${INSTALL_DIR:-/opt/caddy-dashboard}"

log() { echo -e "\n==> $*"; }
die() { echo -e "\n[BLAD] $*" >&2; exit 1; }

# Prosi o wartosc na terminalu nawet gdy skrypt jest odpalony przez
# `curl | bash` (stdin zajete jest wtedy przez tresc skryptu).
prompt() {
  local __var="$1" __msg="$2" __default="$3" __input=""
  if [ -t 0 ]; then
    read -rp "$__msg [$__default]: " __input
  else
    # np. `curl | bash` - stdin zajete jest przez tresc skryptu, wiec probujemy
    # czytac z terminala bezposrednio; jesli i to niedostepne (brak
    # kontrolujacego terminala), po cichu zostajemy przy wartosci domyslnej
    # zamiast wywalac caly skrypt (dziala pod `set -e`).
    read -rp "$__msg [$__default]: " __input 2>/dev/null < /dev/tty || __input=""
  fi
  printf -v "$__var" '%s' "${__input:-$__default}"
}

[ "$(id -u)" -eq 0 ] || die "Uruchom jako root (sudo)."

if [ ! -f /etc/redhat-release ]; then
  echo "[UWAGA] To nie wyglada na AlmaLinux/Rocky (brak /etc/redhat-release)."
  echo "        Skrypt jest pisany pod te dystrybucje - kontynuuje, ale bez gwarancji."
fi

command -v git >/dev/null 2>&1 || { log "Instaluje git..."; dnf install -y git; }

if ! command -v node >/dev/null 2>&1; then
  log "Node.js nie znaleziony - instaluje (dnf module nodejs:20)..."
  dnf module enable -y nodejs:20 2>/dev/null || true
  dnf install -y nodejs npm || die "Nie udalo sie zainstalowac Node.js automatycznie - zainstaluj recznie i uruchom skrypt ponownie."
fi
command -v node >/dev/null 2>&1 || die "Node.js nadal niedostepny po probie instalacji."
log "Node.js: $(node -v)"

if [ -d "$INSTALL_DIR/.git" ]; then
  log "Repo juz jest w $INSTALL_DIR - aktualizuje (git pull)..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  log "Klonuje repo (galaz $BRANCH) do $INSTALL_DIR..."
  git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

log "npm install (production)..."
npm install --omit=dev

if [ -f .env ]; then
  log ".env juz istnieje - pomijam generowanie (usun plik, zeby wygenerowac od nowa)."
else
  log "Tworze .env..."
  cp .env.example .env

  SESSION_SECRET="$(openssl rand -hex 32)"
  sed -i "s#^SESSION_SECRET=.*#SESSION_SECRET=${SESSION_SECRET}#" .env

  DEFAULT_USER="${SUDO_USER:-$(logname 2>/dev/null || echo admin)}"
  prompt AUTH_USER "Login systemowy, ktory ma miec dostep do panelu (musi byc w grupie wheel)" "$DEFAULT_USER"
  sed -i "s#^AUTH_USERS=.*#AUTH_USERS=${AUTH_USER}#" .env

  DEFAULT_HOST="$(hostname -I 2>/dev/null | awk '{print $1}')"
  DEFAULT_HOST="${DEFAULT_HOST:-127.0.0.1}"
  prompt PANEL_HOST "Adres, na ktorym ma nasluchiwac panel (LAN)" "$DEFAULT_HOST"
  sed -i "s#^HOST=.*#HOST=${PANEL_HOST}#" .env

  log ".env utworzony - SESSION_SECRET wygenerowany, AUTH_USERS=${AUTH_USER}, HOST=${PANEL_HOST}."
  echo "     Sprawdz .env recznie przed uruchomieniem (EXPOSURE, ewentualnie ALLOWED_ORIGIN)."
fi

if [ ! -f caddy-dashboard.service ]; then
  log "Przygotowuje jednostke systemd (caddy-dashboard.service)..."
  DEFAULT_SVC_USER="root"
  prompt SVC_USER "Konto systemowe, na ktorym ma dzialac usluga (root upraszcza wymog PAM+shadow, patrz README)" "$DEFAULT_SVC_USER"
  sed -e "s#^User=.*#User=${SVC_USER}#" \
      caddy-dashboard.service.example > caddy-dashboard.service
  log "caddy-dashboard.service gotowy (User=${SVC_USER}). NIE skopiowany do /etc/systemd/system - patrz ponizej."
else
  log "caddy-dashboard.service juz istnieje - pomijam generowanie."
fi

log "Gotowe. Zainstalowano w: $INSTALL_DIR"
cat <<EOF

Nastepne kroki (recznie, swiadomie - skrypt niczego tu sam nie wlacza):

  1. Sprawdz $INSTALL_DIR/.env (AUTH_USERS, EXPOSURE/HOST, ewentualnie
     ALLOWED_ORIGIN gdy EXPOSURE=world).
  2. Test recznie:
       cd $INSTALL_DIR && node server/index.js
  3. Autostart jako usluga systemd (gdy jestes gotow/gotowa):
       sudo cp $INSTALL_DIR/caddy-dashboard.service /etc/systemd/system/
       sudo systemctl daemon-reload
       sudo systemctl enable --now caddy-dashboard
  4. Jesli EXPOSURE=lan/world i firewalld jest aktywny, otworz port
     panelu recznie (zakladka FIREWALL w panelu na razie tylko
     pokazuje status uslugi, nie zarzadza portami):
       sudo firewall-cmd --add-port=\$(grep '^PORT=' .env | cut -d= -f2)/tcp --permanent
       sudo firewall-cmd --reload

EOF
