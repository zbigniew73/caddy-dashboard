#!/usr/bin/env bash
#
# Skrypt instalacyjny Caddy Dashboard

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/zbigniew73/caddy-dashboard.git}"
BRANCH="${BRANCH:-main}"
INSTALL_DIR="${INSTALL_DIR:-/opt/caddy-dashboard}"

log() { echo -e "\n==> $*"; }
die() { echo -e "\n[BLAD] $*" >&2; exit 1; }

prompt() {
  local __var="$1" __msg="$2" __default="$3" __input=""
  if [ -t 0 ]; then
    read -rp "$__msg [$__default]: " __input
  else
    read -rp "$__msg [$__default]: " __input 2>/dev/null < /dev/tty || __input=""
  fi
  printf -v "$__var" '%s' "${__input:-$__default}"
}

is_yes() {
  case "$1" in
    t|T|tak|Tak|TAK|y|Y|yes|Yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

gen_password() {
  local upper lower digit special pass
  upper="$(LC_ALL=C tr -dc 'A-Z' < /dev/urandom | head -c4)"
  lower="$(LC_ALL=C tr -dc 'a-z' < /dev/urandom | head -c4)"
  digit="$(LC_ALL=C tr -dc '0-9' < /dev/urandom | head -c2)"
  special="$(LC_ALL=C tr -dc '!@#%*()_+=-' < /dev/urandom | head -c2)"
  pass="$(printf '%s%s%s%s' "$upper" "$lower" "$digit" "$special" | fold -w1 | shuf | tr -d '\n')"
  printf '%s' "$pass"
}

dnf_retry() {
  local attempt=1 max_attempts=3 delay=5
  until dnf "$@"; do
    if [ "$attempt" -ge "$max_attempts" ]; then
      die "dnf $* nie powiodlo sie po ${max_attempts} probach."
    fi
    log "dnf $* nie powiodlo sie (proba ${attempt}/${max_attempts}) - ponawiam za ${delay}s..."
    sleep "$delay"
    attempt=$((attempt + 1))
  done
}

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
    setenforce 0 2>/dev/null || true
    SELINUX_REBOOT_REQUIRED=1
    echo "        /etc/selinux/config -> SELINUX=disabled (trwale, po restarcie)."
    echo "        Na czas tej sesji doraznie: setenforce 0 (Permissive, nie blokuje)."
    echo "        WYMAGANY RESTART serwera po zakonczeniu instalacji - patrz podsumowanie na koncu."
  fi
fi

log "Blokuje sleep/suspend/hibernate (serwer nie powinien usypiac)..."
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target

if swapon --show | grep -q .; then
  log "SWAP juz istnieje - pomijam tworzenie swapfile."
else
  log "Brak SWAP - tworze /swapfile (1G)..."
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  log "SWAP wlaczony: $(swapon --show | tr '\n' ' ')"
fi

log "Konfiguruje sysctl (vm.swappiness, vm.vfs_cache_pressure, vm.overcommit_memory)..."
for KV in "vm.swappiness=10" "vm.vfs_cache_pressure=50" "vm.overcommit_memory=1"; do
  KEY="${KV%%=*}"
  if grep -q "^${KEY}[[:space:]]*=" /etc/sysctl.conf 2>/dev/null; then
    sed -i "s/^${KEY}[[:space:]]*=.*/${KV}/" /etc/sysctl.conf
  else
    echo "$KV" >> /etc/sysctl.conf
  fi
done
sysctl -p >/dev/null

log "Aktualizuje system (dnf update)..."
dnf clean all -y -q
dnf autoremove -y -q
dnf_retry update -y -q
dnf_retry install sudo epel-release -y
dnf_retry update -y

log "Instaluje pakiety podstawowe ..."
dnf_retry install -y nano mc htop wget curl zip unzip gzip bzip2 tar git
dnf_retry install -y net-tools gcc make bash-completion socat which cronie
dnf_retry install -y glibc-langpack-pl bind-utils ca-certificates
dnf_retry update -y

if ! command -v node >/dev/null 2>&1; then
  log "Node.js nie znaleziony - instaluje (NodeSource, Node.js 24 LTS)..."
  curl -fsSL https://rpm.nodesource.com/setup_24.x | bash - || die "Nie udalo sie dodac repo NodeSource."
  dnf_retry install -y nodejs
fi
command -v node >/dev/null 2>&1 || die "Node.js nadal niedostepny po probie instalacji."
log "Node.js: $(node -v)"

if ! command -v caddy >/dev/null 2>&1; then
  log "Caddy nie znaleziony - instaluje (COPR @caddy/caddy)..."
  dnf_retry install 'dnf-command(copr)' -y
  dnf_retry copr enable @caddy/caddy -y
  dnf_retry install -y caddy
  systemctl enable --now caddy

  log "Ustawiam domyslny fallback Caddyfile (/etc/caddy/Caddyfile)..."
  cat > /etc/caddy/Caddyfile <<'EOF'
# Default fallback for unconfigured domains
:80, :443 {
    respond "Caddy Dashboard - No site configured for this domain" 404
}
EOF
  caddy validate --config /etc/caddy/Caddyfile || die "Caddyfile nie przeszedl walidacji."
  systemctl reload caddy
else
  log "Caddy juz zainstalowany - pomijam instalacje i nadpisywanie Caddyfile."
fi
log "Caddy: $(caddy version)"

CD_ADMIN_USER="cdadmin"
CD_ADMIN_READY=0

log "Sprawdzam dedykowanego uzytkownika administracyjnego (${CD_ADMIN_USER})..."
if id "$CD_ADMIN_USER" >/dev/null 2>&1; then
  log "Uzytkownik systemowy '${CD_ADMIN_USER}' juz istnieje."
  prompt SETUP_CD_ADMIN "Skonfigurowac '${CD_ADMIN_USER}' jako admina panelu (grupy wheel+shadow, usluga systemd zamiast root)?" "t"
  if is_yes "$SETUP_CD_ADMIN"; then
    usermod -aG wheel,shadow "$CD_ADMIN_USER"
    log "'${CD_ADMIN_USER}' dodany do grup wheel, shadow (haslo bez zmian)."
    CD_ADMIN_READY=1
  else
    log "Pomijam '${CD_ADMIN_USER}' - logowanie do panelu i usluga systemd zostana skonfigurowane jak dotychczas."
  fi
else
  prompt CREATE_CD_ADMIN "Uzytkownik '${CD_ADMIN_USER}' nie istnieje - utworzyc go jako admina panelu (bez katalogu domowego, wheel+shadow)?" "t"
  if is_yes "$CREATE_CD_ADMIN"; then
    useradd --no-create-home --shell /sbin/nologin --groups wheel,shadow "$CD_ADMIN_USER" \
      || die "Nie udalo sie utworzyc uzytkownika ${CD_ADMIN_USER}."
    CD_ADMIN_PASSWORD="$(gen_password)"
    echo "${CD_ADMIN_USER}:${CD_ADMIN_PASSWORD}" | chpasswd || die "Nie udalo sie ustawic hasla dla ${CD_ADMIN_USER}."
    ( umask 077; printf '%s:%s\n' "$CD_ADMIN_USER" "$CD_ADMIN_PASSWORD" > /root/.usercd )
    log "Utworzono '${CD_ADMIN_USER}' (wheel+shadow, bez katalogu domowego)."
    log "Haslo zapisane w /root/.usercd (chmod 600, tylko root)."
    CD_ADMIN_READY=1
  else
    log "Pomijam tworzenie '${CD_ADMIN_USER}'."
  fi
fi

if ! command -v firewall-cmd >/dev/null 2>&1; then
  log "firewalld nie znaleziony - instaluje..."
  dnf_retry install -y firewalld
fi
command -v firewall-cmd >/dev/null 2>&1 || die "firewall-cmd nadal niedostepny po probie instalacji."
log "firewalld: zainstalowany."

if [ -d "$INSTALL_DIR/.git" ]; then
  log "Repo juz jest w $INSTALL_DIR - aktualizuje (git pull)..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  log "Klonuje repo (galaz $BRANCH) do $INSTALL_DIR..."
  git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

git config core.hooksPath .githooks

log "npm install (production)..."
npm install --omit=dev

if [ -f .env ]; then
  log ".env juz istnieje - pomijam generowanie (usun plik, zeby wygenerowac od nowa)."
else
  log "Tworze .env..."
  cp .env.example .env

  SESSION_SECRET="$(openssl rand -hex 32)"
  sed -i "s#^SESSION_SECRET=.*#SESSION_SECRET=${SESSION_SECRET}#" .env

  if [ "$CD_ADMIN_READY" -eq 1 ]; then
    DEFAULT_USER="$CD_ADMIN_USER"
  else
    DEFAULT_USER="${SUDO_USER:-$(logname 2>/dev/null || echo admin)}"
  fi
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
  if [ "$CD_ADMIN_READY" -eq 1 ]; then
    DEFAULT_SVC_USER="$CD_ADMIN_USER"
  else
    DEFAULT_SVC_USER="root"
  fi
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
