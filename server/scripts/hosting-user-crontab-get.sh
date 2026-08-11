#!/usr/bin/env bash
#
# Zwraca surowa tresc crontaba konta hostingowego (self-service z panelu
# klienta, /user/ - Cron). Panel dziala jako osobny user serwisowy, nie ma
# wiec prawa czytac cudzego crontaba (/var/spool/cron/<user>, 0600) -
# std sudo, root czyta go przez `crontab -u`.
#
# Brak crontaba dla danego usera to normalny stan (nowe konto), nie blad -
# `crontab -u <user> -l` wtedy zwraca kod 1 i tekst na stderr, co tu
# tlumaczymy na pusty wynik / kod 0.
#
# Uzycie: hosting-user-crontab-get.sh <username>

set -euo pipefail

USERNAME="${1:-}"

if ! [[ "$USERNAME" =~ ^srv_[0-9]+$ ]]; then
  echo "BLAD: nieprawidlowa nazwa uzytkownika: '${USERNAME}'" >&2
  exit 1
fi
if ! id -u "$USERNAME" >/dev/null 2>&1; then
  echo "BLAD: uzytkownik '${USERNAME}' nie istnieje." >&2
  exit 1
fi

crontab -u "$USERNAME" -l 2>/dev/null || true
