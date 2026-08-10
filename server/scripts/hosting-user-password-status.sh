#!/usr/bin/env bash
#
# Sprawdza, czy dane konto hostingowe MUSI zmienic haslo przy nastepnym
# logowaniu (shadow(5): data ostatniej zmiany hasla = 0 - dokladnie ten
# stan ustawia `chage -d 0` w hosting-account-create.sh po utworzeniu
# konta). Uzywane przez panel klienta (/user/), zeby wymusic ekran zmiany
# hasla zamiast Dashboardu. Nic nie zmienia, tylko odczytuje stan.
#
# Uzycie: hosting-user-password-status.sh <username>
# Wypisuje na stdout: MUST_CHANGE albo OK

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

LASTCHG_LINE="$(LC_ALL=C chage -l "$USERNAME" | grep -i '^Last password change')"
if echo "$LASTCHG_LINE" | grep -qi 'must be changed'; then
  echo "MUST_CHANGE"
else
  echo "OK"
fi
