#!/usr/bin/env bash
#
# Zarzadza JEDNYM, prywatnym virtualenv (~/venv) konta hostingowego (self-
# service z panelu klienta, /user/ - Python). Venv jest OPT-IN, nie
# zakladany automatycznie przy tworzeniu konta (w odroznieniu od ~/tmp,
# ~/logs, ~/backup - patrz hosting-account-create.sh) - ten sam wzorzec co
# Redis (hosting-user-redis-apply.sh): tworzony leniwie, dopiero na klik
# "Utworz venv" w panelu.
#
# Tworzenie/instalacja pakietow dzieje sie jako SAM user (`runuser`, nie
# jako root) - to jego wlasny katalog domowy, ten sam duch minimalnych
# uprawnien co pool PHP-FPM (hosting-user-php-pool-apply.sh) i instalator
# WordPressa (hosting-user-site.sh) - zero potrzeby na chown -R po fakcie,
# pliki od razu naleza do wlasciwego usera.
#
# NIE ma tu zadnego "stanu" trzymanego w JSON - `status` zawsze czyta
# PRAWDZIWY stan z dysku (wersja Pythona w venv, `pip list`), zeby nie
# rozjechac sie z rzeczywistoscia, gdyby user sam recznie doinstalowal/
# odinstalowal cos przez SSH.
#
# create <username> <pythonPath>
#   Idempotentne - jesli ~/venv juz istnieje, jest USUWANY i zakladany od
#   nowa (zmiana wersji Pythona = swiezy venv, nie da sie "upgrade in
#   place"). Panel MUSI ostrzec usera przed utrata zainstalowanych
#   pakietow w UI (potwierdzenie), ten skrypt sam tego nie pyta.
# install <username> <framework>
#   framework: django|flask|fastapi - instaluje zestaw pakietow do JUZ
#   istniejacego ~/venv (blad, jesli venv nie istnieje). Zestawy pakietow
#   dobrane zgodnie z podpowiedzia juz obecna w panelu przy szablonie
#   Reverse Proxy ("Python: venv + gunicorn/uvicorn").
# status <username>
#   Wypisuje na stdout linie `EXISTS=1` lub `EXISTS=0`, a jesli istnieje -
#   tez `PYVERSION=<wersja>` i liste `PKG=<nazwa>==<wersja>` (po jednej
#   linii na kazdy zainstalowany pakiet z `pip list --format=freeze`) - Node
#   parsuje ten prosty, liniowy format.
# remove <username>
#   Usuwa ~/venv calkowicie (idempotentne - brak katalogu to sukces).
#
# Uzycie: hosting-user-python-venv.sh <create|install|status|remove> ...

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
VENV_DIR="${USER_HOME}/venv"

case "$ACTION" in
  create)
    PYTHON_PATH="${3:-}"
    if ! [[ "$PYTHON_PATH" =~ ^/usr/bin/python3\.[0-9]+$ ]]; then
      err "Nieprawidlowa sciezka Pythona: '${PYTHON_PATH}'"
    fi
    [ -x "$PYTHON_PATH" ] || err "Plik '${PYTHON_PATH}' nie istnieje lub nie jest wykonywalny."

    rm -rf "$VENV_DIR"
    if ! runuser -u "$USERNAME" -- "$PYTHON_PATH" -m venv "$VENV_DIR"; then
      rm -rf "$VENV_DIR"
      err "Utworzenie venv (${PYTHON_PATH}) nie powiodlo sie."
    fi
    echo "OK: venv utworzony w ${VENV_DIR} (${PYTHON_PATH})."
    ;;

  install)
    FRAMEWORK="${3:-}"
    [ -d "$VENV_DIR" ] || err "Venv nie istnieje - utworz go najpierw."

    case "$FRAMEWORK" in
      django) PACKAGES="django gunicorn" ;;
      flask) PACKAGES="flask gunicorn" ;;
      fastapi) PACKAGES='fastapi uvicorn[standard]' ;;
      *) err "Nieznany framework: '${FRAMEWORK}' (django|flask|fastapi)" ;;
    esac

    if ! runuser -u "$USERNAME" -- "${VENV_DIR}/bin/pip" install --upgrade pip >/dev/null; then
      err "Aktualizacja pip w venv nie powiodla sie."
    fi
    # shellcheck disable=SC2086
    if ! runuser -u "$USERNAME" -- "${VENV_DIR}/bin/pip" install $PACKAGES; then
      err "Instalacja pakietow (${FRAMEWORK}: ${PACKAGES}) nie powiodla sie."
    fi
    echo "OK: ${FRAMEWORK} (${PACKAGES}) zainstalowany w ${VENV_DIR}."
    ;;

  status)
    if [ ! -d "$VENV_DIR" ] || [ ! -x "${VENV_DIR}/bin/python" ]; then
      echo "EXISTS=0"
      exit 0
    fi
    echo "EXISTS=1"
    PYVERSION="$(runuser -u "$USERNAME" -- "${VENV_DIR}/bin/python" --version 2>&1 | awk '{print $2}')"
    echo "PYVERSION=${PYVERSION:-unknown}"
    runuser -u "$USERNAME" -- "${VENV_DIR}/bin/pip" list --format=freeze 2>/dev/null | while IFS= read -r line; do
      [ -n "$line" ] && echo "PKG=${line}"
    done
    ;;

  remove)
    rm -rf "$VENV_DIR"
    echo "OK: venv usuniety (${VENV_DIR})."
    ;;

  *)
    err "Nieznana akcja: '${ACTION}' (create|install|status|remove)"
    ;;
esac
