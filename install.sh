#!/usr/bin/env bash
#
# Skrypt instalacyjny Caddy Dashboard

set -euo pipefail

APP_VERSION="1.1.0"
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
    read -rp "$__msg [$__default]: " __input < /dev/tty || __input=""
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
      die "$(t err_dnf_retry_exhausted "$*" "$max_attempts")"
    fi
    log "$(t dnf_retry_attempt "$*" "$attempt" "$max_attempts" "$delay")"
    sleep "$delay"
    attempt=$((attempt + 1))
  done
}

declare -A MSG_PL=(
  [banner]="Caddy Dashboard v%s - instalator"
  [err_no_sudo]="Nie jestes rootem i brak polecenia sudo - zaloguj sie jako root."
  [elevating]="Nie jestes rootem - probuje podniesc uprawnienia przez sudo (moze zapytac o haslo)..."
  [err_run_as_root]="Uruchom jako root albo przez sudo, np.: curl -fsSL <url>/install.sh | sudo bash"
  [err_unsupported_os]="Nieobslugiwany system ('%s') - ten skrypt dziala tylko na AlmaLinux/Rocky Linux 9 lub 10."
  [err_unsupported_ver]="Nieobslugiwana wersja %s %s - wspierane sa tylko wersje glowne 9 i 10."
  [os_ok]="System: %s - OK."
  [selinux_setting]="SELinux jest w trybie '%s' - projekt wymaga 'Disabled'. Ustawiam..."
  [selinux_persist]="        /etc/selinux/config -> SELINUX=disabled (trwale, po restarcie).\n"
  [selinux_temp]="        Na czas tej sesji doraznie: setenforce 0 (Permissive, nie blokuje).\n"
  [selinux_reboot_needed]="        WYMAGANY RESTART serwera po zakonczeniu instalacji - patrz podsumowanie na koncu.\n"
  [masking_sleep]="Blokuje sleep/suspend/hibernate (serwer nie powinien usypiac)..."
  [swap_exists]="SWAP juz istnieje - pomijam tworzenie swapfile."
  [swap_creating]="Brak SWAP - tworze /swapfile (1G)..."
  [swap_enabled]="SWAP wlaczony: %s"
  [sysctl_configuring]="Konfiguruje sysctl (vm.swappiness, vm.vfs_cache_pressure, vm.overcommit_memory)..."
  [system_updating]="Aktualizuje system (dnf update)..."
  [installing_base_pkgs]="Instaluje pakiety podstawowe ..."
  [dnf_retry_attempt]="dnf %s nie powiodlo sie (proba %s/%s) - ponawiam za %ss..."
  [err_dnf_retry_exhausted]="dnf %s nie powiodlo sie po %s probach."
  [node_upgrading]="Node.js w wersji %s - aktualizuje do 24 LTS (NodeSource)..."
  [node_installing]="Node.js nie znaleziony - instaluje (NodeSource, Node.js 24 LTS)..."
  [err_nodesource]="Nie udalo sie dodac repo NodeSource."
  [node_already24]="Node.js juz w wersji 24 - pomijam reinstalacje."
  [err_node_missing]="Node.js nadal niedostepny po probie instalacji."
  [node_version]="Node.js: %s"
  [caddy_installing]="Caddy nie znaleziony - instaluje (COPR @caddy/caddy)..."
  [caddy_fallback]="Ustawiam domyslny fallback Caddyfile (/etc/caddy/Caddyfile)..."
  [err_caddyfile_invalid]="Caddyfile nie przeszedl walidacji."
  [caddy_already]="Caddy juz zainstalowany - pomijam instalacje i nadpisywanie Caddyfile."
  [caddy_version]="Caddy: %s"
  [cdadmin_checking]="Sprawdzam dedykowanego uzytkownika administracyjnego (%s)..."
  [cdadmin_exists]="Uzytkownik systemowy '%s' juz istnieje."
  [cdadmin_setup_prompt]="Skonfigurowac '%s' jako admina panelu (grupy: %s, usluga systemd zamiast root)?"
  [cdadmin_groups_added]="'%s' dodany do grup: %s (haslo bez zmian)."
  [cdadmin_skip_existing]="Pomijam '%s' - logowanie do panelu i usluga systemd zostana skonfigurowane jak dotychczas."
  [cdadmin_create_prompt]="Uzytkownik '%s' nie istnieje - utworzyc go jako admina panelu (bez katalogu domowego, grupy: %s)?"
  [err_cdadmin_create]="Nie udalo sie utworzyc uzytkownika %s."
  [err_cdadmin_password]="Nie udalo sie ustawic hasla dla %s."
  [cdadmin_created]="Utworzono '%s' (grupy: %s, bez katalogu domowego)."
  [cdadmin_password_saved]="Haslo zapisane w /root/.usercd (chmod 600, tylko root)."
  [cdadmin_create_skip]="Pomijam tworzenie '%s'."
  [firewalld_installing]="firewalld nie znaleziony - instaluje..."
  [err_firewalld_missing]="firewall-cmd nadal niedostepny po probie instalacji."
  [firewalld_installed]="firewalld: zainstalowany."
  [repo_updating]="Repo juz jest w %s - aktualizuje (git pull)..."
  [repo_cloning]="Klonuje repo (galaz %s) do %s..."
  [npm_installing]="npm install (production)..."
  [env_exists]=".env juz istnieje - pomijam generowanie (usun plik, zeby wygenerowac od nowa)."
  [env_creating]="Tworze .env..."
  [prompt_auth_user]="Login systemowy, ktory ma miec dostep do panelu (musi byc w grupie wheel)"
  [prompt_panel_host]="Adres, na ktorym ma nasluchiwac panel (LAN)"
  [env_created]=".env utworzony - SESSION_SECRET wygenerowany, AUTH_USERS=%s, HOST=%s."
  [env_check_manually]="     Sprawdz .env recznie przed uruchomieniem (EXPOSURE, ewentualnie ALLOWED_ORIGIN).\n"
  [firewalld_activating]="firewalld zainstalowany ale nieaktywny - wlaczam..."
  [firewall_opening]="Otwieram w firewalld: http, https, ssh, port dashboardu (%s/tcp)..."
  [firewall_ready]="Firewall gotowy: %s"
  [systemd_preparing]="Przygotowuje jednostke systemd (caddy-dashboard.service)..."
  [prompt_svc_user]="Konto systemowe, na ktorym ma dzialac usluga (root upraszcza wymog PAM+shadow, patrz README)"
  [systemd_ready]="caddy-dashboard.service gotowy (User=%s). NIE skopiowany do /etc/systemd/system - patrz ponizej."
  [systemd_exists]="caddy-dashboard.service juz istnieje - pomijam generowanie."
  [chown_install_dir]="Ustawiam wlasciciela %s na %s (samo-aktualizacja z panelu)..."
  [done_installed]="Gotowe. Zainstalowano w: %s"
  [summary_block]="
Nastepne kroki (recznie, swiadomie - skrypt niczego tu sam nie wlacza):

  1. Sprawdz %s/.env (AUTH_USERS, EXPOSURE/HOST, ewentualnie
     ALLOWED_ORIGIN gdy EXPOSURE=world).
  2. Test recznie:
       cd %s && node server/index.js
  3. Autostart jako usluga systemd (gdy jestes gotow/gotowa):
       sudo cp %s/caddy-dashboard.service /etc/systemd/system/
       sudo systemctl daemon-reload
       sudo systemctl enable --now caddy-dashboard

Firewall (http, https, ssh, port dashboardu) juz otwarty automatycznie -
patrz log wyzej."
  [selinux_warning_block]="
[WAZNE] SELinux zostal ustawiony na disabled w /etc/selinux/config, ale
        pelne wylaczenie wymaga RESTARTU serwera (do tego czasu dziala
        dorazne \"setenforce 0\" - Permissive). Zrob teraz:
          sudo reboot"
)

declare -A MSG_EN=(
  [banner]="Caddy Dashboard v%s - installer"
  [err_no_sudo]="You are not root and sudo is not available - log in as root."
  [elevating]="You are not root - trying to elevate privileges via sudo (it may ask for a password)..."
  [err_run_as_root]="Run as root or via sudo, e.g.: curl -fsSL <url>/install.sh | sudo bash"
  [err_unsupported_os]="Unsupported system ('%s') - this script only works on AlmaLinux/Rocky Linux 9 or 10."
  [err_unsupported_ver]="Unsupported version %s %s - only major versions 9 and 10 are supported."
  [os_ok]="System: %s - OK."
  [selinux_setting]="SELinux is in '%s' mode - the project requires 'Disabled'. Setting it..."
  [selinux_persist]="        /etc/selinux/config -> SELINUX=disabled (permanent, after reboot).\n"
  [selinux_temp]="        For this session, temporarily: setenforce 0 (Permissive, non-blocking).\n"
  [selinux_reboot_needed]="        SERVER RESTART REQUIRED after installation finishes - see the summary at the end.\n"
  [masking_sleep]="Blocking sleep/suspend/hibernate (a server should not sleep)..."
  [swap_exists]="SWAP already exists - skipping swapfile creation."
  [swap_creating]="No SWAP found - creating /swapfile (1G)..."
  [swap_enabled]="SWAP enabled: %s"
  [sysctl_configuring]="Configuring sysctl (vm.swappiness, vm.vfs_cache_pressure, vm.overcommit_memory)..."
  [system_updating]="Updating the system (dnf update)..."
  [installing_base_pkgs]="Installing base packages..."
  [dnf_retry_attempt]="dnf %s failed (attempt %s/%s) - retrying in %ss..."
  [err_dnf_retry_exhausted]="dnf %s failed after %s attempts."
  [node_upgrading]="Node.js version %s found - upgrading to 24 LTS (NodeSource)..."
  [node_installing]="Node.js not found - installing (NodeSource, Node.js 24 LTS)..."
  [err_nodesource]="Failed to add the NodeSource repo."
  [node_already24]="Node.js is already version 24 - skipping reinstall."
  [err_node_missing]="Node.js is still unavailable after the install attempt."
  [node_version]="Node.js: %s"
  [caddy_installing]="Caddy not found - installing (COPR @caddy/caddy)..."
  [caddy_fallback]="Setting the default fallback Caddyfile (/etc/caddy/Caddyfile)..."
  [err_caddyfile_invalid]="Caddyfile failed validation."
  [caddy_already]="Caddy is already installed - skipping install and overwriting the Caddyfile."
  [caddy_version]="Caddy: %s"
  [cdadmin_checking]="Checking for the dedicated admin user (%s)..."
  [cdadmin_exists]="System user '%s' already exists."
  [cdadmin_setup_prompt]="Configure '%s' as the panel admin (groups: %s, systemd service instead of root)?"
  [cdadmin_groups_added]="'%s' added to groups: %s (password unchanged)."
  [cdadmin_skip_existing]="Skipping '%s' - panel login and the systemd service will be configured as before."
  [cdadmin_create_prompt]="User '%s' does not exist - create it as the panel admin (no home directory, groups: %s)?"
  [err_cdadmin_create]="Failed to create user %s."
  [err_cdadmin_password]="Failed to set the password for %s."
  [cdadmin_created]="Created '%s' (groups: %s, no home directory)."
  [cdadmin_password_saved]="Password saved to /root/.usercd (chmod 600, root only)."
  [cdadmin_create_skip]="Skipping creation of '%s'."
  [firewalld_installing]="firewalld not found - installing..."
  [err_firewalld_missing]="firewall-cmd is still unavailable after the install attempt."
  [firewalld_installed]="firewalld: installed."
  [repo_updating]="Repo already present in %s - updating (git pull)..."
  [repo_cloning]="Cloning repo (branch %s) into %s..."
  [npm_installing]="npm install (production)..."
  [env_exists]=".env already exists - skipping generation (remove the file to regenerate it)."
  [env_creating]="Creating .env..."
  [prompt_auth_user]="System login that should have access to the panel (must be in the wheel group)"
  [prompt_panel_host]="Address the panel should listen on (LAN)"
  [env_created]=".env created - SESSION_SECRET generated, AUTH_USERS=%s, HOST=%s."
  [env_check_manually]="     Check .env manually before starting (EXPOSURE, and ALLOWED_ORIGIN if needed).\n"
  [firewalld_activating]="firewalld installed but inactive - enabling it..."
  [firewall_opening]="Opening in firewalld: http, https, ssh, dashboard port (%s/tcp)..."
  [firewall_ready]="Firewall ready: %s"
  [systemd_preparing]="Preparing the systemd unit (caddy-dashboard.service)..."
  [prompt_svc_user]="System account the service should run as (root simplifies the PAM+shadow requirement, see README)"
  [systemd_ready]="caddy-dashboard.service ready (User=%s). NOT copied to /etc/systemd/system - see below."
  [systemd_exists]="caddy-dashboard.service already exists - skipping generation."
  [chown_install_dir]="Setting owner of %s to %s (self-update from the panel)..."
  [done_installed]="Done. Installed in: %s"
  [summary_block]="
Next steps (manual, deliberate - the script does not enable anything here on its own):

  1. Check %s/.env (AUTH_USERS, EXPOSURE/HOST, and
     ALLOWED_ORIGIN if EXPOSURE=world).
  2. Manual test:
       cd %s && node server/index.js
  3. Autostart as a systemd service (when you're ready):
       sudo cp %s/caddy-dashboard.service /etc/systemd/system/
       sudo systemctl daemon-reload
       sudo systemctl enable --now caddy-dashboard

Firewall (http, https, ssh, dashboard port) is already open automatically -
see the log above."
  [selinux_warning_block]="
[IMPORTANT] SELinux has been set to disabled in /etc/selinux/config, but
        fully disabling it requires a SERVER RESTART (until then, the
        temporary \"setenforce 0\" - Permissive - is in effect). Do this now:
          sudo reboot"
)

t() {
  local key="$1" template
  shift
  if [ "${LANG_CHOICE:-pl}" = "en" ]; then
    template="${MSG_EN[$key]}"
  else
    template="${MSG_PL[$key]}"
  fi
  # shellcheck disable=SC2059
  printf "$template" "$@"
}

prompt_lang() {
  local __input
  while true; do
    __input="__NOTTY__"
    if [ -t 0 ]; then
      read -rp "Wybierz jezyk instalacji / Choose installation language [pl/en]: " __input || __input="__NOTTY__"
    else
      read -rp "Wybierz jezyk instalacji / Choose installation language [pl/en]: " __input < /dev/tty || __input="__NOTTY__"
    fi
    case "$__input" in
      __NOTTY__) LANG_CHOICE="pl"; return ;;
      pl|PL|Pl) LANG_CHOICE="pl"; return ;;
      en|EN|En) LANG_CHOICE="en"; return ;;
      *) echo "Podaj 'pl' lub 'en'. / Please type 'pl' or 'en'." ;;
    esac
  done
}

