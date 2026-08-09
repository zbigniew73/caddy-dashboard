import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data');
const CONFIG_PATH = path.join(DATA_DIR, 'phpmyadmin-gate.json');

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return { enabled: false };
  }
}

function saveConfig(config) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

// Domyslnie WYLACZONE - "swiadoma decyzja" admina, wlaczenie phpMyAdmin
// samo w sobie NIE wlacza tej bramki automatycznie.
function isGateEnabled() {
  return Boolean(loadConfig().enabled);
}

function setGateEnabled(enabled) {
  saveConfig({ enabled: Boolean(enabled) });
}

export { isGateEnabled, setGateEnabled };
