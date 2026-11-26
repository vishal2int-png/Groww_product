// ---------- Transcript parsing ----------
// A lecture is { title, source:{kind,...}, videoUrl, mode:'timed'|'page'|'para', passages:[{id,label,text,start?,end?,page?,para?}] }
const TARGET_WORDS = 55;

function wc(s) { return (s.match(/\S+/g) || []).length; }
function clean(s) { return s.replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').replace(/[ \t]+/g, ' ').trim(); }

function toSec(h, m, s, ms) { return (+h || 0) * 3600 + (+m) * 60 + (+s) + (ms ? +('0.' + ms) : 0); }
function fmtTime(sec) {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const p = n => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

// Group timed segments [{start,end,text}] into passages of ~TARGET_WORDS, never across long pauses.
function groupTimed(segs, gapMax = 6) {
  const out = []; let cur = null;
  for (const sg of segs) {
    if (!sg.text) continue;
    const gap = cur && cur.end != null ? sg.start - cur.end : 0;
    if (!cur || wc(cur.text) >= TARGET_WORDS || gap > gapMax || sg.start - cur.start > 90) {
      cur = { start: sg.start, end: sg.end ?? sg.start, text: sg.text, cues: [{ start: sg.start, end: sg.end, text: sg.text }] };
      out.push(cur);
    } else {
      cur.text += ' ' + sg.text; cur.end = sg.end ?? sg.start; cur.cues.push({ start: sg.start, end: sg.end, text: sg.text });
    }
  }
  return out.map((p, i) => ({ id: 'P' + (i + 1), start: p.start, end: p.end, cues: p.cues, label: fmtTime(p.start), text: p.text }));
}

function parseSRT(raw) {
  const txt = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const re = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;
  const segs = [];
  for (const block of txt.split(/\n\s*\n/)) {
    const ls = block.split('\n'); const i = ls.findIndex(l => re.test(l));
    if (i < 0) continue;
    const m = ls[i].match(re);
    const body = ls.slice(i + 1).map(clean).filter(Boolean).join(' ');
    segs.push({ start: toSec(m[1], m[2], m[3], m[4]), end: toSec(m[5], m[6], m[7], m[8]), text: body });
  }
  return segs;
}

// Timestamp at the start of a line: 12:34, 1:02:03, [12:34], (12:34), 12:34 - text
const TS_LINE = /^\s*[\[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})(?:[.,]\d{1,3})?[\])]?\s*(?:[-–—:|]\s*)?(.*)$/;
function tsToSec(t) { const p = t.split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; }

