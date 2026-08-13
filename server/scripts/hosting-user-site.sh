#!/usr/bin/env bash
#
# Zarzadza plikiem konfiguracji Caddy pojedynczej strony konta hostingowego
# (PLASKO: /etc/caddy/sites/<domain>.caddy, bez podkatalogu per-konto -
# patrz hosting-account-create.sh: Caddy `import` dopuszcza tylko jeden
# wildcard w calym wzorcu, wiec `import /etc/caddy/sites/*.caddy` w glownym
# Caddyfile, izolacja miedzy kontami idzie przez uprawnienia PLIKU
# (chown <username>:caddy, 0640), nie przez katalog) - ten sam wzorzec
# walidacja-przed-podmiana-z-rollbackiem co caddy-set-performance.sh, tylko
# celem jest plik PER-STRONA, a nie sam Caddyfile. Domena jest globalnie
# unikalna (wymuszane w hostingUserSites.js), wiec plaska nazwa pliku nigdy
# nie koliduje miedzy kontami.
#
# "Zatrzymana" strona = plik ma rozszerzenie .caddy.disabled (NIE pasuje do
# glob *.caddy, wiec Caddy go w ogole nie importuje) - `caddy validate`
# dziala tylko na tym co jest faktycznie zaimportowane, wiec edycja
# (`apply`) zatrzymanej strony jest walidowana dopiero przy nastepnym
# `enable` (akceptowalny kompromis: bledny config zatrzymanej strony nie
# psuje niczego, dopoki ktos jej nie uruchomi).
#
# apply <username> <domain>   - tresc bloku Caddy na stdin. Zapisuje ja do
#                                pliku odpowiadajacego OBECNEMU stanowi
#                                strony (aktywny/zatrzymany - edycja NIE
#                                zmienia stanu). Przy PIERWSZYM utworzeniu
#                                (brak obu plikow) zaklada tez
#                                ~<username>/domains/<domain>/public
#                                z placeholderem index.html (tylko jesli
#                                public/ jest puste) - katalog tmp/ per-
#                                strona NIE jest juz zakladany, user ma
#                                jeden wspolny ~/tmp na konto (patrz
#                                hosting-account-create.sh). Logi Caddy ida
#                                do wspolnego /var/log/caddy/<domain>.log,
#                                nie pod ~/domains.
# check <username> <domain>   - tresc bloku Caddy na stdin, TYLKO fmt +
#                                adapt + validate (jako niezalezny
#                                Caddyfile) - NIC nie zapisuje na dysk, nie
#                                przeladowuje Caddy. Do przycisku "Sprawdz"
#                                w edytorze configu strony w panelu -
#                                pozwala userowi zwalidowac zmiany PRZED
#                                ich zastosowaniem (`apply`).
# get <username> <domain>     - wypisuje na stdout surowa tresc aktualnego
#                                pliku strony (aktywnego lub zatrzymanego,
#                                cokolwiek istnieje) - do zaladowania
#                                edytora configu w panelu.
# enable <username> <domain>  - <domain>.caddy.disabled -> <domain>.caddy
# disable <username> <domain> - <domain>.caddy -> <domain>.caddy.disabled
# delete <username> <domain>  - usuwa .caddy/.caddy.disabled ORAZ CALY
#                                katalog ~<username>/domains/<domain>
#                                (rekurencyjnie, NIEODWRACALNIE) - swiadoma
#                                zmiana wzgledem hosting-account-delete.sh
#                                (ktory kasuje tylko KONTO, nie pliki) -
#                                przycisk "Usun" w panelu usera ma kasowac
#                                strone calkowicie, w jednym kroku;
#                                potwierdzenie w UI musi to jasno mowic.
#
# Uzycie: hosting-user-site.sh <apply|check|get|enable|disable|delete> <username> <domain>

set -uo pipefail

SITES_BASE_DIR="/etc/caddy/sites"
CADDYFILE="/etc/caddy/Caddyfile"

