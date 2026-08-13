#!/usr/bin/env bash
#
# Zarzadza WIELOMA, NIEZALEZNYMI aplikacjami Node.js konta hostingowego
# (self-service z panelu klienta, /user/ - Node). Mirror
# hosting-user-python-app.sh, z realnymi roznicami runtime:
#
# - Node NIE MA odpowiednika venv jako osobnego kroku - `node_modules`
#   juz z natury izoluje zaleznosci PER KATALOG PROJEKTU, wiec katalog
#   aplikacji (~/node-apps/<slug>/) jest jednoczesnie "srodowiskiem" i
#   kodem - bez podzialu na venv/app jak w Pythonie.
# - Osobny root ~/node-apps/<slug>/ (NIE ~/apps/<slug>/) - dwie
#   niezalezne aplikacje, Python "myapp" i Node "myapp", nie moga
#   kolidowac na tym samym katalogu.
# - Port trafia do aplikacji przez `Environment=PORT=...` w jednostce
#   systemd, NIE jako argument CLI (jak gunicorn/uvicorn w Pythonie) -
#   szkielety Node czytaja process.env.PORT, wiec ExecStart jest
#   IDENTYCZNY dla wszystkich frameworkow (`node index.js`).
# - `npm init`/`npm install` MUSZA dzialac z cwd = katalog aplikacji.
#   Uzywamy `env -C <dir> <cmd> args...` (nie `bash -c "cd ... && ..."`)
#   - to zmienia katalog BEZ posrednictwa powloki, argv trafia 1:1, wiec
#   nie ma ryzyka tej samej klasy buga co przy `pip install fastapi
#   "uvicorn[standard]"` (string z wbudowanymi cudzyslowami psuty przez
#   word-splitting) - PACKAGES jest tablica od poczatku, bez posredniej
#   powloki w ogole.
#
# create <username> <slug> <nodePath> <framework>
#   JEDNORAZOWE - blad, jesli ~/node-apps/<slug> juz istnieje. Instaluje
#   framework (npm install) i pisze minimalny szkielet startowy
#   (index.js) - pomijane dla 'manual' (tylko `npm init -y`, user
#   instaluje/pisze sam przez SSH).
# start <username> <slug> <nodePath> <framework> <port>
#   nodePath przekazywany PONOWNIE (w odroznieniu od Pythona) - `node` to
#   wspolny binarny plik systemu, nigdy nie kopiowany do node_modules,
#   wiec trzeba go wskazac na kazde uruchomienie, tak jak przy create.
# stop <username> <slug>
#   `systemctl disable --now` (best-effort) - NIE kasuje kodu/node_modules.
# status <username> <slug>
#   `ACTIVE=<ActiveState>` + do 20 linii `LOG=<linia>` z journalctl.
# delete <username> <slug>
#   Zatrzymuje usluge, kasuje jednostke ORAZ CALY ~/node-apps/<slug> -
#   nieodwracalne, UI musi to jasno powiedziec przed potwierdzeniem.
#
# Uzycie: hosting-user-node-app.sh <create|start|stop|status|delete> ...

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

APP_DIR="${USER_HOME}/node-apps/${SLUG}"
UNIT_NAME="cd-nodeapp-${USERNAME}-${SLUG}.service"
UNIT_FILE="/etc/systemd/system/${UNIT_NAME}"

case "$ACTION" in
  create)
    NODE_PATH="${4:-}"
    FRAMEWORK="${5:-}"

    if ! [[ "$NODE_PATH" =~ ^/usr/(local/)?bin/node[0-9]*$ ]]; then
      err "Nieprawidlowa sciezka Node: '${NODE_PATH}'"
    fi
    [ -x "$NODE_PATH" ] || err "Plik '${NODE_PATH}' nie istnieje lub nie jest wykonywalny."
    case "$FRAMEWORK" in
      express|fastify|koa|manual) ;;
      *) err "Nieznany framework: '${FRAMEWORK}' (express|fastify|koa|manual)" ;;
    esac
    [ -e "$APP_DIR" ] && err "Aplikacja '${SLUG}' juz istnieje."

    NPM_PATH="$(dirname "$NODE_PATH")/npm"
    [ -x "$NPM_PATH" ] || err "Nie znaleziono npm obok Node (${NPM_PATH})."

    case "$FRAMEWORK" in
      express) PACKAGES=(express) ;;
      fastify) PACKAGES=(fastify) ;;
      koa) PACKAGES=(koa) ;;
      manual) PACKAGES=() ;;
    esac

    runuser -u "$USERNAME" -- mkdir -p "$APP_DIR" || err "Nie udalo sie utworzyc ${APP_DIR}."

    if ! runuser -u "$USERNAME" -- env -C "$APP_DIR" "$NPM_PATH" init -y >/dev/null; then
      rm -rf "$APP_DIR"
      err "Inicjalizacja package.json (npm init) nie powiodla sie."
    fi

    if [ "${#PACKAGES[@]}" -gt 0 ]; then
      if ! runuser -u "$USERNAME" -- env -C "$APP_DIR" "$NPM_PATH" install "${PACKAGES[@]}"; then
        rm -rf "$APP_DIR"
        err "Instalacja pakietow (${FRAMEWORK}: ${PACKAGES[*]}) nie powiodla sie."
      fi
    fi

    case "$FRAMEWORK" in
      express)
        TMP_APP="$(mktemp)"
        cat > "$TMP_APP" <<'JSEOF'