function parsePasted(raw) {
  const txt = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  if (/-->/.test(txt) && parseSRT(txt).length >= 2) return { mode: 'timed', passages: groupTimed(parseSRT(txt)) };
  const lines = txt.split('\n');
  const tsLines = lines.filter(l => TS_LINE.test(l) && /^\s*[\[(]?\d/.test(l)).length;
  if (tsLines >= 2) {
    const segs = []; let cur = null;
    for (const l of lines) {
      const m = l.match(TS_LINE);
      if (m && /^\s*[\[(]?\d/.test(l)) { cur = { start: tsToSec(m[1]), text: clean(m[2] || '') }; segs.push(cur); }
      else if (cur) { const c = clean(l); if (c) cur.text += (cur.text ? ' ' : '') + c; }
      else { const c = clean(l); if (c) { cur = { start: 0, text: c }; segs.push(cur); } }
    }
    for (const sg of segs) sg.end = sg.start;
    // Keep each stamped line as its own passage (its own citation), unless it looks like a YouTube
    // transcript copy: very short lines stamped every few seconds, which are grouped into readable passages.
    const avg = segs.reduce((a, x) => a + wc(x.text), 0) / segs.length;
    const gaps = segs.slice(1).map((x, i) => x.start - segs[i].start).sort((a, b) => a - b);
    const medGap = gaps.length ? gaps[gaps.length >> 1] : Infinity;
    const youTubeCopy = avg < 8 && medGap <= 10;
    return { mode: 'timed', passages: groupTimed(segs, youTubeCopy ? 30 : -1) };
  }
  return { mode: 'para', passages: paragraphs(txt).map((t, i) => ({ id: 'P' + (i + 1), para: i + 1, label: '¶ ' + (i + 1), text: t })) };
}

// Split untimed text into paragraphs; very long blocks are split by sentence so citations stay precise.
function paragraphs(txt) {
  let blocks = txt.split(/\n\s*\n/).map(b => clean(b.replace(/\n/g, ' '))).filter(Boolean);
  if (blocks.length === 1 && wc(blocks[0]) > 160) {
    const ls = txt.split('\n').map(clean).filter(Boolean);
    if (ls.length > 3 && ls.every(l => wc(l) < 200)) blocks = mergeShort(ls);
  }
  return blocks.flatMap(b => wc(b) > 160 ? chunkSentences(b, 90) : [b]);
}
function mergeShort(ls) {
  const out = []; for (const l of ls) { if (out.length && wc(out[out.length - 1]) < 25) out[out.length - 1] += ' ' + l; else out.push(l); } return out;
}
function chunkSentences(b, n) {
  const sents = b.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [b];
  const out = []; let cur = '';
  for (const s of sents) { if (cur && wc(cur) + wc(s) > n) { out.push(cur.trim()); cur = ''; } cur += s; }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// pages: [{page:label, text}] — keeps the PDF's own page numbers/labels.
function fromPdfPages(pages) {
  const total = pages.reduce((a, p) => a + p.text.replace(/\s/g, '').length, 0);
  if (total < 40) return null; // no extractable text (scanned)
  const passages = []; let n = 0;
  for (const pg of pages) {
    const paras = paragraphs(pg.text);
    paras.forEach((t, j) => { n++; passages.push({ id: 'P' + n, page: pg.page, para: j + 1, label: 'p. ' + pg.page + (paras.length > 1 ? ' ¶' + (j + 1) : ''), text: t }); });
  }
  return { mode: 'page', passages };
}

// YouTube URL → video id, or null
function youTubeId(u) {
  try {
    const url = new URL(u.trim());
    const h = url.hostname.replace(/^www\.|^m\./, '');
    if (h === 'youtu.be') return url.pathname.slice(1).split('/')[0] || null;
    if (h === 'youtube.com' || h === 'youtube-nocookie.com') {
      if (url.searchParams.get('v')) return url.searchParams.get('v');
      const m = url.pathname.match(/^\/(?:embed|live|shorts|v)\/([\w-]{6,})/); return m ? m[1] : null;
    }
  } catch (e) { }
  return null;
}
function watchUrl(id, sec) { return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}&t=${Math.max(0, Math.floor(sec))}s`; }

// ---------- Retrieval (BM25) for long transcripts ----------
const STOP = new Set('the a an and or of to in is it that this we you i be for on as are with by at so if then from can will what why how which there here have has was were do does not but its they he she our your'.split(' '));
function toks(s) { return (s.toLowerCase().match(/[a-z0-9]+/g) || []).filter(t => !STOP.has(t)); }
function rank(passages, query, k) {
  const docs = passages.map(p => toks(p.text)); const N = docs.length; const avg = docs.reduce((a, d) => a + d.length, 0) / Math.max(N, 1);
  const df = {}; docs.forEach(d => new Set(d).forEach(t => df[t] = (df[t] || 0) + 1));
  const q = [...new Set(toks(query))];
  const sc = docs.map((d, i) => {
    const tf = {}; d.forEach(t => tf[t] = (tf[t] || 0) + 1); let s = 0;
    for (const t of q) if (tf[t]) { const idf = Math.log(1 + (N - df[t] + .5) / (df[t] + .5)); s += idf * tf[t] * 2.2 / (tf[t] + 1.2 * (.25 + .75 * d.length / avg)); }
    return [s, i];
  }).sort((a, b) => b[0] - a[0]);
  return sc.slice(0, k).map(x => x[1]);
}

if (typeof module !== 'undefined') module.exports = { parseSRT, parsePasted, groupTimed, fromPdfPages, youTubeId, watchUrl, fmtTime, rank, paragraphs };

// YouTube link → { id, start } (start in seconds, or null). Accepts watch, youtu.be, embed, live, shorts; t=/start= in query or hash.
function parseYouTube(u) {
  const id = youTubeId(u); if (!id || !/^[\w-]{11}$/.test(id)) return null;
  let start = null;
  try {
    const url = new URL(u.trim());
    const raw = url.searchParams.get('t') || url.searchParams.get('start') || (url.hash.match(/t=([^&]+)/) || [])[1];
    if (raw) start = parseTimeParam(raw);
  } catch (e) { }
  return { id, start };
}
function parseTimeParam(raw) {
  raw = String(raw).trim();
  if (/^\d+s?$/.test(raw)) return parseInt(raw, 10);
  const m = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (m && (m[1] || m[2] || m[3])) return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
  return parseClock(raw);
}
// "12:40", "1:02:03", "760" → seconds; '' → null; invalid → NaN
function parseClock(s) {
  s = String(s || '').trim(); if (!s) return null;
  if (/^\d+$/.test(s)) return +s;
  const m = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  return m && +m[3] < 60 && (!m[1] || +m[2] < 60) ? (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) : NaN;
}
if (typeof module !== 'undefined') module.exports.parseYouTube = parseYouTube, module.exports.parseClock = parseClock;
