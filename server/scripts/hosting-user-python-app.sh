#!/usr/bin/env bash
#
# Zarzadza WIELOMA, NIEZALEZNYMI aplikacjami Python konta hostingowego
# (self-service z panelu klienta, /user/ - Python). Kazda aplikacja to
# osobny, nazwany slot pod ~/apps/<slug>/ - WLASNY venv
# (~/apps/<slug>/venv) i WLASNY szkielet projektu (~/apps/<slug>/app),
# zeby dwie aplikacje nigdy nie konkurowaly o te same wersje pakietow
# (jeden globalny venv na konto bylby OK dla 1 aplikacji, ale psulby sie
# przy kilku niezaleznych - stad ten podzial). Framework jest wybierany
# RAZ, przy `create`, i juz sie nie zmienia - jak `template` przy
# tworzeniu strony (hostingUserSites.js) - inny framework = inna
# aplikacja (osobny `create`), nie "przeinstaluj w miejscu".
#
# Proces jest nadzorowany jako wlasna usluga systemd
# `cd-pyapp-<username>-<slug>.service` - KONKRETNY (nie template+%i, jak
# przy pojedynczej aplikacji per konto poprzednio) plik jednostki, bo
# username+slug razem nie mieszcza sie w jednym %i - piszemy go w calosci
# na kazdy `start`. Ten sam duch co Redis
# (hosting-user-redis-apply.sh): `User=/Group=` = konto hostingowe (bez
# roota), `Slice=user-<uid>.slice` (ten sam limit RAM co cale konto - zero
# nowego mechanizmu limitu), `loginctl enable-linger`, zeby usluga
# przezyla wylogowanie ostatniej sesji SSH.
#
# create <username> <slug> <pythonPath> <framework>
#   JEDNORAZOWE - blad, jesli ~/apps/<slug> juz istnieje (nie ma "recreate
#   in place"; usun aplikacje i zaloz nowa, jesli potrzeba innej wersji
#   Pythona). Tworzy venv, instaluje framework (+ gunicorn/uvicorn), pisze
#   minimalny szkielet startowy.
# start <username> <slug> <framework> <port>
#   framework/port przychodza z Node (rejestr juz je zna). Pisze/nadpisuje
#   plik jednostki systemd i (re)startuje.
# stop <username> <slug>
#   `systemctl disable --now` (best-effort) - NIE kasuje venv/kodu.
# status <username> <slug>
#   Wypisuje `ACTIVE=<ActiveState>` i do 20 linii `LOG=<linia>` z
#   journalctl (wymaga roota - stad przez sudo, nie bezposrednio z Node).
# delete <username> <slug>
#   Zatrzymuje usluge, kasuje plik jednostki ORAZ CALY ~/apps/<slug>
#   (venv + kod projektu) - nieodwracalne, UI musi to jasno powiedziec
#   przed potwierdzeniem.
#
# Uzycie: hosting-user-python-app.sh <create|start|stop|status|delete> ...

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

ACTION="${1:-}"
USERNAME="${2:-}"
SLUG="${3:-}"

