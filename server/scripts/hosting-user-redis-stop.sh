#!/usr/bin/env bash
#
# Zatrzymuje prywatna instancje Redis konta hostingowego (self-service z
# panelu klienta, /user/ - Redis). NIE kasuje configu/hasla - ponowne
# uruchomienie (hosting-user-redis-apply.sh) przywraca te sama instancje.
#
# Uzycie: hosting-user-redis-stop.sh <username>

set -euo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

USERNAME="${1:-}"
[[ "$USERNAME" =~ ^srv_[0-9]+$ ]] || err "Nieprawidlowa nazwa uzytkownika: '${USERNAME}'"

systemctl disable --now "cd-user-redis@${USERNAME}.service" 2>&1 || true

echo "OK: Redis dla ${USERNAME} zatrzymany."