if [ -z "${LANG_CHOICE:-}" ]; then
  prompt_lang
fi
export LANG_CHOICE

log "$(t banner "$APP_VERSION")"

YES_DEFAULT="t"
[ "$LANG_CHOICE" = "en" ] && YES_DEFAULT="y"

if [ "$(id -u)" -ne 0 ]; then
  SELF="${BASH_SOURCE[0]:-}"
  if [ -n "$SELF" ] && [ -f "$SELF" ]; then
    command -v sudo >/dev/null 2>&1 || die "$(t err_no_sudo)"
    log "$(t elevating)"
    exec sudo -E bash "$SELF" "$@"
  else
    die "$(t err_run_as_root)"
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
  *) die "$(t err_unsupported_os "${OS_ID:-nieznany}")" ;;
esac
case "$OS_VERSION_MAJOR" in
  9|10) ;;
  *) die "$(t err_unsupported_ver "$OS_ID" "${VERSION_ID:-?}")" ;;
esac
log "$(t os_ok "${PRETTY_NAME:-$OS_ID $OS_VERSION_MAJOR}")"

SELINUX_REBOOT_REQUIRED=""
if command -v getenforce >/dev/null 2>&1; then
  SELINUX_STATE="$(getenforce)"
  if [ "$SELINUX_STATE" != "Disabled" ]; then
    log "$(t selinux_setting "$SELINUX_STATE")"
    if [ -f /etc/selinux/config ]; then
      sed -i 's/^SELINUX=.*/SELINUX=disabled/' /etc/selinux/config
    else
      echo "SELINUX=disabled" >> /etc/selinux/config
    fi
    setenforce 0 2>/dev/null || true
    SELINUX_REBOOT_REQUIRED=1
    t selinux_persist
    t selinux_temp
    t selinux_reboot_needed
  fi
