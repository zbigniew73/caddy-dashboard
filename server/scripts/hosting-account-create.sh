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
# ~/domains -> /etc/caddy/sites/<username>: symlink w DRUGA strone niz
# mogloby sie wydawac naturalne - user edytuje swoje pliki z poziomu
# wlasnego home, ale to jego WLASNA powloka/SSH rozwiazuje ten symlink,
# wlasnymi uprawnieniami. Caddy nigdy nie dostaje zadnych praw do /home -
# unikamy w ten sposob przyznawania uslugi sieciowej dostepu do calego
# lancucha katalogow domowych.
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

useradd -m -b "$HOME_BASE_DIR" -s /bin/bash "$USERNAME"
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
USER_DOMAINS_LINK="${USER_HOME}/domains"
# /etc/skel moze zawierac pusty katalog "domains" (kopiowany przez
# useradd -m) - podmieniamy go na symlink, ale tylko jesli jest pusty;
# niepusty/nieoczekiwany stan zostawiamy nietkniety i po prostu nie
# tworzymy symlinka (nie kasujemy danych na sile).
if [ -e "$USER_DOMAINS_LINK" ] && [ ! -L "$USER_DOMAINS_LINK" ]; then
  rmdir "$USER_DOMAINS_LINK" 2>/dev/null || true
fi
if [ ! -e "$USER_DOMAINS_LINK" ] && [ ! -L "$USER_DOMAINS_LINK" ]; then
  ln -s "$USER_SITE_DIR" "$USER_DOMAINS_LINK"
  chown -h "${USERNAME}:${USERNAME}" "$USER_DOMAINS_LINK"
fi

echo "OK: utworzono konto ${USERNAME} (katalog domowy ${USER_HOME}, SSH haslo tymczasowe wymaga zmiany przy pierwszym logowaniu, katalog stron ${USER_SITE_DIR})"
