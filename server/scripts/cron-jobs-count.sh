#!/usr/bin/env bash
#
# Zlicza WSZYSTKIE zaplanowane zadania cron na calym serwerze - kazdy
# systemowy user z wlasnym crontabem (/var/spool/cron/<user>, standardowa
# lokalizacja na AlmaLinux/Rocky). Kafelek "Ilosc wszystkich zadan cron"
# w karcie uslugi CRON w panelu admina. Kazdy plik w /var/spool/cron/
# nalezy do jednego usera i jest czytelny tylko dla roota/tego usera
# (0600), std sudo.
#
# NIE liczy /etc/crontab ani /etc/cron.d/* (systemowe zadania w innym
# formacie) - tylko crontaby userow. To jednoczesnie dokladnie to, co
# widac/edytuje sie przez `crontab -e`/`crontab -u` i to, czym zarzadza
# panel klienta (server/services/hostingUserCron.js).
#
# Liczymy linie, ktore NIE sa komentarzem (#...), NIE sa puste i NIE sa
# przypisaniem zmiennej srodowiskowej crontaba (SHELL=, PATH=, MAILTO=
# itp.) - dziala to zarowno dla recznych wpisow jak i dla zadan
# zarzadzanych przez panel klienta (kazde takie zadanie to komentarz-
# znacznik + jedna linia harmonogram+polecenie - liczy sie tylko ta
# druga linia).
#
# Uzycie: cron-jobs-count.sh (bez argumentow)

set -euo pipefail

SPOOL_DIR="/var/spool/cron"
COUNT=0

if [ -d "$SPOOL_DIR" ]; then
  for f in "$SPOOL_DIR"/*; do
    [ -f "$f" ] || continue
    while IFS= read -r line || [ -n "$line" ]; do
      trimmed="$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
      [ -z "$trimmed" ] && continue
      case "$trimmed" in
        \#*) continue ;;
        [A-Za-z_]*=*) continue ;;
      esac
      COUNT=$((COUNT + 1))
    done < "$f"
  done
fi

echo "$COUNT"
