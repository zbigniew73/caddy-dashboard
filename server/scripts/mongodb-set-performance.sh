#!/usr/bin/env bash
#
# Ustawia parametry wydajnosci MongoDB (WiredTiger cache size w GB, max
# connections, tryb profilera) edytujac bezpiecznie /etc/mongod.conf (YAML)
# przez python3 + PyYAML, zeby nie uszkodzic reszty istniejacej konfiguracji
# (dbPath, port, security.authorization itd.). Restartuje usluge i
# weryfikuje ze dziala; przy niepowodzeniu przywraca poprzedni plik.
#
# Trzy linie na stdin: CACHE_SIZE_GB, MAX_CONNECTIONS, PROFILER_MODE (off|slowOp)

set -uo pipefail

CONF="/etc/mongod.conf"

err() { echo "BLAD: $*" >&2; exit 1; }

read -r CACHE_SIZE_GB
read -r MAX_CONNECTIONS
read -r PROFILER_MODE

dnf install -y python3-pyyaml >/dev/null 2>&1 || err "Nie udalo sie zainstalowac python3-pyyaml (wymagane do bezpiecznej edycji ${CONF})."

[ -f "$CONF" ] || err "Nie znaleziono ${CONF} - czy MongoDB jest zainstalowana?"

BACKUP="${CONF}.bak-$(date +%Y%m%d%H%M%S)"
cp -p "$CONF" "$BACKUP" || err "Nie udalo sie zrobic backupu ${CONF}."

if ! python3 - "$CACHE_SIZE_GB" "$MAX_CONNECTIONS" "$PROFILER_MODE" "$CONF" <<'PYEOF'
import sys
import yaml

cache_gb, max_conn, profiler_mode, conf_path = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

with open(conf_path) as f:
    conf = yaml.safe_load(f) or {}

conf.setdefault('storage', {}).setdefault('wiredTiger', {}).setdefault('engineConfig', {})['cacheSizeGB'] = float(cache_gb)
conf.setdefault('net', {})['maxIncomingConnections'] = int(max_conn)
conf.setdefault('operationProfiling', {})['mode'] = profiler_mode

with open(conf_path, 'w') as f:
    yaml.safe_dump(conf, f, default_flow_style=False, sort_keys=False)
PYEOF
then
  cp -p "$BACKUP" "$CONF"
  err "Edycja ${CONF} (python3/PyYAML) nie powiodla sie - przywrocono poprzednia konfiguracje."
fi

if ! systemctl restart mongod 2>/tmp/mongodb-perf.err; then
  ERR_MSG="$(cat /tmp/mongodb-perf.err 2>/dev/null)"
  rm -f /tmp/mongodb-perf.err
  cp -p "$BACKUP" "$CONF"
  systemctl restart mongod >/dev/null 2>&1 || true
  err "Restart mongod z nowa konfiguracja nie powiodl sie: ${ERR_MSG} - przywrocono poprzednia konfiguracje."
fi
rm -f /tmp/mongodb-perf.err

LIVE=""
for _ in 1 2 3 4 5; do
  if systemctl is-active --quiet mongod; then
    LIVE=1
    break
  fi
  sleep 1
done

if [ -z "$LIVE" ]; then
  cp -p "$BACKUP" "$CONF"
  systemctl restart mongod >/dev/null 2>&1 || true
  err "mongod nie dziala poprawnie po restarcie z nowa konfiguracja - przywrocono poprzednia konfiguracje."
fi

echo "OK: konfiguracja wydajnosci MongoDB zapisana, usluga zrestartowana i dziala."