ACTION="${1:-}"
USERNAME="${2:-}"
DOMAIN="${3:-}"

if ! [[ "$USERNAME" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
  echo "BLAD: nieprawidlowa nazwa uzytkownika: '${USERNAME}'" >&2
  exit 1
fi
if ! [[ "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$ ]]; then
  echo "BLAD: nieprawidlowa domena: '${DOMAIN}'" >&2
  exit 1
fi
if ! id -u "$USERNAME" >/dev/null 2>&1; then
  echo "BLAD: uzytkownik '${USERNAME}' nie istnieje." >&2
  exit 1
fi

if [ ! -d "$SITES_BASE_DIR" ]; then
  echo "BLAD: katalog stron nie istnieje: ${SITES_BASE_DIR}" >&2
  exit 1
fi

ACTIVE_FILE="${SITES_BASE_DIR}/${DOMAIN}.caddy"
DISABLED_FILE="${SITES_BASE_DIR}/${DOMAIN}.caddy.disabled"

case "$ACTION" in
  apply)
    NEW_BLOCK="$(cat)"
    if [ -z "$NEW_BLOCK" ]; then
      echo "BLAD: pusta tresc konfiguracji strony." >&2
      exit 1
    fi

    TMP="$(mktemp)"
    ERR_LOG="$(mktemp)"
    printf '%s\n' "$NEW_BLOCK" > "$TMP"

    if ! caddy fmt --overwrite "$TMP" >"$ERR_LOG" 2>&1; then
      echo "BLAD: caddy fmt nie powiodlo sie: $(cat "$ERR_LOG")" >&2
      rm -f "$TMP" "$ERR_LOG"
      exit 1
    fi

    # Walidacja SAMEGO bloku strony jako niezaleznego Caddyfile (adapt +
    # validate) - ZANIM cokolwiek trafi na docelowa sciezke, ktora Caddy
    # faktycznie importuje. `caddy adapt` wychwytuje bledy skladni/schematu,
    # ktorych samo `caddy fmt` (formatowanie) nie widzi; nizej, PO podmianie
    # pliku, jest jeszcze druga walidacja - calego $CADDYFILE - ktora lapie
    # bledy MIEDZY plikami (np. dwie strony z ta sama domena).
    if ! caddy adapt --config "$TMP" --adapter caddyfile >"$ERR_LOG" 2>&1; then
      echo "BLAD: nowy config strony nie przeszedl adaptacji: $(cat "$ERR_LOG")" >&2
      rm -f "$TMP" "$ERR_LOG"
      exit 1
    fi
    if ! caddy validate --config "$TMP" --adapter caddyfile >"$ERR_LOG" 2>&1; then
      echo "BLAD: nowy config strony nie przeszedl samodzielnej walidacji: $(cat "$ERR_LOG")" >&2
      rm -f "$TMP" "$ERR_LOG"
      exit 1
    fi

    IS_NEW=1
    TARGET_FILE="$ACTIVE_FILE"
    if [ -f "$ACTIVE_FILE" ]; then
      IS_NEW=0
      TARGET_FILE="$ACTIVE_FILE"
    elif [ -f "$DISABLED_FILE" ]; then
      IS_NEW=0
      TARGET_FILE="$DISABLED_FILE"
    fi

    USER_HOME="$(getent passwd "$USERNAME" | cut -d: -f6)"

    # Katalogi na tresc strony MUSZA istniec ZANIM Caddy dostanie nowy
    # config - `systemctl reload` faktycznie laduje config do dzialajacej
    # instancji (w odroznieniu od statycznego `caddy validate` ponizej).
    # Log NIE idzie do ~/domains/<domena>/logs (usuniete - Caddy jako
    # caddy:caddy i tak nie ma tam prawa zapisu bez dodatkowych sztuczek z
    # uprawnieniami), tylko do wspolnego /var/log/caddy/ (patrz nizej) -
    # zostaje wiec tylko public/ (tmp/ per-strona zrezygnowane, user ma
    # wspolny ~/tmp na konto).
    #
    # /var/log/caddy powinien juz istniec i byc caddy:caddy z pakietu
    # Caddy - `mkdir -p`+chown ponizej to tylko zabezpieczenie (idempotentne,
    # bez efektow ubocznych jesli juz jest poprawnie ustawiony), na wypadek
    # gdyby pakiet tego nie zrobil.
    mkdir -p /var/log/caddy
    chown caddy:caddy /var/log/caddy
    chmod 0755 /var/log/caddy

    # Sam PLIK loga MUSI byc utworzony (i naleziec do caddy:caddy) TU, ZANIM
    # cokolwiek go otworzy - `caddy validate`/`caddy adapt` ponizej faktycznie
    # PROWIZJONUJE config (w tym modul loggera), a skoro caly ten skrypt
    # dziala jako root (sudo), to WLASNIE `caddy validate` jako pierwszy
    # tworzy plik loga i zostaje jego wlascicielem (root:root, 0600) - wtedy
    # prawdziwa usluga Caddy (dziala jako caddy:caddy) nie ma juz prawa go
    # otworzyc do zapisu. Otwarcie JUZ ISTNIEJACEGO pliku (nawet przez root)
    # NIE zmienia jego wlasciciela, wiec wystarczy utworzyc go z poprawnym
    # chown/chmod raz, zanim caddy-cokolwiek go dotknie.
    LOG_FILE="/var/log/caddy/${DOMAIN}.log"
    [ -f "$LOG_FILE" ] || : > "$LOG_FILE"
    chown caddy:caddy "$LOG_FILE"
    chmod 0644 "$LOG_FILE"

    # Log NIE jest kopiowany do ~/logs (jeden zapisujacy - Caddy - to
    # jedyne bezpieczne zrodlo prawdy), tylko DOWIAZANY symlinkiem, zeby
    # user mial go pod reka bez grzebania w /var/log/caddy. Plik docelowy
    # jest juz 0644 caddy:caddy (wyzej) - "other" (czyli user) ma prawo
    # odczytu, wiec symlink dziala BEZ zadnej zmiany uprawnien na ~/logs
    # (zostaje 0700, patrz hosting-account-create.sh) - kernel przy
    # odczycie przez symlink sprawdza uprawnienia CELU, nie samego
    # dowiazania. Odswiezane przy KAZDYM apply (nie tylko IS_NEW), zeby
    # przetrwalo np. reczne usuniecie przez usera. Pomijane jesli ~/logs
    # jeszcze nie istnieje (konto sprzed tej poprawki, zanim /etc/skel
    # zaczal go zakladac) - naprawi sie samo przy kolejnym apply, gdy
    # katalog juz bedzie.
    USER_LOGS_DIR="${USER_HOME}/logs"
    if [ -d "$USER_LOGS_DIR" ]; then
      ln -sf "$LOG_FILE" "${USER_LOGS_DIR}/${DOMAIN}.log"
    fi

    if [ "$IS_NEW" = "1" ]; then
      DOMAIN_DIR="${USER_HOME}/domains/${DOMAIN}"
      mkdir -p "${DOMAIN_DIR}/public"
      chown "${USERNAME}:${USERNAME}" "$DOMAIN_DIR"
      # DirectAdmin-style, bez grupy caddy: DOMAIN_DIR samo w sobie ma
      # o+x BEZ o+r (0711, tylko przejscie - `ls ~/domains/<domena>` z
      # zewnatrz nic nie pokaze), a public/ ponizej ma o+r+x (0755) -
      # to JEDYNY faktycznie czytelny/serwowalny katalog. Domyslny umask
      # (022) na koncie usera sam nadaje "other read/execute" nowym
      # plikom/podkatalogom wgrywanym pozniej przez SSH/SFTP - w
      # odroznieniu od poprzedniego modelu (grupa caddy + SGID) nie
      # trzeba juz niczego wymuszac rekurencyjnie.
      chmod 0711 "$DOMAIN_DIR"
      chown "${USERNAME}:${USERNAME}" "${DOMAIN_DIR}/public"
      chmod 0755 "${DOMAIN_DIR}/public"
      if [ -z "$(ls -A "${DOMAIN_DIR}/public" 2>/dev/null)" ]; then
        cat > "${DOMAIN_DIR}/public/index.html" <<HTML
<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${DOMAIN}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #f4f5f7;
    color: #1f2328;
  }
  .card {
    max-width: 460px;
    width: 100%;
    background: #ffffff;
    border: 1px solid #e2e4e8;
    border-radius: 12px;
    padding: 40px 36px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  }
  .badge {
    display: inline-block;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #1a7f37;
    background: #dafbe1;
    padding: 4px 10px;
    border-radius: 999px;
    margin-bottom: 16px;
  }
  h1 {
    font-size: 22px;
    line-height: 1.3;
    margin: 0 0 12px;
    word-break: break-word;
  }
  p {
    margin: 0 0 12px;
    line-height: 1.55;
    color: #56606a;
  }
  code {
    background: #f0f1f3;
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 0.92em;
  }
  .path { margin-bottom: 0; }
  hr {
    border: none;
    border-top: 1px solid #e2e4e8;
    margin: 20px 0;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #0d1117; color: #e6edf3; }
    .card { background: #161b22; border-color: #30363d; box-shadow: none; }
    .badge { color: #3fb950; background: rgba(63, 185, 80, 0.15); }
    p { color: #9198a1; }
    code { background: #21262d; color: #e6edf3; }
    hr { border-top-color: #30363d; }
  }
</style>
</head>
<body>
  <div class="card">
    <span class="badge">Strona utworzona</span>
    <h1>${DOMAIN}</h1>
    <p>Ta strona zostala wlasnie zalozona w panelu hostingowym i czeka na Twoje pliki.</p>
    <p class="path">Wgraj je przez SSH/SFTP do katalogu <code>~/domains/${DOMAIN}/public</code>.</p>
    <hr>
    <div lang="en">
      <p>This site has just been created in the hosting panel and is waiting for your files.</p>
      <p class="path">Upload them via SSH/SFTP to the <code>~/domains/${DOMAIN}/public</code> directory.</p>
    </div>
  </div>
</body>
</html>
HTML
        chown "${USERNAME}:${USERNAME}" "${DOMAIN_DIR}/public/index.html"
        chmod 0644 "${DOMAIN_DIR}/public/index.html"
      fi
    fi

    BACKUP=""
    if [ "$IS_NEW" = "0" ]; then
      BACKUP="$(mktemp)"
      cp -p "$TARGET_FILE" "$BACKUP"
    fi

    cp "$TMP" "$TARGET_FILE"
    rm -f "$TMP"
    chown "${USERNAME}:caddy" "$TARGET_FILE"
    chmod 0640 "$TARGET_FILE"

    if ! caddy adapt --config "$CADDYFILE" --adapter caddyfile >"$ERR_LOG" 2>&1; then
      echo "BLAD: caly Caddyfile (po podmianie strony) nie przeszedl adaptacji: $(cat "$ERR_LOG")" >&2
      if [ -n "$BACKUP" ]; then cp -p "$BACKUP" "$TARGET_FILE"; rm -f "$BACKUP"; else rm -f "$TARGET_FILE"; fi
      rm -f "$ERR_LOG"
      exit 1
    fi
    if ! caddy validate --config "$CADDYFILE" --adapter caddyfile >"$ERR_LOG" 2>&1; then
      echo "BLAD: nowy config strony nie przeszedl walidacji: $(cat "$ERR_LOG")" >&2
      if [ -n "$BACKUP" ]; then cp -p "$BACKUP" "$TARGET_FILE"; rm -f "$BACKUP"; else rm -f "$TARGET_FILE"; fi
      rm -f "$ERR_LOG"
      exit 1
    fi
    rm -f "$ERR_LOG"

    if [ "$TARGET_FILE" = "$ACTIVE_FILE" ]; then
      ERR_LOG="$(mktemp)"
      if ! systemctl reload caddy 2>"$ERR_LOG"; then
        MSG="$(cat "$ERR_LOG")"
        rm -f "$ERR_LOG"
        if [ -n "$BACKUP" ]; then cp -p "$BACKUP" "$TARGET_FILE"; else rm -f "$TARGET_FILE"; fi
        systemctl reload caddy >/dev/null 2>&1 || true
        rm -f "$BACKUP"
        echo "BLAD: nie udalo sie przeladowac caddy: ${MSG} - przywrocono poprzedni config strony." >&2
        exit 1
      fi
      rm -f "$ERR_LOG"
    fi
    rm -f "$BACKUP"
    echo "OK: config strony ${DOMAIN} zapisany."
    ;;

  check)
    NEW_BLOCK="$(cat)"
    if [ -z "$NEW_BLOCK" ]; then
      echo "BLAD: pusta tresc konfiguracji strony." >&2
      exit 1
    fi

    TMP="$(mktemp)"
    ERR_LOG="$(mktemp)"
    printf '%s\n' "$NEW_BLOCK" > "$TMP"

    if ! caddy fmt --overwrite "$TMP" >"$ERR_LOG" 2>&1; then
      echo "BLAD: caddy fmt nie powiodlo sie: $(cat "$ERR_LOG")" >&2
      rm -f "$TMP" "$ERR_LOG"
      exit 1
    fi
    if ! caddy adapt --config "$TMP" --adapter caddyfile >"$ERR_LOG" 2>&1; then
      echo "BLAD: config nie przeszedl adaptacji: $(cat "$ERR_LOG")" >&2
      rm -f "$TMP" "$ERR_LOG"
      exit 1
    fi
    if ! caddy validate --config "$TMP" --adapter caddyfile >"$ERR_LOG" 2>&1; then
      echo "BLAD: config nie przeszedl walidacji: $(cat "$ERR_LOG")" >&2
      rm -f "$TMP" "$ERR_LOG"
      exit 1
    fi
    rm -f "$TMP" "$ERR_LOG"
    echo "OK: config przeszedl fmt+adapt+validate (samodzielnie, jako niezalezny Caddyfile) - NIE zastosowano, to tylko sprawdzenie."
    ;;

  get)
    if [ -f "$ACTIVE_FILE" ]; then
      cat "$ACTIVE_FILE"
    elif [ -f "$DISABLED_FILE" ]; then
      cat "$DISABLED_FILE"
    else
      echo "BLAD: nie znaleziono konfiguracji strony ${DOMAIN}." >&2
      exit 1
    fi
    ;;

  enable)
    if [ ! -f "$DISABLED_FILE" ]; then
      if [ -f "$ACTIVE_FILE" ]; then
        echo "OK: strona ${DOMAIN} juz jest wlaczona."
        exit 0
      fi
      echo "BLAD: nie znaleziono konfiguracji strony ${DOMAIN}." >&2
      exit 1
    fi
    mv -f "$DISABLED_FILE" "$ACTIVE_FILE"
    ERR_LOG="$(mktemp)"
    if ! caddy adapt --config "$CADDYFILE" --adapter caddyfile >"$ERR_LOG" 2>&1; then
      echo "BLAD: config strony nie przeszedl adaptacji, nie mozna wlaczyc: $(cat "$ERR_LOG")" >&2
      mv -f "$ACTIVE_FILE" "$DISABLED_FILE"
      rm -f "$ERR_LOG"
      exit 1
    fi
    if ! caddy validate --config "$CADDYFILE" --adapter caddyfile >"$ERR_LOG" 2>&1; then
      echo "BLAD: config strony nie przeszedl walidacji, nie mozna wlaczyc: $(cat "$ERR_LOG")" >&2
      mv -f "$ACTIVE_FILE" "$DISABLED_FILE"
      rm -f "$ERR_LOG"
      exit 1
    fi
    if ! systemctl reload caddy 2>"$ERR_LOG"; then
      MSG="$(cat "$ERR_LOG")"
      rm -f "$ERR_LOG"
      mv -f "$ACTIVE_FILE" "$DISABLED_FILE"
      systemctl reload caddy >/dev/null 2>&1 || true
      echo "BLAD: nie udalo sie przeladowac caddy: ${MSG}" >&2
      exit 1
    fi
    rm -f "$ERR_LOG"
    echo "OK: strona ${DOMAIN} wlaczona."
    ;;

  disable)
    if [ ! -f "$ACTIVE_FILE" ]; then
      if [ -f "$DISABLED_FILE" ]; then
        echo "OK: strona ${DOMAIN} juz jest wylaczona."
        exit 0
      fi
      echo "BLAD: nie znaleziono konfiguracji strony ${DOMAIN}." >&2
      exit 1
    fi
    mv -f "$ACTIVE_FILE" "$DISABLED_FILE"
    ERR_LOG="$(mktemp)"
    if ! systemctl reload caddy 2>"$ERR_LOG"; then
      MSG="$(cat "$ERR_LOG")"
      rm -f "$ERR_LOG"
      mv -f "$DISABLED_FILE" "$ACTIVE_FILE"
      systemctl reload caddy >/dev/null 2>&1 || true
      echo "BLAD: nie udalo sie przeladowac caddy: ${MSG}" >&2
      exit 1
    fi
    rm -f "$ERR_LOG"
    echo "OK: strona ${DOMAIN} wylaczona."
    ;;

  delete)
    if [ ! -f "$ACTIVE_FILE" ] && [ ! -f "$DISABLED_FILE" ]; then
      echo "OK: konfiguracja strony ${DOMAIN} juz nie istnieje."
      exit 0
    fi
    BACKUP="$(mktemp)"
    WAS_ACTIVE=0
    if [ -f "$ACTIVE_FILE" ]; then
      WAS_ACTIVE=1
      cp -p "$ACTIVE_FILE" "$BACKUP"
    else
      cp -p "$DISABLED_FILE" "$BACKUP"
    fi
    rm -f "$ACTIVE_FILE" "$DISABLED_FILE"
    if [ "$WAS_ACTIVE" = "1" ]; then
      ERR_LOG="$(mktemp)"
      if ! systemctl reload caddy 2>"$ERR_LOG"; then
        MSG="$(cat "$ERR_LOG")"
        rm -f "$ERR_LOG"
        cp -p "$BACKUP" "$ACTIVE_FILE"
        systemctl reload caddy >/dev/null 2>&1 || true
        rm -f "$BACKUP"
        echo "BLAD: nie udalo sie przeladowac caddy po usunieciu strony: ${MSG} - przywrocono config." >&2
        exit 1
      fi
      rm -f "$ERR_LOG"
    fi
    rm -f "$BACKUP"

    # Usuwamy TEZ pliki strony na dysku - swiadoma zmiana (wczesniej panel
    # celowo ich nie ruszal). NIEODWRACALNE - potwierdzenie w UI (panel
    # usera) musi to jasno komunikowac PRZED wywolaniem tej akcji.
    # ${VAR:?} = zabezpieczenie przed `rm -rf` na pustej sciezce, gdyby
    # USER_HOME z jakiegos powodu wyszedl pusty (DOMAIN jest juz
    # zwalidowany regexem wyzej, ale defense-in-depth kosztuje zero).
    USER_HOME="$(getent passwd "$USERNAME" | cut -d: -f6)"
    if [ -n "$USER_HOME" ]; then
      rm -rf "${USER_HOME:?}/domains/${DOMAIN:?}"
    fi

    echo "OK: konfiguracja i pliki strony ${DOMAIN} usuniete (~/domains/${DOMAIN} skasowany)."
    ;;

  *)
    echo "BLAD: nieznana akcja: '${ACTION}' (apply|check|get|enable|disable|delete)" >&2
    exit 1
    ;;
esac
