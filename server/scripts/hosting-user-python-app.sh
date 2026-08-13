#!/usr/bin/env bash
#
# Uruchamia/zatrzymuje PRYWATNA aplikacje Python konta hostingowego jako
# nadzorowany proces w tle (self-service z panelu klienta, /user/ -
# Python -> Aplikacja). Jeden user = jedna aplikacja na raz (ten sam
# limit co jeden venv na konto, patrz hosting-user-python-venv.sh) -
# wlasny systemd service `cd-user-pyapp@<username>.service` (template
# unit, self-instalujacy sie tutaj przy pierwszym uzyciu), dokladnie ten
# sam wzorzec co Redis (hosting-user-redis-apply.sh/-stop.sh):
#   - root-owned template unit z User=%i/Group=%i
#   - per-user drop-in `slice.conf` przypisujacy do JUZ ISTNIEJACEGO
#     user-<uid>.slice (ten sam limit RAM co cale konto - zero nowego
#     mechanizmu limitu)
#   - `loginctl enable-linger`, zeby ten slice (i usluga w nim) przezyl
#     wylogowanie ostatniej sesji SSH
#
# Drugi drop-in, `exec.conf`, niesie KONKRETNA komende startowa
# (framework + port) - nadpisywany od nowa przy KAZDYM `start`, wiec
# zmiana portu/frameworka i ponowne kliknięcie "Uruchom" po prostu
# dziala.
#
# start <username> <framework> <port>
#   Idempotentny szkielet projektu (django/flask/fastapi) - jesli plik
#   wejsciowy JUZ istnieje (manage.py / app.py / main.py), NIE jest
#   nadpisywany (zeby nie zniszczyc kodu, ktory user edytowal reczne przez
#   SSH). Wymaga, zeby venv i framework byly juz zainstalowane
#   (hosting-user-python-venv.sh install) - jasny blad, jesli brakuje.
# stop <username>
#   `systemctl disable --now` (best-effort, jak Redis) - NIE kasuje
#   szkieletu projektu ani venv.
# status <username>
#   Wypisuje `ACTIVE=<ActiveState>`, a jesli drop-in istnieje - tez
#   `FRAMEWORK=`/`PORT=` (odczytane z wlasnego exec.conf) oraz do 20 linii
#   `LOG=<linia>` z `journalctl` (wymaga roota - zwykly user nie odczyta
#   dziennika cudzej uslugi, stad ta akcja tez idzie przez sudo).
#
# Uzycie: hosting-user-python-app.sh <start|stop|status> ...

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

ACTION="${1:-}"
USERNAME="${2:-}"

if ! [[ "$USERNAME" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
  err "Nieprawidlowa nazwa uzytkownika: '${USERNAME}'"
fi
if ! id -u "$USERNAME" >/dev/null 2>&1; then
  err "Uzytkownik '${USERNAME}' nie istnieje."
fi

USER_HOME="$(getent passwd "$USERNAME" | cut -d: -f6)"
[ -n "$USER_HOME" ] || err "Nie udalo sie ustalic katalogu domowego dla '${USERNAME}'."
UID_NUM="$(id -u "$USERNAME")"

VENV_DIR="${USER_HOME}/venv"
PYAPP_DIR="${USER_HOME}/pyapp"
UNIT_NAME="cd-user-pyapp@${USERNAME}.service"
UNIT_FILE="/etc/systemd/system/cd-user-pyapp@.service"
DROPIN_DIR="/etc/systemd/system/cd-user-pyapp@${USERNAME}.service.d"

case "$ACTION" in
  start)
    FRAMEWORK="${3:-}"
    PORT="${4:-}"

    case "$FRAMEWORK" in
      django|flask|fastapi) ;;
      *) err "Nieznany framework: '${FRAMEWORK}' (django|flask|fastapi)" ;;
    esac
    if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
      err "Nieprawidlowy port: '${PORT}' (1-65535)"
    fi
    [ -d "$VENV_DIR" ] || err "Venv nie istnieje - utworz go najpierw."

    case "$FRAMEWORK" in
      django)
        BIN_NAME="gunicorn"
        ENTRY_FILE="${PYAPP_DIR}/manage.py"
        ;;
      flask)
        BIN_NAME="gunicorn"
        ENTRY_FILE="${PYAPP_DIR}/app.py"
        ;;
      fastapi)
        BIN_NAME="uvicorn"
        ENTRY_FILE="${PYAPP_DIR}/main.py"
        ;;
    esac
    [ -x "${VENV_DIR}/bin/${BIN_NAME}" ] || err "Framework '${FRAMEWORK}' nie jest zainstalowany w venv (brak ${VENV_DIR}/bin/${BIN_NAME}) - zainstaluj go najpierw."

    if [ ! -f "$ENTRY_FILE" ]; then
      runuser -u "$USERNAME" -- mkdir -p "$PYAPP_DIR" || err "Nie udalo sie utworzyc ${PYAPP_DIR}."
      case "$FRAMEWORK" in
        django)
          if ! runuser -u "$USERNAME" -- bash -c "cd '${PYAPP_DIR}' && '${VENV_DIR}/bin/django-admin' startproject cdapp ."; then
            err "Utworzenie szkieletu projektu Django nie powiodlo sie."
          fi
          runuser -u "$USERNAME" -- sed -i "s/^ALLOWED_HOSTS = \[\]/ALLOWED_HOSTS = ['*']/" "${PYAPP_DIR}/cdapp/settings.py" || true
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
          install -m 644 -o "$USERNAME" -g "$USERNAME" "$TMP_APP" "${PYAPP_DIR}/app.py"
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
          install -m 644 -o "$USERNAME" -g "$USERNAME" "$TMP_APP" "${PYAPP_DIR}/main.py"
          rm -f "$TMP_APP"
          ;;
      esac
    fi

    TMP_UNIT="$(mktemp)"
    cat > "$TMP_UNIT" <<'UNITEOF'
