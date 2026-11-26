import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandlers, loadSamples } from '../lib/handlers.js';
import { fakeClient } from './fake-client.js';

const passages = [{ id: 'P1', start: 0, text: 'Let b be deceleration.' }, { id: 'P2', start: 760, text: 'With final speed zero, d is u square by 2 b.' }];

test('no key: config says not ready, ask refuses (no canned answer)', async () => {
  const h = createHandlers({ client: null });
  assert.equal(h.config().json.ready, false);
  const r = await h.ask({ mode: 'video', videoId: 'T7el7XL1aK8', question: 'why?' }, 'a');
  assert.equal(r.status, 503); assert.equal(r.json.error, 'not_configured'); assert.equal(r.json.answer, undefined);
});

test('samples: lecture 2 ready (video), load distribution not ready', () => {
  const s = loadSamples();
  const a = s.find(x => x.id === 'vd-lec02-longitudinal'), b = s.find(x => x.id === 'vd-load-distribution');
  assert.equal(a.videoId, 'T7el7XL1aK8'); assert.equal(a.ready, true); assert.equal(a.hasTranscript, false);
  assert.equal(b.ready, false);
});

test('video ask sends YouTube fileData + clip and maps relative moments', async () => {
  const c = fakeClient(); const h = createHandlers({ client: c, samples: [] });
  const r = await h.ask({ mode: 'video', videoId: 'T7el7XL1aK8', stuckAt: '12:40', question: 'Why did the professor drop that term here?' }, 'b');
  assert.equal(r.status, 200);
  const part = c.calls[0].contents[0].parts[0];
  assert.equal(part.fileData.fileUri, 'https://www.youtube.com/watch?v=T7el7XL1aK8');
  assert.deepEqual(part.videoMetadata, { startOffset: '520s', endOffset: '820s' });
  assert.match(c.calls[0].contents[0].parts[1].text, /paused the lecture at 12:40/);
  assert.equal(r.json.kind, 'video'); assert.equal(r.json.moments.length, 1);
  assert.equal(r.json.moments[0].sec, 520 + 200); // 03:20 is inside the clip length → relative
});

test('video failure is reported as video_failed', async () => {
  const h = createHandlers({ client: fakeClient({ failVideo: true }), samples: [] });
  const r = await h.ask({ mode: 'video', videoId: 'T7el7XL1aK8', question: 'q' }, 'c');
  assert.equal(r.status, 502); assert.equal(r.json.error, 'video_failed');
});

test('transcript ask keeps only real passage ids', async () => {
  const c = fakeClient(); const h = createHandlers({ client: c, samples: [] });
  const r = await h.ask({ mode: 'transcript', passages, stuckAt: 765, question: 'why u square?' }, 'd');
  assert.equal(r.status, 200); assert.deepEqual(r.json.cites, ['P2']); assert.equal(r.json.supported, true);
  assert.match(c.calls[0].contents[0].parts[0].text, /passage playing then is P2/);
  assert.equal(c.calls[0].contents[0].parts.some(p => p.fileData), false);
});

test('test endpoint for both modes', async () => {
  const h = createHandlers({ client: fakeClient(), samples: [] });
  const t1 = await h.test({ mode: 'transcript', passages, cites: ['P2'], question: 'q', answer: 'a' }, 'e');
  assert.equal(t1.json.question, 'TEST-Q transcript'); assert.deepEqual(t1.json.cites, ['P2']);
  const t2 = await h.test({ mode: 'video', videoId: 'T7el7XL1aK8', at: 760, question: 'q', answer: 'a' }, 'e');
  assert.equal(t2.json.question, 'TEST-Q video'); assert.ok(t2.json.moment);
});

test('rejects bad video ids and empty questions', async () => {
  const h = createHandlers({ client: fakeClient(), samples: [] });
  assert.equal((await h.ask({ mode: 'video', videoId: 'x', question: 'q' }, 'f')).status, 400);
  assert.equal((await h.ask({ mode: 'video', videoId: 'T7el7XL1aK8', question: '  ' }, 'f')).status, 400);
});

test('routes: transcript + recall use Gemma 4 26B (no JSON mode); video uses Gemini 3.8 Flash', async () => {
  const c = fakeClient(); const h = createHandlers({ client: c, samples: [] });
  const a = await h.ask({ mode: 'transcript', passages, question: 'q' }, 'm');
  await h.test({ mode: 'transcript', passages, cites: ['P2'], question: 'q', answer: 'a' }, 'm');
  await h.ask({ mode: 'video', videoId: 'T7el7XL1aK8', question: 'q' }, 'm');
  assert.deepEqual(c.calls.map(r => r.model), ['gemma-4-26b-a4b-it', 'gemma-4-26b-a4b-it', 'gemini-3.8-flash']);
  assert.equal(c.calls[0].config.responseMimeType, undefined);
  assert.equal(c.calls[2].config.responseMimeType, 'application/json');
  assert.equal(a.json.model, 'gemma-4-26b-a4b-it');
  assert.deepEqual(h.config().json.models, { text: 'gemma-4-26b-a4b-it', video: 'gemini-3.8-flash' });
});