fi

log "$(t masking_sleep)"
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target

if swapon --show | grep -q .; then
  log "$(t swap_exists)"
else
  log "$(t swap_creating)"
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  log "$(t swap_enabled "$(swapon --show | tr '\n' ' ')")"
fi

log "$(t sysctl_configuring)"
for KV in "vm.swappiness=10" "vm.vfs_cache_pressure=50" "vm.overcommit_memory=1"; do
  KEY="${KV%%=*}"
  if grep -q "^${KEY}[[:space:]]*=" /etc/sysctl.conf 2>/dev/null; then
    sed -i "s/^${KEY}[[:space:]]*=.*/${KV}/" /etc/sysctl.conf
  else
    echo "$KV" >> /etc/sysctl.conf
  fi
done
sysctl -p >/dev/null

log "$(t system_updating)"
dnf clean all -y -q
dnf autoremove -y -q
dnf_retry update -y -q
dnf_retry install sudo epel-release -y
dnf_retry update -y

log "$(t installing_base_pkgs)"
dnf_retry install -y nano mc htop wget curl zip unzip gzip bzip2 tar git
dnf_retry install -y net-tools gcc gcc-c++ make pam-devel bash-completion socat which cronie
dnf_retry install -y glibc-langpack-pl bind-utils ca-certificates
dnf_retry update -y

