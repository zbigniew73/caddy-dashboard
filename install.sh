#!/usr/bin/env bash
#
# Skrypt instalacyjny Caddy Dashboard - SZKIELET (2026-08-07).
#
# Cel: na czystym VPS AlmaLinux/Rocky Linux (9 lub 10 - inne systemy nie sa
# wspierane, skrypt sie zatrzyma) postawic caddy-dashboard w
# /opt/caddy-dashboard jedna komenda:
#
#   curl -fsSL https://raw.githubusercontent.com/zbigniew73/caddy-dashboard/main/install.sh | sudo bash
#
# albo pobrac i uruchomic recznie (jako root, lub jako zwykly user z
# dostepem do sudo - skrypt sam sie wtedy podnosi):
#
#   bash install.sh
#
# Co robi: weryfikuje system (musi byc Alma/Rocky 9 lub 10), wymusza
# SELinux=disabled, aktualizuje system (dnf update), instaluje pakiety
# podstawowe + Node.js, klonuje/aktualizuje repo w /opt/caddy-dashboard,
# npm install, tworzy .env (SESSION_SECRET generowany automatycznie,
# AUTH_USERS/HOST pytane interaktywnie), weryfikuje firewalld i otwiera
# w nim http/https/ssh + port dashboardu, przygotowuje jednostke systemd
# (bez automatycznego enable/start - to zostaje reczne, swiadomie).
#
# ZALOZENIA o czystym VPS (Alma/Rocky) - skrypt ZAKLADA, ze juz sa:
# - SSH i firewalld zainstalowane fabrycznie (skrypt tylko weryfikuje,
#   NIE instaluje firewalld sam - jesli go nie ma, to odstepstwo od
#   zalozen i skrypt sie zatrzymuje zamiast zgadywac).
#
# SELinux MUSI byc disabled (wymog projektu, nie tylko zalecenie) - jesli
# nie jest, skrypt SAM to naprawia: /etc/selinux/config -> SELINUX=disabled
# (trwale) + doraznie `setenforce 0` (Permissive) na czas tej instalacji.
# Pelne "Disabled" wymaga restartu serwera - skrypt o tym jasno informuje
# na koncu, ale sam NIE restartuje (zbyt ryzykowna/przerywajaca operacja
# do robienia bez pytania).
#
# CO JESZCZE NIEDOPRACOWANE (szkielet, nie finalna wersja):
# - instalacja Node.js zaklada dnf module (sprawdzone na RHEL9-owym
#   modelu pakietow) - do przetestowania na docelowym Alma/Rocky VPS;
# - zarzadzanie portami firewalla Z POZIOMU PANELU (zakladka FIREWALL)
#   to osobna, niezrobiona jeszcze funkcja - ten skrypt tylko JEDNORAZOWO
#   otwiera porty przy instalacji, nie ma to nic wspolnego z zakladka;
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

# Root - albo zwykly user z dostepem do sudo (skrypt sam sie podnosi).
# Samopodniesienie dziala tylko gdy skrypt lezy na dysku jako plik
# (np. pobrany i uruchomiony `bash install.sh`) - przy `curl | bash` (bez
# sudo w potoku) nie ma z czego ponownie odczytac tresci skryptu, wiec w
# tym trybie sudo trzeba dodac do samego polecenia w potoku (patrz README).
if [ "$(id -u)" -ne 0 ]; then
  SELF="${BASH_SOURCE[0]:-}"
  if [ -n "$SELF" ] && [ -f "$SELF" ]; then
    command -v sudo >/dev/null 2>&1 || die "Nie jestes rootem i brak polecenia sudo - zaloguj sie jako root."
    log "Nie jestes rootem - probuje podniesc uprawnienia przez sudo (moze zapytac o haslo)..."
    exec sudo -E bash "$SELF" "$@"
  else
    die "Uruchom jako root albo przez sudo, np.: curl -fsSL <url>/install.sh | sudo bash"
  fi
fi

# Twardy wymog - tylko AlmaLinux/Rocky 9 lub 10 (patrz tez check-os.sh w
# tym repo, ta sama logika, do wielokrotnego uzytku przez inne skrypty
# po sklonowaniu - tutaj musi byc wbudowana, bo przy `curl | bash` repo
# jeszcze nie istnieje na dysku).
OS_ID="" ; OS_VERSION_MAJOR=""
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS_ID="$ID"
  OS_VERSION_MAJOR="${VERSION_ID%%.*}"
fi
case "$OS_ID" in
  almalinux|rocky) ;;
  *) die "Nieobslugiwany system ('${OS_ID:-nieznany}') - ten skrypt dziala tylko na AlmaLinux/Rocky Linux 9 lub 10." ;;
