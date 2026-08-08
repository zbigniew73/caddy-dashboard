import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data');
const CONFIG_PATH = path.join(DATA_DIR, 'turnstile-config.json');

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return { siteKey: '', secretKey: '', enabled: false };
  }
}

function saveConfig(config) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

function getPublicConfig() {
  const { siteKey, enabled } = loadConfig();
  return { configured: Boolean(siteKey), enabled: Boolean(enabled), siteKey: siteKey || '' };
}

function saveKeys(siteKey, secretKey) {
  if (!siteKey || !secretKey) {
    throw Object.assign(new Error('Site key i Secret key sa wymagane'), { status: 400 });
  }
  saveConfig({ siteKey, secretKey, enabled: loadConfig().enabled });
}

function setEnabled(enabled) {
  const current = loadConfig();
  if (enabled && !current.siteKey) {
    throw Object.assign(new Error('Najpierw skonfiguruj i zweryfikuj klucze Turnstile'), { status: 400 });
  }
  saveConfig({ ...current, enabled: Boolean(enabled) });
}

function isEnabled() {
  return Boolean(loadConfig().enabled);
}

function getSecretKey() {
  return loadConfig().secretKey || '';
}

async function verifyWithCloudflare(secretKey, token, remoteip) {
  if (!secretKey || !token) {
    throw Object.assign(new Error('Brak secret key lub tokenu do weryfikacji'), { status: 400 });
  }
  const params = new URLSearchParams();
  params.set('secret', secretKey);
  params.set('response', token);
  if (remoteip) params.set('remoteip', remoteip);

  let res;
  try {
    res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
  } catch (e) {
    throw Object.assign(new Error(`Nie udalo sie polaczyc z Cloudflare: ${e.message}`), { status: 502 });
  }
  return res.json();
}

export { getPublicConfig, saveKeys, setEnabled, isEnabled, getSecretKey, verifyWithCloudflare };
