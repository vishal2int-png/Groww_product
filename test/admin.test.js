import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'll-'));
process.env.LECTURELOOP_ENV_FILE = path.join(dir, '.env');
fs.writeFileSync(process.env.LECTURELOOP_ENV_FILE, 'OTHER=keep\nGEMINI_API_KEY=OLDKEY_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1111\n');
delete process.env.GEMINI_API_KEY; delete process.env.VERCEL;
const K = await import('../lib/keystore.js');
const { createHandlers } = await import('../lib/handlers.js');
const { fakeClient } = await import('./fake-client.js');

const GOOD = 'NEWKEY_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2222', BAD = 'REJECT_cccccccccccccccccccccccccccccccc3333';
const makeClient = key => key === BAD ? { models: { generateContent: async () => { throw new Error('API key not valid. PERMISSION_DENIED'); } } } : fakeClient();
const h = createHandlers({ samples: [], makeClient });

test('loads key from .env and never exposes it', () => {
  const s = K.init();
  assert.equal(s.configured, true); assert.equal(s.source, '.env file'); assert.equal(s.last4, '1111');
  assert.ok(!JSON.stringify(h.config()).includes('OLDKEY'));
});

test('admin is off without ADMIN_TOKEN, and needs the right token', async () => {
  delete process.env.ADMIN_TOKEN;
  assert.equal(h.adminStatus('Bearer x', '1').status, 403);
  process.env.ADMIN_TOKEN = 'correct-horse-battery';
  assert.equal(h.adminStatus('Bearer wrong', '1').status, 401);
  const ok = h.adminStatus('Bearer correct-horse-battery', '1');
  assert.equal(ok.status, 200); assert.ok(!JSON.stringify(ok.json).includes('OLDKEY'));
});

test('rejected key is not saved; good key is saved and hot-swapped', async () => {
  const auth = 'Bearer correct-horse-battery';
  const r1 = await h.adminSetKey(auth, { key: BAD }, '2');
  assert.equal(r1.status, 400); assert.match(fs.readFileSync(process.env.LECTURELOOP_ENV_FILE, 'utf8'), /OLDKEY/);
  assert.equal((await h.adminSetKey(auth, { key: 'short' }, '2')).status, 400);
  const before = K.getClient();
  const r2 = await h.adminSetKey(auth, { key: GOOD }, '2');
  assert.equal(r2.status, 200); assert.equal(r2.json.last4, '2222');
  const env = fs.readFileSync(process.env.LECTURELOOP_ENV_FILE, 'utf8');
  assert.match(env, /^GEMINI_API_KEY=NEWKEY/m); assert.match(env, /OTHER=keep/); assert.doesNotMatch(env, /OLDKEY/);
  assert.notEqual(K.getClient(), before);
});

test('platform-managed hosts get instructions instead of a write', async () => {
  process.env.VERCEL = '1';
  const r = await h.adminSetKey('Bearer correct-horse-battery', { key: GOOD }, '3');
  assert.equal(r.status, 409); assert.equal(r.json.error, 'platform_managed');
  delete process.env.VERCEL;
});

test('accepts both key formats (AIza… and AQ.…), rejects junk', () => {
  assert.equal(K.looksLikeKey('AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE12'), true);
  assert.equal(K.looksLikeKey('AQ.FakeFormatOnly_abcdefghijklmnopqrstuvwxyz-0123456789'), true);
  assert.equal(K.looksLikeKey('not a key'), false);
  assert.equal(K.looksLikeKey('AQ.short'), false);
});
