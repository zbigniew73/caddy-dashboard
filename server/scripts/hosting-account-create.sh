#!/usr/bin/env bash
#
# Tworzy uzytkownika systemowego dla konta hostingowego - z prawdziwym
# dostepem SSH (powloka bash), katalogiem domowym pod wskazanym punktem
# montowania (<home_base_dir>/<username>) oraz wlasnym katalogiem na
# konfiguracje domen Caddy w /etc/caddy/sites/<username>. Limit dysku
# (quota) NIE jest tu ustawiany - to osobny krok, patrz
# quota-ext4-set.sh / quota-xfs-set.sh, wywolywany osobno przez
# server/services/hostingAccounts.js.
#
# Haslo tymczasowe jest CELOWO zawsze takie samo (latwe do podyktowania
# klientowi telefonicznie/mailowo) - chage -d 0 nizej wymusza jego zmiane
# przy pierwszym logowaniu SSH (shadow(5): last-changed=0 to
# udokumentowany mechanizm "user musi zmienic haslo przy nastepnym
# logowaniu", dziala niezaleznie od globalnej polityki PASS_MAX_DAYS).
#
# Katalog stron: /etc/caddy/sites/<username> (owner=user, group=caddy,
# 0750) - Caddy (dziala jako caddy:caddy) czyta stamtad *.caddy przez
# `import /etc/caddy/sites/*/*.caddy` w glownym Caddyfile. Top-level
# /etc/caddy/sites ma o+x BEZ o+r, zeby kazdy user mogl wejsc TYLKO do
# WLASNEGO podkatalogu (zna jego nazwe), ale nie zrobil `ls` i nie
# zobaczyl nazw innych kont.
#
# ~/domains: PRAWDZIWY katalog na dysku (nie symlink) - user
# laczacy sie po SSH/SFTP ma tu wrzucac realne pliki swoich stron. Wczesniejsza
# wersja robila to jako symlink w strone /etc/caddy/sites/<username>
# (katalog na KONFIGI Caddy, *.caddy), co bylo mylace - user zamiast
# plikow strony widzial config Caddy'ego. Config zostaje tam gdzie byl
# (USER_SITE_DIR ponizej), zarzadzany przez panel/root, nie przez usera.
#
# Zeby Caddy (dziala jako caddy:caddy) dotarl do plikow w
# ~/domains/<domena>/public, katalog domowy MUSI dawac grupie caddy
# prawo PRZEJSCIA (0710, execute-only, bez odczytu) - patrz nizej. Sam
# ~/domains i wszystko pod nim (tworzone pozniej przez flow "dodaj
# strone") to juz 0750 (grupa caddy ma r-x - moze czytac/listowac).
#
# Uzycie: hosting-account-create.sh <username> <home_base_dir>

set -euo pipefail

DEFAULT_TEMP_PASSWORD="PassWord!1234"
SITES_BASE_DIR="/etc/caddy/sites"

USERNAME="${1:-}"
HOME_BASE_DIR="${2:-}"

if ! [[ "$USERNAME" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
  echo "BLAD: nieprawidlowa nazwa uzytkownika: '${USERNAME}'" >&2
  exit 1
fi
if [[ "$HOME_BASE_DIR" != /* ]] || [ ! -d "$HOME_BASE_DIR" ]; then
  echo "BLAD: nieprawidlowy katalog bazowy: '${HOME_BASE_DIR}'" >&2
  exit 1
fi
if id -u "$USERNAME" >/dev/null 2>&1; then
  echo "BLAD: uzytkownik '${USERNAME}' juz istnieje." >&2
  exit 1
fi
if ! getent group caddy >/dev/null 2>&1; then
  echo "BLAD: grupa systemowa 'caddy' nie istnieje - czy Caddy jest zainstalowany?" >&2
  exit 1
fi

# Jesli nazwa pasuje do konwencji panelu (srv_<id>), wymuszamy UID = <id> -
# to ta konwencja sprawia, ze "srv_1001" faktycznie ma UID 1001, nie
# przypadkowy, kolejny wolny numer z puli useradd. Panel podpowiada wolne
# <id> w formularzu (GET /accounts/next-username), ale to i tak tylko
# podpowiedz - jesli admin wpisze zajety numer, useradd -u ponizej po
# prostu odrzuci kolizje z czytelnym bledem.
UID_ARGS=()
if [[ "$USERNAME" =~ ^srv_([0-9]+)$ ]]; then
  UID_ARGS=(-u "${BASH_REMATCH[1]}")
fi

useradd -m -b "$HOME_BASE_DIR" -s /bin/bash "${UID_ARGS[@]}" "$USERNAME"
echo "${USERNAME}:${DEFAULT_TEMP_PASSWORD}" | chpasswd
chage -d 0 "$USERNAME"

mkdir -p "$SITES_BASE_DIR"
chown root:caddy "$SITES_BASE_DIR"
chmod 0751 "$SITES_BASE_DIR"

USER_SITE_DIR="${SITES_BASE_DIR}/${USERNAME}"
mkdir -p "$USER_SITE_DIR"
chown "${USERNAME}:caddy" "$USER_SITE_DIR"
chmod 0750 "$USER_SITE_DIR"

USER_HOME="${HOME_BASE_DIR}/${USERNAME}"

# Katalog domowy sam w sobie musi dawac grupie "caddy" prawo PRZEJSCIA
# (bez odczytu/listowania) - inaczej Caddy nie dotrze do
# domains/<domena>/public ponizej, nawet jesli TE podkatalogi maja
# poprawne uprawnienia. 0710 = owner rwx, grupa --x (tylko przejscie,
# NIE ls), other brak - reszta zawartosci home (.ssh, .bashrc itp.)
# zostaje niewidoczna/nieosiagalna dla caddy, dostepny jest tylko
# swiadomie ustawiony podkatalog domains/.
chown "${USERNAME}:caddy" "$USER_HOME"
chmod 0710 "$USER_HOME"

USER_DOMAINS_DIR="${USER_HOME}/domains"
# /etc/skel moze zawierac pusty katalog "domains" (kopiowany przez
# useradd -m) - to juz jest dokladnie to, czego potrzebujemy (prawdziwy
# katalog), wystarczy poprawic wlasciciela/uprawnienia. Jesli zamiast
# katalogu jest tam (z jakiegos powodu, np. stary symlink sprzed tej
# poprawki) plik/symlink, usuwamy go i tworzymy od nowa jako katalog -
# to miejsce ma byc zawsze prawdziwym katalogiem, nigdy symlinkiem.
if [ -L "$USER_DOMAINS_DIR" ] || { [ -e "$USER_DOMAINS_DIR" ] && [ ! -d "$USER_DOMAINS_DIR" ]; }; then
  rm -f "$USER_DOMAINS_DIR"
fi
mkdir -p "$USER_DOMAINS_DIR"
chown "${USERNAME}:caddy" "$USER_DOMAINS_DIR"
chmod 0750 "$USER_DOMAINS_DIR"

echo "OK: utworzono konto ${USERNAME} (katalog domowy ${USER_HOME}, SSH haslo tymczasowe wymaga zmiany przy pierwszym logowaniu, katalog stron ${USER_SITE_DIR}, katalog na tresc stron ${USER_DOMAINS_DIR})"
