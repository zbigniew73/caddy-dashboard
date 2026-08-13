#!/usr/bin/env bash
#
# Tworzy uzytkownika systemowego dla konta hostingowego - z prawdziwym
# dostepem SSH (powloka bash), katalogiem domowym pod wskazanym punktem
# montowania (<home_base_dir>/<username>) i dostepem do wspoldzielonego
# katalogu na konfiguracje domen Caddy w /etc/caddy/sites (plaska
# struktura, patrz nizej). Limit dysku
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
# Katalog stron: PLASKI /etc/caddy/sites (owner=root, group=caddy, 0751) -
# Caddy (dziala jako caddy:caddy) czyta stamtad *.caddy przez
# `import /etc/caddy/sites/*.caddy` w glownym Caddyfile (patrz install.sh) -
# Caddy `import` dopuszcza TYLKO JEDEN wildcard w calym wzorcu, wiec nie ma
# tu podkatalogow per-konto. Kazdy plik <domena>.caddy (tworzony pozniej
# przez flow "dodaj strone", patrz hosting-user-site.sh) nalezy do
# <username>:caddy, 0640 - to WYSTARCZA do izolacji tresci miedzy kontami
# (uprawnienia PLIKU, nie katalogu). Nazwa domeny jest globalnie unikalna
# (wymuszane w hostingUserSites.js), wiec plaska nazwa <domena>.caddy nigdy
# nie koliduje miedzy kontami. Top-level /etc/caddy/sites ma o+x BEZ o+r,
# zeby zaden user nie zrobil `ls` i nie zobaczyl cudzych domen/nazw kont.
#
# ~/domains: PRAWDZIWY katalog na dysku (nie symlink) - user
# laczacy sie po SSH/SFTP ma tu wrzucac realne pliki swoich stron. Wczesniejsza
# wersja robila to jako symlink w strone /etc/caddy/sites/<username>
# (katalog na KONFIGI Caddy, *.caddy), co bylo mylace - user zamiast
# plikow strony widzial config Caddy'ego. Config zostaje w SITES_BASE_DIR
# (patrz wyzej), zarzadzany przez panel/root, nie przez usera.
#
# Uklad uprawnien PONIZEJ = DirectAdmin-style: Caddy NIE jest w zadnej
# grupie z userem (usunieta grupa "caddy" na katalogach z tresc stron -
# grupa caddy zostaje TYLKO na plikach *.caddy w SITES_BASE_DIR, patrz
# wyzej, to inny mechanizm). Zamiast tego wszystko idzie na uprawnienia
# "other" (Caddy jest tu zwyklym "other", nie ma zadnego uprzywilejowania):
# ~/home, ~/domains i ~/domains/<domena> maja o+x BEZ o+r (0711,
# execute-only = przejscie, ale bez `ls`), a dopiero
# ~/domains/<domena>/public ma o+r (0755, patrz hosting-user-site.sh) -
# to jest jedyny katalog naprawde czytelny/serwowalny z zewnatrz. Domyslny
# umask (022) na koncie usera sam nadaje nowym plikom/podkatalogom
# wgrywanym przez SSH/SFTP prawa "other read/execute" - w odroznieniu od
# poprzedniego modelu (grupa caddy + SGID) NIE trzeba juz nic
# wymuszac/dziedziczyc rekurencyjnie.
#
# ~/tmp: kontowy (NIE per-strona) prywatny katalog robocze usera - istnieje
# juz po `useradd -m` (kopiowany z /etc/skel), tu tylko naprawiamy
# wlasciciela/uprawnienia na 0700 <username>:<username> (wylacznie
# wlasciciel, zaden dostep dla "other"/Caddy - to NIE jest katalog
# serwowany).
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

# Katalog jest wspoldzielony przez wszystkie konta (plaska struktura, patrz
# komentarz na gorze pliku) - tworzony/naprawiany idempotentnie przy kazdym
# zakladaniu konta, na wypadek gdyby admin recznie reinstalowal Caddy.
mkdir -p "$SITES_BASE_DIR"
chown root:caddy "$SITES_BASE_DIR"
chmod 0751 "$SITES_BASE_DIR"

USER_HOME="${HOME_BASE_DIR}/${USERNAME}"

# Katalog domowy sam w sobie musi dawac "other" (Caddy nie jest w zadnej
# grupie z userem w tym modelu) prawo PRZEJSCIA (bez odczytu/listowania) -
# inaczej Caddy nie dotrze do domains/<domena>/public ponizej, nawet
# jesli TE podkatalogi maja poprawne uprawnienia. 0711 = owner rwx,
# grupa/other --x (tylko przejscie, NIE ls) - reszta zawartosci home
# (.ssh, .bashrc, tmp/ itp.) zostaje niewidoczna/nieosiagalna dla
# Caddy/innych userow, dostepny jest tylko swiadomie ustawiony podkatalog
# domains/.
chown "${USERNAME}:${USERNAME}" "$USER_HOME"
chmod 0711 "$USER_HOME"

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
chown "${USERNAME}:${USERNAME}" "$USER_DOMAINS_DIR"
chmod 0711 "$USER_DOMAINS_DIR"

USER_TMP_DIR="${USER_HOME}/tmp"
# Tak samo jak domains/ wyzej - /etc/skel go juz kopiuje (useradd -m),
# tu tylko naprawiamy wlasciciela/uprawnienia (i typ, na wypadek starego
# symlinku/pliku o tej nazwie).
if [ -L "$USER_TMP_DIR" ] || { [ -e "$USER_TMP_DIR" ] && [ ! -d "$USER_TMP_DIR" ]; }; then
  rm -f "$USER_TMP_DIR"
fi
mkdir -p "$USER_TMP_DIR"
chown "${USERNAME}:${USERNAME}" "$USER_TMP_DIR"
chmod 0700 "$USER_TMP_DIR"

echo "OK: utworzono konto ${USERNAME} (katalog domowy ${USER_HOME}, SSH haslo tymczasowe wymaga zmiany przy pierwszym logowaniu, katalog stron ${SITES_BASE_DIR}, katalog na tresc stron ${USER_DOMAINS_DIR})"