esac
case "$OS_VERSION_MAJOR" in
  9|10) ;;
  *) die "Nieobslugiwana wersja ${OS_ID} ${VERSION_ID:-?} - wspierane sa tylko wersje glowne 9 i 10." ;;
esac
log "System: ${PRETTY_NAME:-$OS_ID $OS_VERSION_MAJOR} - OK."

SELINUX_REBOOT_REQUIRED=""
if command -v getenforce >/dev/null 2>&1; then
  SELINUX_STATE="$(getenforce)"
  if [ "$SELINUX_STATE" != "Disabled" ]; then
    log "SELinux jest w trybie '$SELINUX_STATE' - projekt wymaga 'Disabled'. Ustawiam..."
    if [ -f /etc/selinux/config ]; then
      sed -i 's/^SELINUX=.*/SELINUX=disabled/' /etc/selinux/config
    else
      echo "SELINUX=disabled" >> /etc/selinux/config
    fi
    # Pelne "Disabled" (bez zaladowanej polityki w jadrze) wymaga restartu -
    # setenforce dziala tylko doraznie, przelaczajac na Permissive (nie
    # blokuje, tylko loguje), zeby reszta tej instalacji (PAM, logowanie)
    # nie ucierpiala do czasu restartu.
    setenforce 0 2>/dev/null || true
    SELINUX_REBOOT_REQUIRED=1
    echo "        /etc/selinux/config -> SELINUX=disabled (trwale, po restarcie)."
    echo "        Na czas tej sesji doraznie: setenforce 0 (Permissive, nie blokuje)."
    echo "        WYMAGANY RESTART serwera po zakonczeniu instalacji - patrz podsumowanie na koncu."
  fi
fi

log "Aktualizuje system (dnf update)..."
dnf update -y

log "Instaluje pakiety podstawowe (git, curl, wget, tar, gzip)..."
dnf install -y git curl wget tar gzip

if ! command -v node >/dev/null 2>&1; then
  log "Node.js nie znaleziony - instaluje (dnf module nodejs:20)..."
  dnf module enable -y nodejs:20 2>/dev/null || true
  dnf install -y nodejs npm || die "Nie udalo sie zainstalowac Node.js automatycznie - zainstaluj recznie i uruchom skrypt ponownie."
fi
command -v node >/dev/null 2>&1 || die "Node.js nadal niedostepny po probie instalacji."
log "Node.js: $(node -v)"

# Firewalld ma juz byc zainstalowany fabrycznie na czystym Alma/Rocky VPS -
# TYLKO weryfikujemy (analogicznie do rejestru uslug w samym panelu dla
# ssh/cron), nie instalujemy go tutaj.
FIREWALLD_LOAD_STATE="$(systemctl show firewalld.service --no-page -p LoadState 2>/dev/null | cut -d= -f2)"
if [ "$FIREWALLD_LOAD_STATE" != "loaded" ] || ! command -v firewall-cmd >/dev/null 2>&1; then
  die "firewalld nie jest zainstalowany (LoadState=${FIREWALLD_LOAD_STATE:-brak}), a zakladalismy ze jest fabrycznie. Zainstaluj firewalld recznie (dnf install -y firewalld) i uruchom skrypt ponownie."
fi
log "firewalld: zainstalowany (jednostka ${FIREWALLD_LOAD_STATE})."

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

systemctl is-active --quiet firewalld || { log "firewalld zainstalowany ale nieaktywny - wlaczam..."; systemctl enable --now firewalld; }

DASH_PORT="$(grep '^PORT=' .env | cut -d= -f2)"
DASH_PORT="${DASH_PORT:-4300}"

log "Otwieram w firewalld: http, https, ssh, port dashboardu (${DASH_PORT}/tcp)..."
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --permanent --add-service=ssh
firewall-cmd --permanent --add-port="${DASH_PORT}/tcp"
firewall-cmd --reload
log "Firewall gotowy: $(firewall-cmd --list-all | tr '\n' ' ' | sed 's/  */ /g')"

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

Firewall (http, https, ssh, port dashboardu) juz otwarty automatycznie -
patrz log wyzej.
EOF

if [ -n "$SELINUX_REBOOT_REQUIRED" ]; then
  cat <<'EOF'

[WAZNE] SELinux zostal ustawiony na disabled w /etc/selinux/config, ale
        pelne wylaczenie wymaga RESTARTU serwera (do tego czasu dziala
        dorazne "setenforce 0" - Permissive). Zrob teraz:
          sudo reboot
EOF
fi
