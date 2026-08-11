#!/usr/bin/env bash
#
# Zlicza zaplanowane zadania cron NA UZYTKOWNIKA, dla kazdego systemowego
# usera z wlasnym crontabem (/var/spool/cron/<user>, standardowa
# lokalizacja na AlmaLinux/Rocky - plik nazywa sie tak samo jak user).
# Zrodlo kafelka "Ilosc wszystkich zadan cron" w karcie uslugi CRON w
# panelu admina - user chcial widziec ROZBICIE na konta (latwo wylapac
# konto z podejrzanie duza liczba zadan), nie tylko sume. Kazdy plik w
# /var/spool/cron/ nalezy do jednego usera i jest czytelny tylko dla
# roota/tego usera (0600), std sudo.
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
# Wyjscie: jedna linia na uzytkownika Z NIEZEROWA liczba zadan,
# format "<username> <liczba>" - liczacy w Node (server/services/cronJobs.js)
# sam sumuje/sortuje, zeby logika sortowania/prezentacji nie zyla w bashu.
#
# Uzycie: cron-jobs-count.sh (bez argumentow)

set -euo pipefail

SPOOL_DIR="/var/spool/cron"

if [ -d "$SPOOL_DIR" ]; then
  for f in "$SPOOL_DIR"/*; do
    [ -f "$f" ] || continue
    username="$(basename "$f")"
    count=0
    while IFS= read -r line || [ -n "$line" ]; do
      trimmed="$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
      [ -z "$trimmed" ] && continue
      case "$trimmed" in
        \#*) continue ;;
        [A-Za-z_]*=*) continue ;;
      esac
      count=$((count + 1))
    done < "$f"
    [ "$count" -gt 0 ] && echo "${username} ${count}"
  done
fi
