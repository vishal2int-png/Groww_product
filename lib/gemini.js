// Server-only. Builds Gemini requests for the two evidence sources and parses replies.
// The API key never leaves the server: it is read from process.env.GEMINI_API_KEY by the caller.
import { GoogleGenAI, MediaResolution } from '@google/genai';

// Text model: transcript answers, recall questions, key check. Gemma 4 26B served by the Gemini API.
export const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || process.env.GEMINI_MODEL || 'gemma-4-26b-a4b-it';
// Video model: YouTube-link questions. Kept on Gemini because the Gemini API documents YouTube video input for
// Gemini models; for Gemma 4 it documents text and image input only. Set GEMINI_VIDEO_MODEL to override.
export const VIDEO_MODEL = process.env.GEMINI_VIDEO_MODEL || 'gemini-3.8-flash';
export const MODEL = TEXT_MODEL;
const isGemma = m => /^gemma/i.test(m);
// Gemma replies are parsed from plain text (parseJSON tolerates code fences); JSON mode is requested only from Gemini.
const jsonConfig = (model, extra) => ({ ...(isGemma(model) ? {} : { responseMimeType: 'application/json' }), ...extra });

export function makeClient(apiKey = process.env.GEMINI_API_KEY) {
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
}

// ---------- helpers ----------
export const fmt = sec => {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60, p = n => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
};
export const parseTime = t => {
  if (typeof t === 'number') return t;
  const m = String(t || '').trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  return m ? (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) : null;
};
export function parseJSON(text) {
  const t = String(text || ''); const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}
const VIDEO_ID = /^[\w-]{11}$/;
export const watchUrl = id => `https://www.youtube.com/watch?v=${id}`;

const NOTATION = `Preserve the lecturer's notation and wording for symbols exactly (same variable names, subscripts and spoken forms). Do not rename variables.`;

// ---------- video evidence (Gemini YouTube video input) ----------
// Window of the lecture sent to the model when the student gives a time: a few minutes before, one after.
export function videoWindow(stuckAt) {
  if (stuckAt == null) return null;
  const start = Math.max(0, Math.floor(stuckAt - 240)), end = Math.floor(stuckAt + 60);
  return { start, end };
}
function videoPart(videoId, win) {
  const part = { fileData: { fileUri: watchUrl(videoId) } };
  if (win) part.videoMetadata = { startOffset: `${win.start}s`, endOffset: `${win.end}s` };
  return part;
}
// Model-reported moments may be relative to the clip; map them back onto the full lecture.
export function toLectureTime(sec, win) {
  if (sec == null || !win) return sec;
  const len = win.end - win.start;
  if (sec >= win.start - 30 && sec <= win.end + 30) return sec;
  if (sec <= len + 30) return win.start + sec;
  return sec;
}

export function videoAskRequest({ videoId, stuckAt, question, title, prior }) {
  const win = videoWindow(stuckAt);
  const where = stuckAt != null
    ? `The student paused the lecture at ${fmt(stuckAt)}. The attached clip covers ${fmt(win.start)}–${fmt(win.end)} of the full lecture. "Here" / "this step" means what is happening at or just before ${fmt(stuckAt)}.`
    : `The student did not give a time; find the part of the lecture the question is about.`;
  const text = `You are helping an engineering student revise the recorded lecture "${title || 'this lecture'}" (attached as video).
${where}
Answer ONLY from what the lecturer says, writes or shows in this video. Your answer is a paraphrase, not a quotation: do not put words in quotation marks or claim exact wording.
${NOTATION}
Keep it short: at most 3 sentences (80 words), plain text.
Give the moments in the FULL lecture (MM:SS or H:MM:SS) where the lecturer explains this. If the video does not explain it, set "supported" to false and say so in one sentence.
${prior ? `Earlier in this session:\n${prior}\n` : ''}
Student's question: ${question}

Reply with a single JSON object only, no other text:
{"supported": true|false, "answer": "...", "moments": [{"time": "MM:SS", "what": "a few words on what happens there"}], "step": "the step in at most 8 words, in the lecturer's notation"}`;
  return {
    win,
    request: {
      model: VIDEO_MODEL,
      contents: [{ role: 'user', parts: [videoPart(videoId, win), { text }] }],
      config: jsonConfig(VIDEO_MODEL, { temperature: 0.2, ...(win ? {} : { mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW }) }),
    },
  };
}

export function videoTestRequest({ videoId, at, question, answer, step, title }) {
  const win = at != null ? { start: Math.max(0, Math.floor(at - 150)), end: Math.floor(at + 90) } : null;
  const text = `From the attached lecture "${title || ''}"${win ? ` (clip ${fmt(win.start)}–${fmt(win.end)} of the full lecture)` : ''}, write ONE practice question on the same step the student just asked about.
Step: ${step || question}
Student's question: ${question}
Tutor's answer: ${answer}
The question must test understanding of this exact step (why it holds, or what changes if an assumption changes) and be answerable from what the lecturer explains. Not a recall-the-sentence question.
${NOTATION}
Question: one sentence. Answer: at most 2 sentences. "why": at most 2 sentences, paraphrased, no quotations.
Reply with a single JSON object only, no other text: {"question": "...", "answer": "...", "why": "...", "time": "MM:SS in the full lecture where this is explained"}`;
  return { win, request: { model: VIDEO_MODEL, contents: [{ role: 'user', parts: [videoPart(videoId, win), { text }] }], config: jsonConfig(VIDEO_MODEL, { temperature: 0.4 }) } };
}