const express = require('express');

const app = express();
const port = process.env.PORT || 3000;
const host = process.env.HOST || '127.0.0.1';

app.get('/', (req, res) => {
  res.send('Hello from Express via Caddy Dashboard!');
});

app.listen(port, host, () => {
  console.log(`Listening on ${host}:${port}`);
});
JSEOF
        install -m 644 -o "$USERNAME" -g "$USERNAME" "$TMP_APP" "${APP_DIR}/index.js"
        rm -f "$TMP_APP"
        ;;
      fastify)
        TMP_APP="$(mktemp)"
        cat > "$TMP_APP" <<'JSEOF'
const fastify = require('fastify')();

const port = process.env.PORT || 3000;
const host = process.env.HOST || '127.0.0.1';

fastify.get('/', async () => 'Hello from Fastify via Caddy Dashboard!');

fastify.listen({ port, host }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
});
JSEOF
        install -m 644 -o "$USERNAME" -g "$USERNAME" "$TMP_APP" "${APP_DIR}/index.js"
        rm -f "$TMP_APP"
        ;;
      koa)
        TMP_APP="$(mktemp)"
        cat > "$TMP_APP" <<'JSEOF'
const Koa = require('koa');

const app = new Koa();
const port = process.env.PORT || 3000;
const host = process.env.HOST || '127.0.0.1';

app.use((ctx) => {
  ctx.body = 'Hello from Koa via Caddy Dashboard!';
});

app.listen(port, host);
JSEOF
        install -m 644 -o "$USERNAME" -g "$USERNAME" "$TMP_APP" "${APP_DIR}/index.js"
        rm -f "$TMP_APP"
        ;;
      manual)
        : # brak index.js - user pisze/wgrywa kod sam przez SSH/SFTP
        ;;
    esac

    echo "OK: aplikacja '${SLUG}' (${FRAMEWORK}) dla ${USERNAME} utworzona."
    ;;

  start)
    NODE_PATH="${4:-}"
    FRAMEWORK="${5:-}"
    PORT="${6:-}"

    if ! [[ "$NODE_PATH" =~ ^/usr/(local/)?bin/node[0-9]*$ ]]; then
      err "Nieprawidlowa sciezka Node: '${NODE_PATH}'"
    fi
    [ -x "$NODE_PATH" ] || err "Plik '${NODE_PATH}' nie istnieje lub nie jest wykonywalny."
    case "$FRAMEWORK" in
      express|fastify|koa) ;;
      manual) err "Aplikacje typu 'manual' nie sa uruchamiane przez panel - zaloguj sie przez SSH i zrob to samodzielnie." ;;
      *) err "Nieznany framework: '${FRAMEWORK}' (express|fastify|koa|manual)" ;;
    esac
    if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
      err "Nieprawidlowy port: '${PORT}' (1-65535)"
    fi
    [ -f "${APP_DIR}/index.js" ] || err "Aplikacja '${SLUG}' nie istnieje lub nie ma pliku index.js - utworz ja najpierw."

    TMP_UNIT="$(mktemp)"
    cat > "$TMP_UNIT" <<EOF
[Unit]
Description=Node app ${SLUG} (${USERNAME})
After=network.target

[Service]
Type=simple
ExecStart=${NODE_PATH} ${APP_DIR}/index.js
Environment=PORT=${PORT}
Environment=HOST=127.0.0.1
User=${USERNAME}
Group=${USERNAME}
WorkingDirectory=${APP_DIR}
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
