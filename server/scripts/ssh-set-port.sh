#!/usr/bin/env bash
#
# Bezpieczna zmiana portu SSH: backup, edycja, test skladni, otwarcie nowego
# portu w firewalld, restart sshd, weryfikacja nasluchiwania - dopiero potem
# zamkniecie starego portu. Kazdy blad -> rollback do poprzedniej konfiguracji.

set -uo pipefail

SSHD_CONFIG="/etc/ssh/sshd_config"
SSHD_SERVICE="sshd.service"
NEW_PORT="${1:-}"

err() { echo "BLAD: $*" >&2; exit 1; }

[[ "$NEW_PORT" =~ ^[0-9]+$ ]] || err "Nieprawidlowy port: '${NEW_PORT}'"
[ "$NEW_PORT" -ge 1 ] && [ "$NEW_PORT" -le 65535 ] || err "Port poza zakresem 1-65535: ${NEW_PORT}"

CURRENT_PORT="$(grep -E '^Port[[:space:]]+[0-9]+' "$SSHD_CONFIG" 2>/dev/null | tail -1 | awk '{print $2}')"
CURRENT_PORT="${CURRENT_PORT:-22}"

if [ "$NEW_PORT" = "$CURRENT_PORT" ]; then
  echo "OK: port juz ustawiony na ${NEW_PORT} - nic do zrobienia."
  exit 0
fi

open_port() {
  local port="$1"
  if [ "$port" = "22" ]; then
    firewall-cmd --permanent --add-service=ssh >/dev/null 2>&1
  else
    firewall-cmd --permanent --add-port="${port}/tcp" >/dev/null 2>&1
  fi
}

close_port_best_effort() {
  local port="$1"
  if [ "$port" = "22" ]; then
    firewall-cmd --permanent --remove-service=ssh >/dev/null 2>&1 || true
  fi
  firewall-cmd --permanent --remove-port="${port}/tcp" >/dev/null 2>&1 || true
  firewall-cmd --reload >/dev/null 2>&1 || true
}

restore_backup() {
  cp -p "$BACKUP" "$SSHD_CONFIG"
  systemctl restart "$SSHD_SERVICE" >/dev/null 2>&1 || true
  close_port_best_effort "$NEW_PORT"
}

BACKUP="/etc/ssh/sshd_config.bak-$(date +%Y%m%d%H%M%S)"
cp -p "$SSHD_CONFIG" "$BACKUP" || err "Nie udalo sie zrobic backupu ${SSHD_CONFIG}."

if grep -qE '^Port[[:space:]]+[0-9]+' "$SSHD_CONFIG"; then
  sed -i -E "s/^Port[[:space:]]+[0-9]+/Port ${NEW_PORT}/" "$SSHD_CONFIG"
else
  echo "Port ${NEW_PORT}" >> "$SSHD_CONFIG"
fi

if ! sshd -t 2>/tmp/ssh-set-port.sshd-t.err; then
  ERR_MSG="$(cat /tmp/ssh-set-port.sshd-t.err 2>/dev/null)"
  cp -p "$BACKUP" "$SSHD_CONFIG"
  rm -f /tmp/ssh-set-port.sshd-t.err
  err "Nowa konfiguracja sshd nie przeszla testu skladni (sshd -t): ${ERR_MSG} - przywrocono backup."
fi
rm -f /tmp/ssh-set-port.sshd-t.err

if ! open_port "$NEW_PORT"; then
  cp -p "$BACKUP" "$SSHD_CONFIG"
  err "Nie udalo sie otworzyc portu ${NEW_PORT} w firewalld - przywrocono backup, sshd nie restartowany."
fi
firewall-cmd --reload >/dev/null 2>&1

if ! systemctl restart "$SSHD_SERVICE"; then
  restore_backup
  err "Restart sshd nie powiodl sie - przywrocono poprzedni port ${CURRENT_PORT}."
fi

LISTENING=""
for _ in 1 2 3 4 5; do
  if ss -tln 2>/dev/null | grep -q ":${NEW_PORT} "; then
    LISTENING=1
    break
  fi
  sleep 1
done

if [ -z "$LISTENING" ]; then
  restore_backup
  err "sshd nie nasluchuje na porcie ${NEW_PORT} po restarcie - przywrocono port ${CURRENT_PORT}."
fi

close_port_best_effort "$CURRENT_PORT"

echo "OK: port SSH zmieniony z ${CURRENT_PORT} na ${NEW_PORT}. Backup starej konfiguracji: ${BACKUP}."
