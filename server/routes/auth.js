import { Router } from 'express';
import {
  authenticateSystemUser,
  getAllowedUsers,
  issueSessionCookie,
  clearSessionCookie,
  verifySessionToken,
  SESSION_COOKIE
} from '../services/auth.js';

const router = Router();

const attempts = new Map();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 5 * 60 * 1000;

const MIN_FAILED_LOGIN_MS = 5000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function padFailure(startedAt) {
  const elapsed = Date.now() - startedAt;
  if (elapsed < MIN_FAILED_LOGIN_MS) await sleep(MIN_FAILED_LOGIN_MS - elapsed);
}

function isRateLimited(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

router.post('/login', async (req, res) => {
  const startedAt = Date.now();
  const { username, password } = req.body || {};

  if (getAllowedUsers().length === 0) {
    return res.status(503).json({ error: 'Logowanie wylaczone - AUTH_USERS nie jest ustawiony' });
  }

  if (isRateLimited(req.ip)) {
    return res.status(429).json({ error: 'Zbyt wiele prob logowania - sprobuj ponownie za kilka minut' });
  }

  const ok = await authenticateSystemUser(username, password);
  if (!ok) {
    await padFailure(startedAt);
    return res.status(401).json({ error: 'Nieprawidlowy uzytkownik lub haslo' });
  }

  issueSessionCookie(res, username);
  res.json({ success: true, username });
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

router.get('/status', (req, res) => {
  const authRequired = getAllowedUsers().length > 0;
  const token = req.cookies?.[SESSION_COOKIE];
  const payload = token ? verifySessionToken(token) : null;
  res.json({ authRequired, username: payload?.username || null });
});

export default router;