NODE_MAJOR_CURRENT=""
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR_CURRENT="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
fi

if [ "$NODE_MAJOR_CURRENT" != "24" ]; then
  if [ -n "$NODE_MAJOR_CURRENT" ]; then
    log "$(t node_upgrading "$NODE_MAJOR_CURRENT")"
  else
    log "$(t node_installing)"
  fi
  curl -fsSL https://rpm.nodesource.com/setup_24.x | bash - || die "$(t err_nodesource)"
  dnf module reset nodejs -y 2>/dev/null || true
  dnf_retry install -y nodejs
else
  log "$(t node_already24)"
fi
command -v node >/dev/null 2>&1 || die "$(t err_node_missing)"
log "$(t node_version "$(node -v)")"

if ! command -v caddy >/dev/null 2>&1; then
  log "$(t caddy_installing)"
  dnf_retry install 'dnf-command(copr)' -y
  dnf_retry copr enable @caddy/caddy -y
  dnf_retry install -y caddy
  systemctl enable --now caddy

  log "$(t caddy_fallback)"
  cat > /etc/caddy/Caddyfile <<'EOF'
# Default fallback for unconfigured domains
:80, :443 {
    respond "Caddy Dashboard - No site configured for this domain" 404
}
EOF
  caddy validate --config /etc/caddy/Caddyfile || die "$(t err_caddyfile_invalid)"
  systemctl reload caddy