if ! [[ "$USERNAME" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
  err "Nieprawidlowa nazwa uzytkownika: '${USERNAME}'"
fi
if ! id -u "$USERNAME" >/dev/null 2>&1; then
  err "Uzytkownik '${USERNAME}' nie istnieje."
fi
if ! [[ "$SLUG" =~ ^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$ ]]; then
  err "Nieprawidlowa nazwa aplikacji: '${SLUG}'"
fi

USER_HOME="$(getent passwd "$USERNAME" | cut -d: -f6)"
[ -n "$USER_HOME" ] || err "Nie udalo sie ustalic katalogu domowego dla '${USERNAME}'."
UID_NUM="$(id -u "$USERNAME")"

APP_DIR="${USER_HOME}/apps/${SLUG}"
VENV_DIR="${APP_DIR}/venv"
PROJECT_DIR="${APP_DIR}/app"
UNIT_NAME="cd-pyapp-${USERNAME}-${SLUG}.service"
UNIT_FILE="/etc/systemd/system/${UNIT_NAME}"

case "$ACTION" in
  create)
    PYTHON_PATH="${4:-}"
    FRAMEWORK="${5:-}"

    if ! [[ "$PYTHON_PATH" =~ ^/usr/bin/python3\.[0-9]+$ ]]; then
      err "Nieprawidlowa sciezka Pythona: '${PYTHON_PATH}'"
    fi
    [ -x "$PYTHON_PATH" ] || err "Plik '${PYTHON_PATH}' nie istnieje lub nie jest wykonywalny."
    case "$FRAMEWORK" in
      django|flask|fastapi|manual) ;;
      *) err "Nieznany framework: '${FRAMEWORK}' (django|flask|fastapi|manual)" ;;
    esac
    [ -e "$APP_DIR" ] && err "Aplikacja '${SLUG}' juz istnieje."

    # PACKAGES jako tablica (nie string) - "uvicorn[standard]" musi
    # dotrzec do pip jako JEDEN argv, bez otaczajacych cudzyslowow. String
    # ze "wbudowanymi" cudzyslowami + unquoted $PACKAGES (word-splitting)
    # NIE dziala - bash dzieli tylko po bialych znakach, cudzyslowy w
    # srodku stringa zostaja doslownymi znakami i leca do pip, ktory je
    # odrzuca ("Expected package name..."). Tablica + "${PACKAGES[@]}"
    # przekazuje kazdy pakiet jako osobny, nietkniety argv.
    case "$FRAMEWORK" in
      django) PACKAGES=(django gunicorn) ;;
      flask) PACKAGES=(flask gunicorn) ;;
      fastapi) PACKAGES=(fastapi "uvicorn[standard]") ;;
      manual) PACKAGES=() ;;
    esac

    runuser -u "$USERNAME" -- mkdir -p "$APP_DIR" || err "Nie udalo sie utworzyc ${APP_DIR}."

    if ! runuser -u "$USERNAME" -- "$PYTHON_PATH" -m venv "$VENV_DIR"; then
      rm -rf "$APP_DIR"
      err "Utworzenie venv (${PYTHON_PATH}) nie powiodlo sie."
    fi

    if ! runuser -u "$USERNAME" -- "${VENV_DIR}/bin/pip" install --upgrade pip >/dev/null; then
      rm -rf "$APP_DIR"
      err "Aktualizacja pip w venv nie powiodla sie."
    fi
    if [ "${#PACKAGES[@]}" -gt 0 ]; then
      if ! runuser -u "$USERNAME" -- "${VENV_DIR}/bin/pip" install "${PACKAGES[@]}"; then
        rm -rf "$APP_DIR"
        err "Instalacja pakietow (${FRAMEWORK}: ${PACKAGES[*]}) nie powiodla sie."
      fi
    fi

    runuser -u "$USERNAME" -- mkdir -p "$PROJECT_DIR" || { rm -rf "$APP_DIR"; err "Nie udalo sie utworzyc ${PROJECT_DIR}."; }
    case "$FRAMEWORK" in
      django)
        if ! runuser -u "$USERNAME" -- bash -c "cd '${PROJECT_DIR}' && '${VENV_DIR}/bin/django-admin' startproject cdapp ."; then
          rm -rf "$APP_DIR"
          err "Utworzenie szkieletu projektu Django nie powiodlo sie."
        fi
        runuser -u "$USERNAME" -- sed -i "s/^ALLOWED_HOSTS = \[\]/ALLOWED_HOSTS = ['*']/" "${PROJECT_DIR}/cdapp/settings.py" || true
        ;;
      flask)
        TMP_APP="$(mktemp)"
        cat > "$TMP_APP" <<'PYEOF'
from flask import Flask

app = Flask(__name__)


@app.route("/")
def index():
    return "Hello from Flask via Caddy Dashboard!"
PYEOF
        install -m 644 -o "$USERNAME" -g "$USERNAME" "$TMP_APP" "${PROJECT_DIR}/app.py"
        rm -f "$TMP_APP"
        ;;
      fastapi)
        TMP_APP="$(mktemp)"
        cat > "$TMP_APP" <<'PYEOF'
from fastapi import FastAPI

app = FastAPI()


@app.get("/")
async def root():
    return {"message": "Hello from FastAPI via Caddy Dashboard!"}
