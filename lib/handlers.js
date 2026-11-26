// Request handlers shared by the Node server (server.js) and Vercel functions (api/*.js).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as G from './gemini.js';
import * as K from './keystore.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');

// ---------- samples ----------
const DEFAULT_SAMPLES = [
  {
    id: 'vd-lec02-longitudinal',
    title: 'Longitudinal Dynamics',
    videoTitle: 'Mod-01 Lec-02 Longitudinal Dynamics',
    course: 'Vehicle Dynamics',
    lecture: 'Lecture 2',
    lecturer: 'Dr. R. Krishnakumar',
    institute: 'IIT Madras',
    provider: 'NPTEL',
    channel: 'nptelhrd',
    videoUrl: 'https://www.youtube.com/watch?v=T7el7XL1aK8',
    sourceUrl: 'https://www.youtube.com/watch?v=T7el7XL1aK8',
    transcript: 'transcripts/T7el7XL1aK8.srt',
    requireTranscript: false,
  },
  {
    id: 'vd-load-distribution',
    title: 'Vehicle Load Distribution – Acceleration and Braking',
    course: 'Vehicle Dynamics',
    provider: 'NPTEL',
    videoUrl: null,
    sourceUrl: null,
    transcript: null,
    requireTranscript: true,
    note: 'Coming soon: waiting for the real video link and its timestamped transcript.',
  },
];

export function loadSamples() {
  const sFile = path.join(DATA, 'samples.json');
  const list = fs.existsSync(sFile) ? JSON.parse(fs.readFileSync(sFile, 'utf8')) : DEFAULT_SAMPLES;
  return list.map(s => {
    const vid = s.videoUrl ? (s.videoUrl.match(/[?&]v=([\w-]{11})/) || [])[1] : null;
    const tPath = s.transcript ? path.join(DATA, s.transcript) : null;
    const hasTranscript = !!(tPath && fs.existsSync(tPath) && fs.statSync(tPath).size > 0);
    // A sample is ready when its real video is known, and — if it requires one — its real transcript is present.
    const ready = !!vid && (hasTranscript || !s.requireTranscript);
    return { ...s, videoId: vid, hasTranscript, ready, _tPath: hasTranscript ? tPath : null };
  });
}
const publicSample = s => ({
  id: s.id, title: s.title, videoTitle: s.videoTitle, course: s.course, lecture: s.lecture, lecturer: s.lecturer,
  institute: s.institute, provider: s.provider, channel: s.channel, sourceUrl: s.sourceUrl, videoUrl: s.videoUrl,
  videoId: s.videoId, hasTranscript: s.hasTranscript, transcriptFormat: s.hasTranscript ? path.extname(s._tPath).slice(1) : null,
  ready: s.ready, note: s.note,
});

// ---------- simple per-IP rate limit (protects the shared key on a public demo) ----------
const hits = new Map();
function limited(ip, max = Number(process.env.RATE_LIMIT || 40), windowMs = 10 * 60 * 1000) {
  const now = Date.now(); const h = (hits.get(ip) || []).filter(t => now - t < windowMs);
  h.push(now); hits.set(ip, h); return h.length > max;
}

const bad = (status, error, message) => ({ status, json: { error, message } });

