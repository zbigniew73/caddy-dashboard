import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data');
const CONFIG_PATH = path.join(DATA_DIR, 'roundcube.json');

// Panel glowny (nie Runtime Manager) trzyma jedyny zapis tego, jakiej
// domeny admin uzyl przy instalacji Roundcube i czy bramka Turnstile jest
// wlaczona - dokladnie ten sam wzorzec pliku co phpmyadmin-gate.json.
// Runtime Manager (instalacja samego Roundcube/PHP-FPM) NIC nie wie o
// domenie ani o Caddy - to wylacznie sprawa panelu glownego
// (roundcubeSite.js), zeby nie dublowac odpowiedzialnosci miedzy dwoma
// procesami.
function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return { domain: null, gateEnabled: false };
  }
}

function saveConfig(config) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

function getRoundcubeConfig() {
  const config = loadConfig();
  return { domain: config.domain || null, gateEnabled: Boolean(config.gateEnabled) };
}

function setRoundcubeConfig({ domain, gateEnabled }) {
  const current = loadConfig();
  const next = {
    domain: domain !== undefined ? domain : (current.domain || null),
    gateEnabled: gateEnabled !== undefined ? Boolean(gateEnabled) : Boolean(current.gateEnabled)
  };
  saveConfig(next);
  return next;
}

function clearRoundcubeConfig() {
  saveConfig({ domain: null, gateEnabled: false });
}

export { getRoundcubeConfig, setRoundcubeConfig, clearRoundcubeConfig };