PYEOF
        install -m 644 -o "$USERNAME" -g "$USERNAME" "$TMP_APP" "${PROJECT_DIR}/main.py"
        rm -f "$TMP_APP"
        ;;
      manual)
        : # pusty PROJECT_DIR - user sam wgrywa kod przez SSH/SFTP
        ;;
    esac

    echo "OK: aplikacja '${SLUG}' (${FRAMEWORK}) dla ${USERNAME} utworzona."
    ;;

  start)
    FRAMEWORK="${4:-}"
    PORT="${5:-}"

    case "$FRAMEWORK" in
      django|flask|fastapi) ;;
      manual) err "Aplikacje typu 'manual' nie sa uruchamiane przez panel - zaloguj sie przez SSH i zrob to samodzielnie." ;;
      *) err "Nieznany framework: '${FRAMEWORK}' (django|flask|fastapi|manual)" ;;
    esac
    if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
      err "Nieprawidlowy port: '${PORT}' (1-65535)"
    fi
    [ -d "$VENV_DIR" ] || err "Aplikacja '${SLUG}' nie istnieje - utworz ja najpierw."

    case "$FRAMEWORK" in
      django)
        ENTRY_FILE="${PROJECT_DIR}/manage.py"
        EXEC_CMD="${VENV_DIR}/bin/gunicorn --chdir ${PROJECT_DIR} --workers 1 --bind 127.0.0.1:${PORT} cdapp.wsgi:application"
        ;;
      flask)
        ENTRY_FILE="${PROJECT_DIR}/app.py"
        EXEC_CMD="${VENV_DIR}/bin/gunicorn --chdir ${PROJECT_DIR} --workers 1 --bind 127.0.0.1:${PORT} app:app"
        ;;
      fastapi)
        ENTRY_FILE="${PROJECT_DIR}/main.py"
        EXEC_CMD="${VENV_DIR}/bin/uvicorn --app-dir ${PROJECT_DIR} --host 127.0.0.1 --port ${PORT} main:app"
        ;;
    esac
    [ -f "$ENTRY_FILE" ] || err "Brak pliku wejsciowego (${ENTRY_FILE}) - uruchom create najpierw."

    TMP_UNIT="$(mktemp)"
    cat > "$TMP_UNIT" <<EOF
[Unit]
Description=Python app ${SLUG} (${USERNAME})
After=network.target

[Service]
Type=simple
ExecStart=${EXEC_CMD}
User=${USERNAME}
Group=${USERNAME}
WorkingDirectory=${PROJECT_DIR}
Slice=user-${UID_NUM}.slice
Restart=on-failure
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
EOF
    install -m 644 -o root -g root "$TMP_UNIT" "$UNIT_FILE"
    rm -f "$TMP_UNIT"

    systemctl daemon-reload
    loginctl enable-linger "$USERNAME" >/dev/null 2>&1 || true
    systemctl restart "$UNIT_NAME" || err "Nie udalo sie uruchomic aplikacji '${SLUG}' - sprawdz journalctl -u ${UNIT_NAME}"
    systemctl enable "$UNIT_NAME" >/dev/null 2>&1 || true

    echo "OK: aplikacja '${SLUG}' (${FRAMEWORK}) uruchomiona na porcie ${PORT}."
    ;;

  stop)
    systemctl disable --now "$UNIT_NAME" 2>&1 || true
    echo "OK: aplikacja '${SLUG}' zatrzymana."
    ;;

  status)
    ACTIVE_STATE="$(systemctl show "$UNIT_NAME" --no-page -p ActiveState 2>/dev/null | sed -n 's/^ActiveState=//p')"
    echo "ACTIVE=${ACTIVE_STATE:-unknown}"
    journalctl -u "$UNIT_NAME" -n 20 --no-pager --output=cat 2>/dev/null | while IFS= read -r line; do
      [ -n "$line" ] && echo "LOG=${line}"
    done
    ;;

  delete)
    systemctl disable --now "$UNIT_NAME" 2>&1 || true
    rm -f "$UNIT_FILE"
    systemctl daemon-reload
    rm -rf "$APP_DIR"
    echo "OK: aplikacja '${SLUG}' usunieta."
    ;;

  *)
    err "Nieznana akcja: '${ACTION}' (create|start|stop|status|delete)"
    ;;
esac