export function createHandlers({ client, getClient = client !== undefined ? () => client : K.getClient, samples = loadSamples(), keys = K, makeClient } = {}) {
  async function generate(req) {
    const res = await getClient().models.generateContent(req);
    return res.text || '';
  }

  return {
    config() {
      return { status: 200, json: { ready: !!getClient(), models: { text: G.TEXT_MODEL, video: G.VIDEO_MODEL }, samples: samples.map(publicSample) } };
    },

    sampleTranscript(id) {
      const s = samples.find(x => x.id === id);
      if (!s || !s._tPath) return bad(404, 'not_found', 'No transcript has been supplied for this sample.');
      return { status: 200, text: fs.readFileSync(s._tPath, 'utf8') };
    },

    async ask(body, ip = '') {
      if (!getClient()) return bad(503, 'not_configured', 'The answer service is not configured on this deployment (GEMINI_API_KEY is missing).');
      if (limited(ip)) return bad(429, 'rate_limited', 'Too many questions in a short time. Wait a few minutes and try again.');
      const question = String(body.question || '').trim().slice(0, 1000);
      if (!question) return bad(400, 'bad_request', 'Ask a question first.');
      const stuckAt = body.stuckAt == null || body.stuckAt === '' ? null : G.parseTime(body.stuckAt);
      const title = String(body.title || '').slice(0, 200), prior = String(body.prior || '').slice(0, 2000);

      if (body.mode === 'transcript') {
        const passages = G.cleanPassages(body.passages);
        if (!passages.length) return bad(400, 'bad_request', 'The transcript is empty.');
        try {
          const j = G.parseJSON(await generate(G.transcriptAskRequest({ passages, stuckAt, question, title, prior })));
          if (!j || typeof j.answer !== 'string') return bad(502, 'model_error', 'The model returned an unreadable answer. Try again.');
          const cites = G.validCites(passages, j.citations, j.answer);
          return { status: 200, json: { kind: 'transcript', model: G.TEXT_MODEL, supported: j.supported !== false && cites.length > 0, answer: j.answer.trim(), cites, step: String(j.step || '').trim() } };
        } catch (e) { return bad(502, 'model_error', errText(e)); }
      }

      if (!G.isVideoId(body.videoId)) return bad(400, 'bad_request', 'A valid YouTube video is needed.');
      try {
        const { win, request } = G.videoAskRequest({ videoId: body.videoId, stuckAt, question, title, prior });
        const j = G.parseJSON(await generate(request));
        if (!j || typeof j.answer !== 'string') return bad(502, 'video_failed', 'The video could not be analysed (no usable answer came back).');
        const moments = (Array.isArray(j.moments) ? j.moments : []).map(m => {
          const sec = G.toLectureTime(G.parseTime(m && m.time), win);
          return sec == null ? null : { sec, label: G.fmt(sec), what: String(m.what || '').slice(0, 120) };
        }).filter(Boolean).sort((a, b) => a.sec - b.sec).slice(0, 3);
        return { status: 200, json: { kind: 'video', model: G.VIDEO_MODEL, supported: j.supported !== false, answer: j.answer.trim(), moments, step: String(j.step || '').trim(), window: win } };
      } catch (e) { return bad(502, 'video_failed', errText(e)); }
    },

    async test(body, ip = '') {
      if (!getClient()) return bad(503, 'not_configured', 'The answer service is not configured on this deployment (GEMINI_API_KEY is missing).');
      if (limited(ip)) return bad(429, 'rate_limited', 'Too many requests in a short time. Wait a few minutes and try again.');
      const question = String(body.question || '').slice(0, 1000), answer = String(body.answer || '').slice(0, 2000), step = String(body.step || '').slice(0, 200), title = String(body.title || '').slice(0, 200);
      try {
        if (body.mode === 'transcript') {
          const passages = G.cleanPassages(body.passages);
          const cites = G.validCites(passages, body.cites, '');
          if (!cites.length) return bad(400, 'bad_request', 'No supporting passages for this step.');
          const j = G.parseJSON(await generate(G.transcriptTestRequest({ passages, cites, question, answer, step, title })));
          if (!j || !j.question) return bad(502, 'model_error', 'Could not write a question. Try again.');
          return { status: 200, json: { kind: 'transcript', question: String(j.question), answer: String(j.answer || ''), why: String(j.why || ''), cites: G.validCites(passages, j.citations, j.why) } };
        }
        if (!G.isVideoId(body.videoId)) return bad(400, 'bad_request', 'A valid YouTube video is needed.');
        const at = G.parseTime(body.at);
        const { win, request } = G.videoTestRequest({ videoId: body.videoId, at, question, answer, step, title });
        const j = G.parseJSON(await generate(request));
        if (!j || !j.question) return bad(502, 'video_failed', 'Could not write a question from the video. Try again.');
        const sec = G.toLectureTime(G.parseTime(j.time), win);
        return { status: 200, json: { kind: 'video', question: String(j.question), answer: String(j.answer || ''), why: String(j.why || ''), moment: sec == null ? null : { sec, label: G.fmt(sec) } } };
      } catch (e) { return bad(502, body.mode === 'transcript' ? 'model_error' : 'video_failed', errText(e)); }
    },

    // ---------- owner-only key management (ADMIN_TOKEN) ----------
    adminStatus(auth, ip = '') {
      const g = adminGate(auth, ip); if (g) return g;
      return { status: 200, json: keys.status() };
    },
    async adminTest(auth, body = {}, ip = '') {
      const g = adminGate(auth, ip); if (g) return g;
      const key = body.key ? String(body.key).trim() : process.env.GEMINI_API_KEY;
      if (!key) return bad(400, 'no_key', 'No key to test: none is configured and none was entered.');
      if (body.key && !keys.looksLikeKey(key)) return bad(400, 'bad_key', 'That doesn’t look like a Gemini API key.');
      try { const r = await keys.testKey(key, makeClient); return { status: 200, json: { ok: true, model: G.TEXT_MODEL, reply: r.sample } }; }
      catch (e) { return bad(400, 'key_failed', 'Gemini rejected this key or the call failed: ' + errText(e)); }
    },
    async adminSetKey(auth, body = {}, ip = '') {
      const g = adminGate(auth, ip); if (g) return g;
      const key = String(body.key || '').trim();
      if (!keys.looksLikeKey(key)) return bad(400, 'bad_key', 'That doesn’t look like a Gemini API key.');
      if (!keys.status().canUpdateHere) return bad(409, 'platform_managed', 'This host keeps environment variables in its dashboard. Update GEMINI_API_KEY there and redeploy (steps below).');
      try { await keys.testKey(key, makeClient); }
      catch (e) { return bad(400, 'key_failed', 'Not saved — Gemini rejected this key or the call failed: ' + errText(e)); }
      try { return { status: 200, json: { saved: true, ...keys.saveKey(key) } }; }
      catch (e) { return bad(500, 'save_failed', 'The key works, but it couldn’t be written to the server’s .env file (read-only disk?).'); }
    },
  };

  function adminGate(auth, ip) {
    if (!keys.adminEnabled()) return bad(403, 'admin_disabled', 'Key management is off. Set an ADMIN_TOKEN environment variable (12+ characters) on the server to enable it.');
    if (limited('admin:' + ip, 20)) return bad(429, 'rate_limited', 'Too many attempts. Wait a few minutes.');
    if (!keys.checkAdmin(auth)) return bad(401, 'unauthorized', 'Wrong admin token.');
    return null;
  }
}

function errText(e) {
  const m = String((e && (e.message || e.toString())) || '');
  if (/API key|PERMISSION_DENIED|401|403/i.test(m)) return 'The model service rejected the server’s credentials.';
  if (/quota|RESOURCE_EXHAUSTED|429/i.test(m)) return 'The model service is over its quota right now.';
  if (/private|unlisted|not.*(accessible|available)|INVALID_ARGUMENT/i.test(m)) return 'The video could not be processed. It may be private, unlisted, age-restricted or too long.';
  return 'The model service failed to respond.';
}