// ---------- transcript evidence ----------
const STOP = new Set('the a an and or of to in is it that this we you i be for on as are with by at so if then from can will what why how which there here have has was were do does not but its they our your'.split(' '));
const toks = s => (s.toLowerCase().match(/[a-z0-9]+/g) || []).filter(t => !STOP.has(t));
function rank(ps, q, k) {
  const docs = ps.map(p => toks(p.text)), N = docs.length, avg = docs.reduce((a, d) => a + d.length, 0) / Math.max(N, 1), df = {};
  docs.forEach(d => new Set(d).forEach(t => df[t] = (df[t] || 0) + 1));
  const qs = [...new Set(toks(q))];
  return docs.map((d, i) => { const tf = {}; d.forEach(t => tf[t] = (tf[t] || 0) + 1); let s = 0;
    for (const t of qs) if (tf[t]) s += Math.log(1 + (N - df[t] + .5) / (df[t] + .5)) * tf[t] * 2.2 / (tf[t] + 1.2 * (.25 + .75 * d.length / avg));
    return [s, i]; }).sort((a, b) => b[0] - a[0]).slice(0, k).map(x => x[1]);
}
const loc = p => p.start != null ? fmt(p.start) : p.page != null ? `page ${p.page}${p.para ? `, paragraph ${p.para}` : ''}` : `paragraph ${p.para}`;

export function cleanPassages(ps) {
  if (!Array.isArray(ps)) return [];
  return ps.slice(0, 5000).map(p => ({
    id: String(p.id || '').slice(0, 12), text: String(p.text || '').slice(0, 4000),
    start: Number.isFinite(p.start) ? p.start : undefined, page: p.page != null ? String(p.page).slice(0, 20) : undefined,
    para: Number.isFinite(p.para) ? p.para : undefined,
  })).filter(p => /^P\d+$/.test(p.id) && p.text);
}

export function transcriptContext(ps, query, stuckAt) {
  const total = ps.reduce((a, p) => a + p.text.length, 0);
  let chosen = ps;
  if (total > 90000) {
    const idx = new Set();
    rank(ps, query, 28).forEach(i => [i - 1, i, i + 1].forEach(j => j >= 0 && j < ps.length && idx.add(j)));
    if (stuckAt != null) ps.forEach((p, i) => { if (p.start != null && p.start >= stuckAt - 240 && p.start <= stuckAt + 60) idx.add(i); });
    chosen = [...idx].sort((a, b) => a - b).map(i => ps[i]);
  }
  return chosen.map(p => `[${p.id}] (${loc(p)}) ${p.text}`).join('\n');
}
export function nearestPassage(ps, stuckAt) {
  let best = null;
  for (const p of ps) if (p.start != null && p.start <= stuckAt + 2) best = p;
  return best;
}

export function transcriptAskRequest({ passages, stuckAt, question, title, prior }) {
  const near = stuckAt != null ? nearestPassage(passages, stuckAt) : null;
  const where = stuckAt != null
    ? `The student paused the lecture at ${fmt(stuckAt)}${near ? `; the transcript passage playing then is ${near.id}` : ''}. "Here" / "this step" refers to that moment.`
    : '';
  const text = `You help an engineering student revise the lecture "${title || 'this lecture'}" from its transcript.
${where}
Rules:
- Use ONLY the transcript passages below. Never add steps or formulas the lecture does not contain.
- The student may use informal wording, typos or different symbols; work out what they mean.
- ${NOTATION}
- Put the passage id in square brackets right after each claim, e.g. [P12].
- At most 3 sentences (80 words), plain text.
- If the passages don't support an answer, set "supported" to false and say so in one sentence.
${prior ? `Earlier in this session:\n${prior}\n` : ''}
Transcript passages (id, location, text):
${transcriptContext(passages, question + ' ' + (prior || ''), stuckAt)}

Student's question: ${question}

Reply with a single JSON object only, no other text:
{"supported": true|false, "answer": "short answer with [P#] markers", "citations": ["P#"], "step": "the step in at most 8 words, in the lecturer's notation"}`;
  return { model: TEXT_MODEL, contents: [{ role: 'user', parts: [{ text }] }], config: jsonConfig(TEXT_MODEL, { temperature: 0.2 }) };
}

export function transcriptTestRequest({ passages, cites, question, answer, step, title }) {
  const idx = new Set();
  cites.forEach(id => { const i = passages.findIndex(p => p.id === id); [i - 1, i, i + 1].forEach(j => j >= 0 && j < passages.length && idx.add(j)); });
  const ctx = [...idx].sort((a, b) => a - b).map(i => `[${passages[i].id}] (${loc(passages[i])}) ${passages[i].text}`).join('\n');
  const text = `Write ONE practice question for an engineering student on the same step they just asked about, from the lecture "${title || ''}".
Use ONLY these passages. The question must test understanding of this exact step (why it holds, or what changes if an assumption changes), answerable from the passages; not a recall-the-sentence question.
${NOTATION}
Question: one sentence. Answer: at most 2 sentences. "why": at most 2 sentences with [P#] markers.
Step: ${step || question}
Student's question: ${question}
Tutor's answer: ${answer}

Passages:
${ctx}

Reply with a single JSON object only, no other text: {"question": "...", "answer": "...", "why": "...", "citations": ["P#"]}`;
  return { model: TEXT_MODEL, contents: [{ role: 'user', parts: [{ text }] }], config: jsonConfig(TEXT_MODEL, { temperature: 0.4 }) };
}

export function validCites(ps, list, text) {
  const have = new Set(ps.map(p => p.id));
  const ids = new Set([...(Array.isArray(list) ? list : []), ...(String(text || '').match(/P\d+/g) || [])].map(String).filter(id => have.has(id)));
  return [...ids].sort((a, b) => +a.slice(1) - +b.slice(1));
}
export const isVideoId = id => VIDEO_ID.test(String(id || ''));