else
  log "$(t caddy_already)"
fi
log "$(t caddy_version "$(caddy version)")"

CD_ADMIN_USER="cdadmin"
CD_ADMIN_READY=0

CD_ADMIN_GROUPS="wheel"

log "$(t cdadmin_checking "$CD_ADMIN_USER")"
if id "$CD_ADMIN_USER" >/dev/null 2>&1; then
  log "$(t cdadmin_exists "$CD_ADMIN_USER")"
  prompt SETUP_CD_ADMIN "$(t cdadmin_setup_prompt "$CD_ADMIN_USER" "$CD_ADMIN_GROUPS")" "$YES_DEFAULT"
  if is_yes "$SETUP_CD_ADMIN"; then
    usermod -aG "$CD_ADMIN_GROUPS" "$CD_ADMIN_USER"
    log "$(t cdadmin_groups_added "$CD_ADMIN_USER" "$CD_ADMIN_GROUPS")"
    CD_ADMIN_READY=1
  else
    log "$(t cdadmin_skip_existing "$CD_ADMIN_USER")"
  fi
else
  prompt CREATE_CD_ADMIN "$(t cdadmin_create_prompt "$CD_ADMIN_USER" "$CD_ADMIN_GROUPS")" "$YES_DEFAULT"
  if is_yes "$CREATE_CD_ADMIN"; then
    useradd --no-create-home --shell /sbin/nologin --groups "$CD_ADMIN_GROUPS" "$CD_ADMIN_USER" \
      || die "$(t err_cdadmin_create "$CD_ADMIN_USER")"
    CD_ADMIN_PASSWORD="$(gen_password)"
    echo "${CD_ADMIN_USER}:${CD_ADMIN_PASSWORD}" | chpasswd || die "$(t err_cdadmin_password "$CD_ADMIN_USER")"
    ( umask 077; printf '%s:%s\n' "$CD_ADMIN_USER" "$CD_ADMIN_PASSWORD" > /root/.usercd )
    log "$(t cdadmin_created "$CD_ADMIN_USER" "$CD_ADMIN_GROUPS")"
    log "$(t cdadmin_password_saved)"
    CD_ADMIN_READY=1
  else
    log "$(t cdadmin_create_skip "$CD_ADMIN_USER")"
  fi
