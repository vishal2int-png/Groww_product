// Server-only Gemini key management.
// Source of truth: the GEMINI_API_KEY environment variable. On hosts with a writable disk the key can also be
// updated at runtime (admin page or `npm run set-key`); it is then written to the git-ignored .env file and
// hot-swapped without a restart. The key is never sent to the browser — only whether it is set and its last 4 chars.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { makeClient, TEXT_MODEL, VIDEO_MODEL } from './gemini.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ENV_FILE = process.env.LECTURELOOP_ENV_FILE || path.join(ROOT, '.env');

// Read KEY=value lines from .env into process.env (only keys not already set by the host).
export function loadEnvFile(file = ENV_FILE) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (!m) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

const fromHost = process.env.GEMINI_API_KEY ? 'environment variable' : null;
let current = { key: process.env.GEMINI_API_KEY || '', source: fromHost, updatedAt: null };
let client = null;

export function init() {
  const env = loadEnvFile();
  for (const [k, v] of Object.entries(env)) if (process.env[k] == null) process.env[k] = v;
  if (!current.key && env.GEMINI_API_KEY) current = { key: env.GEMINI_API_KEY, source: '.env file', updatedAt: fileTime() };
  client = makeClient(current.key);
  return status();
}
const fileTime = () => { try { return fs.statSync(ENV_FILE).mtime.toISOString(); } catch { return null; } };

export const getClient = () => client;
export const isPlatformManaged = () => !!(process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);

export function status() {
  return {
    configured: !!current.key, source: current.source, last4: current.key ? current.key.slice(-4) : null,
    updatedAt: current.updatedAt, model: TEXT_MODEL, videoModel: VIDEO_MODEL,
    canUpdateHere: !isPlatformManaged(),
    platform: process.env.VERCEL ? 'vercel' : process.env.NETLIFY ? 'netlify' : 'node',
  };
}

export const looksLikeKey = k => typeof k === 'string' && /^[A-Za-z0-9_.\-]{30,200}$/.test(k.trim()); // AIza… and AQ.… formats

// Live check: a tiny text request with the candidate key. Throws on failure.
export async function testKey(key, make = makeClient) {
  const c = make(key);
  try {
    const r = await c.models.generateContent({ model: TEXT_MODEL, contents: [{ role: 'user', parts: [{ text: 'Reply with the single word OK.' }] }], config: { temperature: 0 } });
    return { ok: true, sample: String(r.text || '').trim().slice(0, 20) };
  } catch (e) {
    if (/503|UNAVAILABLE|high demand|overloaded|NOT_FOUND|404/i.test(String(e && (e.message || e)))) {
      const r = await c.models.generateContent({ model: 'gemini-2.5-flash', contents: [{ role: 'user', parts: [{ text: 'Reply with the single word OK.' }] }], config: { temperature: 0 } });
      return { ok: true, sample: String(r.text || '').trim().slice(0, 20) };
    }
    throw e;
  }
}

// Persist to .env (replace or add the GEMINI_API_KEY line; other lines kept) and hot-swap the client.
export function saveKey(key) {
  key = key.trim();
  let lines = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/) : [];
  let found = false;
  lines = lines.map(l => /^\s*GEMINI_API_KEY\s*=/.test(l) ? (found = true, `GEMINI_API_KEY=${key}`) : l);
  if (!found) lines.unshift(`GEMINI_API_KEY=${key}`);
  const tmp = ENV_FILE + '.tmp';
  fs.writeFileSync(tmp, lines.join('\n').replace(/\n*$/, '\n'), { mode: 0o600 });
  fs.renameSync(tmp, ENV_FILE);
  apply(key, '.env file');
  return status();
}
export function apply(key, source) {
  process.env.GEMINI_API_KEY = key;
  current = { key, source, updatedAt: new Date().toISOString() };
  client = makeClient(key);
}

// Pick up edits made by `npm run set-key` (or by hand) while the server runs.
export function watchEnvFile() {
  if (isPlatformManaged()) return;
  fs.watchFile(ENV_FILE, { interval: 2000 }, () => {
    const k = loadEnvFile().GEMINI_API_KEY;
    if (k && k !== current.key && current.source !== 'environment variable') apply(k, '.env file');
  });
}

// ---------- admin auth ----------
export function adminEnabled() { return !!(process.env.ADMIN_TOKEN && process.env.ADMIN_TOKEN.length >= 12); }
export function checkAdmin(header) {
  if (!adminEnabled()) return false;
  const got = String(header || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(crypto.createHash('sha256').update(got).digest('hex')), b = Buffer.from(crypto.createHash('sha256').update(process.env.ADMIN_TOKEN).digest('hex'));
  return crypto.timingSafeEqual(a, b);
}
