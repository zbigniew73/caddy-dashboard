#!/usr/bin/env bash
#
# Zwraca sume czasu CPU (utime+stime, w TIKACH ZEGARA, pole 14/15 z
# /proc/<pid>/stat) wszystkich procesow konta hostingowego - realny
# licznik do liczenia biezacego zuzycia CPU roznicowo (delta miedzy
# dwoma probkami / czas), patrz komentarz w
# server/services/hostingUserSelf.js.
#
# Uzywa sudo/root CELOWO zamiast liczyc na to, ze serwisowy user panelu
# (cdadmin, nie root) ma prawo czytac /proc/<pid>/stat procesow NALEZACYCH
# DO INNEGO USERA - to zalezy od konfiguracji systemu (np. hidepid na
# /proc) i na jednym VPS moze dzialac, a na innym nie (`ps -o %cpu/rss`
# dziala bez sudo bo dostaje dane inna sciezka niz bezposredni odczyt
# /proc), wiec zamiast zgadywac idziemy tym samym sprawdzonym kanalem co
# reszta danych cross-user w tym projekcie (root przez sudo, jak
# hosting-account-disk-usage.sh / hosting-account-sites-count.sh).
#
# Uzycie: hosting-user-cpu-ticks.sh <username>

set -euo pipefail

USERNAME="${1:-}"

if ! [[ "$USERNAME" =~ ^srv_[0-9]+$ ]]; then
  echo "BLAD: nieprawidlowa nazwa uzytkownika: '${USERNAME}'" >&2
  exit 1
fi

TOTAL=0

for pid in $(ps -u "$USERNAME" --no-headers -o pid 2>/dev/null || true); do
  stat_line="$(cat "/proc/${pid}/stat" 2>/dev/null || true)"
  [ -z "$stat_line" ] && continue
  # Nazwa procesu (pole 2) jest w nawiasach i MOZE SAMA ZAWIERAC ")" -
  # pola licza sie dopiero PO OSTATNIM ")" w linii, std "##" (najdluzsze
  # dopasowanie od poczatku), nie "#" (najkrotsze). Pole 14 (utime) i 15
  # (stime) to wtedy indeksy 12 i 13 (awk liczy pola od 1).
  after_comm="${stat_line##*\)}"
  utime="$(echo "$after_comm" | awk '{print $12}')"
  stime="$(echo "$after_comm" | awk '{print $13}')"
  TOTAL=$((TOTAL + ${utime:-0} + ${stime:-0}))
done

echo "$TOTAL"