fi

if ! command -v firewall-cmd >/dev/null 2>&1; then
  log "$(t firewalld_installing)"
  dnf_retry install -y firewalld
fi
command -v firewall-cmd >/dev/null 2>&1 || die "$(t err_firewalld_missing)"
log "$(t firewalld_installed)"

if [ -d "$INSTALL_DIR/.git" ]; then
  log "$(t repo_updating "$INSTALL_DIR")"
  git -C "$INSTALL_DIR" pull --ff-only
else
  log "$(t repo_cloning "$BRANCH" "$INSTALL_DIR")"
  git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

git config core.hooksPath .githooks

log "$(t npm_installing)"
npm install --omit=dev

if [ -f .env ]; then
  log "$(t env_exists)"
else
  log "$(t env_creating)"
  cp .env.example .env

  SESSION_SECRET="$(openssl rand -hex 32)"
  sed -i "s#^SESSION_SECRET=.*#SESSION_SECRET=${SESSION_SECRET}#" .env

  if [ "$CD_ADMIN_READY" -eq 1 ]; then
    DEFAULT_USER="$CD_ADMIN_USER"
  else
    DEFAULT_USER="${SUDO_USER:-$(logname 2>/dev/null || echo admin)}"
  fi
  prompt AUTH_USER "$(t prompt_auth_user)" "$DEFAULT_USER"
  sed -i "s#^AUTH_USERS=.*#AUTH_USERS=${AUTH_USER}#" .env

  DEFAULT_HOST="$(hostname -I 2>/dev/null | awk '{print $1}')"
  DEFAULT_HOST="${DEFAULT_HOST:-127.0.0.1}"
  prompt PANEL_HOST "$(t prompt_panel_host)" "$DEFAULT_HOST"
  sed -i "s#^HOST=.*#HOST=${PANEL_HOST}#" .env

  log "$(t env_created "$AUTH_USER" "$PANEL_HOST")"
  t env_check_manually
fi

systemctl is-active --quiet firewalld || { log "$(t firewalld_activating)"; systemctl enable --now firewalld; }

DASH_PORT="$(grep '^PORT=' .env | cut -d= -f2)"
DASH_PORT="${DASH_PORT:-4300}"

log "$(t firewall_opening "$DASH_PORT")"
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --permanent --add-service=ssh
firewall-cmd --permanent --add-port="${DASH_PORT}/tcp"
firewall-cmd --reload
log "$(t firewall_ready "$(firewall-cmd --list-all | tr '\n' ' ' | sed 's/  */ /g')")"

if [ ! -f caddy-dashboard.service ]; then
  log "$(t systemd_preparing)"
  if [ "$CD_ADMIN_READY" -eq 1 ]; then
    DEFAULT_SVC_USER="$CD_ADMIN_USER"
  else
    DEFAULT_SVC_USER="root"
  fi
  prompt SVC_USER "$(t prompt_svc_user)" "$DEFAULT_SVC_USER"
  sed -e "s#^User=.*#User=${SVC_USER}#" \
      caddy-dashboard.service.example > caddy-dashboard.service
  log "$(t systemd_ready "$SVC_USER")"
else
  log "$(t systemd_exists)"
  SVC_USER="$(grep '^User=' caddy-dashboard.service | cut -d= -f2)"
fi

if [ -n "${SVC_USER:-}" ] && [ "$SVC_USER" != "root" ]; then
  log "$(t chown_install_dir "$INSTALL_DIR" "$SVC_USER")"
  chown -R "$SVC_USER":"$SVC_USER" "$INSTALL_DIR"
fi

log "$(t done_installed "$INSTALL_DIR")"
t summary_block "$INSTALL_DIR" "$INSTALL_DIR" "$INSTALL_DIR"
echo

if [ -n "$SELINUX_REBOOT_REQUIRED" ]; then
  t selinux_warning_block
  echo
fi