[Unit]
Description=Per-account Python app (%i)
After=network.target

[Service]
Type=simple
ExecStart=/bin/true
User=%i
Group=%i
WorkingDirectory=/home/%i/pyapp
Restart=on-failure
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
UNITEOF
    install -m 644 -o root -g root "$TMP_UNIT" "$UNIT_FILE"
    rm -f "$TMP_UNIT"

    mkdir -p "$DROPIN_DIR"

    TMP_SLICE="$(mktemp)"
    cat > "$TMP_SLICE" <<EOF
[Service]
Slice=user-${UID_NUM}.slice
EOF
    install -m 644 -o root -g root "$TMP_SLICE" "${DROPIN_DIR}/slice.conf"
    rm -f "$TMP_SLICE"

    case "$FRAMEWORK" in
      django)
        EXEC_CMD="${VENV_DIR}/bin/gunicorn --chdir ${PYAPP_DIR} --workers 1 --bind 127.0.0.1:${PORT} cdapp.wsgi:application"
        ;;
      flask)
        EXEC_CMD="${VENV_DIR}/bin/gunicorn --chdir ${PYAPP_DIR} --workers 1 --bind 127.0.0.1:${PORT} app:app"
        ;;
      fastapi)
        EXEC_CMD="${VENV_DIR}/bin/uvicorn --app-dir ${PYAPP_DIR} --host 127.0.0.1 --port ${PORT} main:app"
        ;;
    esac
    TMP_EXEC="$(mktemp)"
    {
      echo "[Service]"
      echo "ExecStart="
      echo "ExecStart=${EXEC_CMD}"
    } > "$TMP_EXEC"
    install -m 644 -o root -g root "$TMP_EXEC" "${DROPIN_DIR}/exec.conf"
    rm -f "$TMP_EXEC"

    systemctl daemon-reload
    loginctl enable-linger "$USERNAME" >/dev/null 2>&1 || true
    systemctl restart "$UNIT_NAME" || err "Nie udalo sie uruchomic aplikacji dla ${USERNAME} - sprawdz journalctl -u ${UNIT_NAME}"
    systemctl enable "$UNIT_NAME" >/dev/null 2>&1 || true

    echo "OK: aplikacja (${FRAMEWORK}) dla ${USERNAME} uruchomiona na porcie ${PORT}."
    ;;

  stop)
    systemctl disable --now "$UNIT_NAME" 2>&1 || true
    echo "OK: aplikacja dla ${USERNAME} zatrzymana."
    ;;

  status)
    ACTIVE_STATE="$(systemctl show "$UNIT_NAME" --no-page -p ActiveState 2>/dev/null | sed -n 's/^ActiveState=//p')"
    echo "ACTIVE=${ACTIVE_STATE:-unknown}"

    EXEC_CONF="${DROPIN_DIR}/exec.conf"
    if [ -f "$EXEC_CONF" ]; then
      EXEC_LINE="$(grep '^ExecStart=' "$EXEC_CONF" | tail -n 1)"
      PORT_VAL="$(echo "$EXEC_LINE" | grep -oE '(--bind 127\.0\.0\.1:|--port )[0-9]+' | grep -oE '[0-9]+$')"
      if echo "$EXEC_LINE" | grep -q '/bin/uvicorn '; then
        FRAMEWORK_VAL="fastapi"
      elif echo "$EXEC_LINE" | grep -q 'cdapp.wsgi:application'; then
        FRAMEWORK_VAL="django"
      elif echo "$EXEC_LINE" | grep -q ' app:app'; then
        FRAMEWORK_VAL="flask"
      fi
      [ -n "${FRAMEWORK_VAL:-}" ] && echo "FRAMEWORK=${FRAMEWORK_VAL}"
      [ -n "${PORT_VAL:-}" ] && echo "PORT=${PORT_VAL}"
    fi

    journalctl -u "$UNIT_NAME" -n 20 --no-pager --output=cat 2>/dev/null | while IFS= read -r line; do
      [ -n "$line" ] && echo "LOG=${line}"
    done
    ;;

  *)
    err "Nieznana akcja: '${ACTION}' (start|stop|status)"
    ;;
esac
