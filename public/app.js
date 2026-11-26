{
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ytWatch = (id, sec) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}${sec ? `&t=${Math.floor(sec)}s` : ''}`;
const isPhone = () => matchMedia('(max-width:899px)').matches;
const reduce = () => matchMedia('(prefers-reduced-motion:reduce)').matches;

let CFG = { ready: false, samples: [] };
let L = null;            // current lecture { videoId, start, title, sample, tx }
let turns = [];
let homeTx = null;       // transcript attached on the start screen

// ---------- config & samples ----------
fetch('api/config').then(r => r.json()).then(c => { CFG = c; renderDemos(); onLink(); if (!c.ready) { $('cfgBanner').hidden = false; $('cfgBanner').textContent = 'Live answers are switched off on this deployment: the server has no GEMINI_API_KEY. You can still open lectures, but questions will return an error rather than an answer.'; } })
  .catch(() => { $('demos').innerHTML = '<p class="hint err">Couldn’t reach the LectureLoop server.</p>'; $('cfgBanner').hidden = false; $('cfgBanner').textContent = 'The LectureLoop server isn’t reachable, so questions can’t be answered right now.'; });

function sampleSub(s) { return [s.provider && `${s.provider} ${s.course || ''}`.trim(), s.lecture, s.lecturer, s.institute].filter(Boolean).join(' · '); }
function renderDemos() {
  $('demos').innerHTML = CFG.samples.map((s, i) => `<button class="demo" data-i="${i}" ${s.ready ? '' : 'disabled'}>
    <span class="play"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M4 2.5v9l7.5-4.5z" fill="#fff"/></svg></span>
    <span><b>${esc(s.title)}</b><small>${esc(sampleSub(s))}</small>
    <small>${s.ready ? (s.hasTranscript ? 'Answers from its timestamped transcript' : 'Answers from the video — no transcript supplied yet') : esc(s.note || 'Not ready yet')}</small></span></button>`).join('') || '<p class="hint">No samples configured.</p>';
  $('demos').querySelectorAll('.demo:not(:disabled)').forEach(b => b.onclick = () => openSample(CFG.samples[+b.dataset.i]));
}
async function sampleTx(s) {
  if (!s || !s.hasTranscript) return null;
  const r = await fetch('api/sample?id=' + encodeURIComponent(s.id)); if (!r.ok) return null;
  const text = await r.text();
  const parsed = s.transcriptFormat === 'srt' || s.transcriptFormat === 'vtt' ? { mode: 'timed', passages: groupTimed(parseSRT(text)) } : parsePasted(text);
  return parsed.passages.length ? { ...parsed, format: s.transcriptFormat === 'srt' ? 'NPTEL captions (SRT)' : 'NPTEL transcript', origin: 'sample', captions: s.transcriptFormat === 'srt' || s.transcriptFormat === 'vtt' } : null;
}
async function openSample(s, question, stuckAt) {
  const tx = await sampleTx(s).catch(() => null);
  openStudy({ videoId: s.videoId, start: stuckAt ?? null, title: s.title, sample: s, tx });
  if (question) addTurn(question, stuckAt);
  else $('q2').focus({ preventScroll: true });
}

// ---------- start screen ----------
let autoStuck = true;
function linkInfo() {
  let v = $('link').value.trim(); if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  return parseYouTube(v);
}
const sampleFor = id => CFG.samples.find(s => s.videoId === id && s.ready);
function onLink() {
  const raw = $('link').value.trim(), info = linkInfo();
  $('linkErr').hidden = !raw || !!info; $('linkErr').textContent = 'That isn’t a YouTube video link. Use a youtube.com/watch?v=… or youtu.be/… link.';
  $('link').classList.toggle('bad', !!raw && !info);
  $('vchip').hidden = !info;
  if (info) {
    const s = sampleFor(info.id);
    $('vthumb').src = `https://i.ytimg.com/vi/${encodeURIComponent(info.id)}/mqdefault.jpg`;
    $('vtitle').textContent = s ? s.title : 'YouTube video';
    $('vinfo').textContent = (s ? (s.hasTranscript ? 'NPTEL sample · timestamped transcript' : 'NPTEL sample · answers from the video') : `Video ${info.id}`) + (info.start != null ? ` · link starts at ${fmtTime(info.start)}` : ' · no time in link');
    if (autoStuck) $('stuck').value = info.start != null ? fmtTime(info.start) : '';
  }
  $('stuckOpt').hidden = !!(info && info.start != null);
  validateHome();
}
function validateHome() {
  const st = parseClock($('stuck').value); const badT = Number.isNaN(st);
  $('stuckErr').hidden = !badT; $('stuck').classList.toggle('bad', badT);
  $('askBtn').disabled = !((linkInfo() || homeTx) && $('question').value.trim() && !badT);
}
$('link').addEventListener('input', onLink);
$('stuck').addEventListener('input', () => { autoStuck = !$('stuck').value; validateHome(); });
$('question').addEventListener('input', validateHome);
$('question').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!$('askBtn').disabled) $('startForm').requestSubmit(); } });
$('startForm').onsubmit = async e => {
  e.preventDefault(); if ($('askBtn').disabled) return;
  const info = linkInfo(), stuckAt = parseClock($('stuck').value), q = $('question').value.trim();
  const s = info && sampleFor(info.id);
  if (s && !homeTx) return openSample(s, q, stuckAt);
  openStudy({ videoId: info ? info.id : null, start: stuckAt, title: s ? s.title : (homeTx && homeTx.name) || 'YouTube lecture', sample: s || null, tx: homeTx });
  addTurn(q, stuckAt);
};
$('openAttach').onclick = () => openAttach('home');
$('homeAttRemove').onclick = () => { homeTx = null; $('homeAttached').hidden = true; validateHome(); };

// ---------- study screen ----------
function openStudy(lec) {
  L = lec; turns = [];
  $('lTitle').textContent = lec.title;
  renderMeta();
  $('stuck2').value = lec.start != null ? fmtTime(lec.start) : '';
  setupPlayer();
  renderTx(); renderTurns(); showEvidence(null);
  $('home').hidden = true; $('studyView').hidden = false;
  if (location.hash !== '#study') history.pushState(null, '', '#study');
  window.scrollTo(0, 0);
  if (lec.videoId && !lec.sample) fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(ytWatch(lec.videoId))}`).then(r => r.ok ? r.json() : null).then(j => { if (j && j.title && L === lec) { lec.title = j.title; lec.channel = j.author_name; $('lTitle').textContent = j.title; renderMeta(); } }).catch(() => { });
}
function renderMeta() {
  const s = L.sample, tx = L.tx;
  $('srcTag').textContent = s ? 'NPTEL sample' : tx ? 'Your transcript' : 'YouTube link';
  let h = s ? `<span>${esc(sampleSub(s))}</span>${s.videoTitle ? `<span>“${esc(s.videoTitle)}” · ${esc(s.channel || 'YouTube')}</span>` : ''}` : (L.channel ? `<span>${esc(L.channel)}</span>` : '');
  h += tx ? `<span class="pill tx">Evidence: transcript · ${esc(tx.format)}</span>` : `<span class="pill vd">Evidence: the video, via Gemini</span>`;
  if (L.videoId) h += `<button class="lnk" id="metaAttach" type="button">${tx ? 'Replace transcript' : 'Use a transcript instead'}</button>`;
  $('lMeta').innerHTML = h;
  const b = $('metaAttach'); if (b) b.onclick = () => openAttach('study');
}
function goHome() {
  closeSheet(); $('home').hidden = false; $('studyView').hidden = true;
  if (location.hash) history.replaceState(null, '', location.pathname);
  destroyPlayer(); window.scrollTo(0, 0);
}
$('backBtn').onclick = goHome; $('brand').onclick = goHome; $('changeBtn').onclick = () => { goHome(); $('link').focus(); };

// ---------- night mode (Stitch "Nocturne") ----------
function applyTheme(t) {
  const dark = t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('themeBtn').setAttribute('aria-pressed', dark);
}
applyTheme((() => { try { return localStorage.getItem('ll.theme'); } catch (e) { return null; } })());
$('themeBtn').onclick = () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('ll.theme', t); } catch (e) { } applyTheme(t); };
window.addEventListener('popstate', () => { if (location.hash !== '#study' && !$('studyView').hidden) goHome(); });

// ---------- YouTube player ----------
let player = null, ytApi = null;
function loadYT() {
  if (ytApi) return ytApi;
  ytApi = new Promise((ok, no) => {
    if (window.YT && window.YT.Player) return ok(window.YT);
    const t = setTimeout(() => no(new Error('timeout')), 9000);
    window.onYouTubeIframeAPIReady = () => { clearTimeout(t); ok(window.YT); };
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; s.onerror = () => { clearTimeout(t); no(new Error('blocked')); };
    document.head.appendChild(s);
  });
  ytApi.catch(() => { ytApi = null; });
  return ytApi;
}
function destroyPlayer() { try { player && player.destroy && player.destroy(); } catch (e) { } player = null; }
function noEmbed(msg) {
  destroyPlayer();
  const sec = parseClock($('stuck2').value) || 0;
  $('playerBox').innerHTML = `<div class="nofrm"><div>${esc(msg)}<br><a href="${esc(ytWatch(L.videoId, sec))}" target="_blank" rel="noopener">Open on YouTube at ${esc(fmtTime(sec))} ↗</a></div></div>`;
  $('useNow').hidden = true;
}
function setupPlayer() {
  destroyPlayer(); $('useNow').hidden = true; $('pStatus').textContent = '';
  const box = $('playerBox'); box.hidden = !L.videoId; $('ytLink').hidden = !L.videoId;
  if (!L.videoId) return;
  box.innerHTML = '<div id="player"></div>'; updateYtLink();
  const lec = L;
  loadYT().then(YT => {
    if (L !== lec) return;
    player = new YT.Player('player', {
      videoId: lec.videoId, playerVars: { start: Math.floor(lec.start || 0), playsinline: 1, rel: 0 },
      events: {
        onReady: () => { if (L === lec) $('useNow').hidden = false; },
        onError: e => { if (L === lec) noEmbed([101, 150, 153].includes(e.data) ? 'The owner doesn’t allow this video to play inside other sites.' : 'This video can’t be played here.'); },
      },
    });
  }).catch(() => { if (L === lec) noEmbed('The YouTube player couldn’t load here.'); });
}
function updateYtLink() {
  if (!L || !L.videoId) return;
  const sec = parseClock($('stuck2').value); const ok = sec != null && !Number.isNaN(sec);
  $('ytLink').href = ytWatch(L.videoId, ok ? sec : 0);
  $('ytLink').textContent = ok ? `Open on YouTube at ${fmtTime(sec)} ↗` : 'Open on YouTube ↗';
}
function seek(sec, play) {
  if (!player || !player.seekTo) return false;
  try {
    const playing = player.getPlayerState && player.getPlayerState() === 1;
    player.seekTo(sec, true);
    if (play) player.playVideo(); else if (!playing) setTimeout(() => { try { player.pauseVideo(); } catch (e) { } }, 250);
    return true;
  } catch (e) { return false; }
}
$('useNow').onclick = () => {
  try { const t = player.getCurrentTime(); $('stuck2').value = fmtTime(t); onStuck2(); $('q2').focus(); } catch (e) { }
};

// ---------- asking ----------
function onStuck2() { const v = parseClock($('stuck2').value), bad = Number.isNaN(v); $('stuck2Err').hidden = !bad; $('stuck2').classList.toggle('bad', bad); updateYtLink(); return !bad; }
$('stuck2').addEventListener('input', onStuck2);
const autosize = () => { const q = $('q2'); q.style.height = 'auto'; q.style.height = Math.min(q.scrollHeight + 2, 180) + 'px'; };
$('q2').addEventListener('input', autosize);
$('q2').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('askForm').requestSubmit(); } });
$('askForm').onsubmit = e => {
  e.preventDefault();
  const q = $('q2').value.trim(); if (!q || !onStuck2() || turns.some(t => t.loading)) return;
  $('q2').value = ''; autosize();
  addTurn(q, parseClock($('stuck2').value));
};

function addTurn(q, stuckAt) {
  const t = { q, stuckAt: stuckAt == null || Number.isNaN(stuckAt) ? null : stuckAt };
  turns.unshift(t); runTurn(t);
}
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch (e) { }
  if (!r.ok || !j) throw (j || { error: 'network', message: 'Couldn’t reach the LectureLoop server.' });
  return j;
}
function priorText() { return turns.filter(t => t.answer).slice(0, 2).reverse().map(t => `Student: ${t.q}\nTutor: ${t.answer.answer}`).join('\n'); }
async function runTurn(t) {
  const lec = L; t.mode = lec.tx ? 'transcript' : 'video'; t.loading = true; t.error = null; t.answer = null; t.test = null; renderTurns();
  try {
    const body = { mode: t.mode, question: t.q, stuckAt: t.stuckAt, title: lec.title, prior: priorText(), videoId: lec.videoId };
    if (t.mode === 'transcript') body.passages = lec.tx.passages;
    const a = await post('api/ask', body);
    if (L !== lec) return;
    t.answer = a;
    const first = firstCite(t);
    if (first && !isPhone()) showEvidence(first, false);
  } catch (err) { if (L !== lec) return; t.error = err; }
  t.loading = false; renderTurns();
}
const firstCite = t => !t.answer || !t.answer.supported ? null : t.answer.kind === 'transcript' ? (t.answer.cites[0] && { type: 'tx', id: t.answer.cites[0] }) : (t.answer.moments[0] && { type: 'vd', ...t.answer.moments[0] });

// ---------- rendering ----------
const pById = id => L && L.tx && L.tx.passages.find(p => p.id === id);
function txLabel(p) { return p.start != null ? ['Transcript', fmtTime(p.start)] : p.page != null ? ['PDF', 'p. ' + p.page] : ['Text', '¶ ' + p.para]; }
function txChip(id) { const p = pById(id); if (!p) return ''; const [a, b] = txLabel(p); return `<button class="chip tx" data-tx="${esc(p.id)}" title="Show this passage"><span>${a} ·</span><span class="t">${esc(b)}</span></button>`; }
function vdChip(m) { return `<button class="chip vd" data-vd="${m.sec}" data-what="${esc(m.what || '')}" title="Approximate moment in the video"><span>Video · around</span><span class="t">${esc(fmtTime(m.sec))}</span></button>`; }
function rich(text, allowCites) {
  let h = esc(text).replace(/`([^`]+)`/g, '<code>$1</code>');
  return h.replace(/\[((?:P\d+)(?:\s*[,;]\s*P\d+)*)\]/g, (m, ids) => allowCites ? ids.split(/\s*[,;]\s*/).map(txChip).join('') : '');
}
function errorBlock(t, i) {
  const e = t.error || {};
  const parts = [L.videoId && 'link', t.stuckAt != null && `time (${fmtTime(t.stuckAt)})`, 'question'].filter(Boolean);
  const kept = `Your ${parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0]} ${parts.length > 1 ? 'are' : 'is'} kept.`;
  if (e.error === 'video_failed') return `<div class="errbox"><p>Couldn’t analyse this video. ${esc(e.message || '')}</p><p class="kept">${esc(kept)} Continue with a transcript instead:</p>
    <div class="row"><button class="btn secondary small" data-alt="srt" data-i="${i}">Upload SRT</button><button class="btn secondary small" data-alt="pdf" data-i="${i}">Upload PDF</button><button class="btn secondary small" data-alt="paste" data-i="${i}">Paste text</button><button class="lnk" data-retry="${i}">Try the video again</button></div></div>`;
  return `<div class="errbox"><p>${esc(e.message || 'Couldn’t get an answer.')}</p><p class="kept">${esc(kept)}</p>${e.error === 'not_configured' ? '' : `<div class="row"><button class="btn secondary small" data-retry="${i}">Try again</button></div>`}</div>`;
}
function renderTurns() {
  $('turns').innerHTML = turns.map((t, i) => {
    const vid = t.mode !== 'transcript';
    let body;
    if (t.loading) body = `<div class="load" style="margin-top:14px"><span class="spin"></span>${vid ? `Watching the lecture${t.stuckAt != null ? ` around ${fmtTime(t.stuckAt)}` : ''}… this can take up to a minute.` : 'Reading the transcript…'}</div>`;
    else if (t.error) body = `<div style="margin-top:14px">${errorBlock(t, i)}</div>`;
    else {
      const a = t.answer;
      const head = a.kind === 'video'
        ? `<div class="eyebrow" style="color:var(--vid)"><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 9.5v5l4.5-2.5z" fill="currentColor"/></svg>Video-grounded answer · Gemini’s paraphrase, not a quotation${a.model ? `<span class="tag vd" style="margin-left:auto">${esc(a.model)}</span>` : ''}</div>`
        : `<div class="eyebrow"><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.4 2.1 3.2-.3.9 3.1 2.8 1.6-1.1 3 1.1 3-2.8 1.6-.9 3.1-3.2-.3L12 22l-2.4-2.1-3.2.3-.9-3.1-2.8-1.6 1.1-3-1.1-3 2.8-1.6.9-3.1 3.2.3z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8.5 12.2l2.3 2.3 4.7-4.7" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>Transcript-grounded answer${a.model ? `<span class="tag" style="margin-left:auto">${esc(a.model)}</span>` : ''}</div>`;
      body = `<div class="agrid">${head}<p class="ans">${rich(a.answer, a.kind !== 'video')}</p>`;
      if (a.kind === 'video' && a.moments.length) body += `<div class="where">${a.supported ? 'Where it’s explained' : 'Nearest moments'}<ul>${a.moments.map(m => `<li>${vdChip(m)} ${esc(m.what)}</li>`).join('')}</ul></div>`;
      if (a.kind === 'transcript' && a.cites.length) body += `<div class="cited">Cited:${a.cites.map(txChip).join('')}</div>`;
      body += '</div>';
      body += a.supported ? testHtml(t, i) : `<p class="nos">The ${a.kind === 'video' ? 'video' : 'transcript'} doesn’t support an answer to this, so there’s no self-test.</p>`;
    }
    return `<article class="turn" style="margin-bottom:16px"><div class="qhead"><span class="eyebrow muted">Student question${t.stuckAt != null ? ` · stuck at <span class="mono" style="color:var(--acc)">${fmtTime(t.stuckAt)}</span>` : ''}</span><span class="tag${vid ? ' vd' : ''}">${vid ? 'Evidence: video' : 'Evidence: transcript'}</span></div><p class="q">${esc(t.q)}</p>${body}</article>`;
  }).join('');
}
function testHtml(t, i) {
  const x = t.test;
  if (!x) return `<div class="row" style="margin-top:18px"><button class="btn primary" data-test="${i}">Test me on this step →</button></div>`;
  let inner;
  const state = x.loading ? 'Writing' : x.error ? 'Error' : x.revealed ? 'Answer revealed' : 'Pending response';
  if (x.loading) inner = `<div class="load"><span class="spin"></span>Writing a question on this step…</div>`;
  else if (x.error) inner = `<p class="hint err" style="font-size:15px;margin:0">${esc(x.error.message || 'Couldn’t write a question.')}</p><div class="row"><button class="btn primary" data-test="${i}">Try again</button></div>`;
  else {
    const tx = x.kind === 'transcript';
    const cites = tx ? (/\[P\d/.test(x.why) ? '' : x.cites.map(txChip).join('')) : (x.moment ? vdChip(x.moment) : '');
    const back = tx ? (pById(x.cites[0]) || {}).start : x.moment && x.moment.sec;
    inner = `<div class="core"><span class="eyebrow muted">Core prompt</span><p class="tq">${rich(x.question, false)}</p></div>`;
    if (!x.revealed) inner += `<label class="f" for="att${i}" style="margin-top:0">Your reasoning</label>
      <textarea class="in" id="att${i}" data-att="${i}" rows="4" placeholder="Work it out in your own words or as a formula first">${esc(x.attempt || '')}</textarea>
      <div class="attempt-foot"><span>Written before you reveal</span><span id="cc${i}">${(x.attempt || '').length} characters</span></div>
      <div class="row"><button class="btn secondary" data-reveal="${i}">Reveal answer</button><span class="hint" style="margin:0">No penalty · self-paced check</span></div>`;
    else inner += `${x.attempt ? `<div class="yours"><span class="eyebrow muted">Your attempt</span><q>${esc(x.attempt)}</q></div>` : ''}
      <div class="check"><span class="eyebrow">${tx ? 'Answer' : 'Answer · paraphrased from the video'}</span><p>${rich(x.answer, tx)}</p>${x.why ? `<p style="color:var(--muted)">${rich(x.why, tx)}</p>` : ''}${cites ? `<p>${cites}</p>` : ''}</div>
      <div class="row">${back != null && player ? `<button class="btn primary" data-play="${back}">Revisit ${tx ? '' : 'around '}${fmtTime(back)} →</button>` : ''}<button class="btn secondary" data-test="${i}">↻ Try another variation</button></div>`;
  }
  return `<section class="recall"><div class="rh"><b>Active recall exercise</b><span class="tag">State: ${state}</span></div><div class="rb">${inner}</div></section>`;
}
$('turns').addEventListener('click', async e => {
  const b = e.target.closest('[data-tx],[data-vd],[data-test],[data-reveal],[data-retry],[data-alt]'); if (!b) return;
  if (b.dataset.tx) return cite({ type: 'tx', id: b.dataset.tx }, b);
  if (b.dataset.vd) return cite({ type: 'vd', sec: +b.dataset.vd, what: b.dataset.what }, b);
  if (b.dataset.reveal) { turns[+b.dataset.reveal].test.revealed = true; return renderTurns(); }
  if (b.dataset.retry) return runTurn(turns[+b.dataset.retry]);
  if (b.dataset.alt) return openAttach('study', turns[+b.dataset.i], b.dataset.alt);
  if (b.dataset.test) {
    const t = turns[+b.dataset.test], lec = L, a = t.answer;
    t.test = { loading: true }; renderTurns();
    try {
      const body = { mode: a.kind, question: t.q, answer: a.answer, step: a.step, title: lec.title, videoId: lec.videoId };
      if (a.kind === 'transcript') { body.passages = lec.tx.passages; body.cites = a.cites; }
      else body.at = a.moments[0] ? a.moments[0].sec : t.stuckAt;
      const x = await post('api/test', body); if (L !== lec) return; t.test = x;
    } catch (err) { t.test = { error: err }; }
    renderTurns();
    const ta = document.querySelector(`[data-att="${turns.indexOf(t)}"]`); if (ta) ta.focus({ preventScroll: true });
  }
});
$('turns').addEventListener('input', e => { const i = e.target.dataset.att; if (i != null && turns[+i].test) { turns[+i].test.attempt = e.target.value; const c = $('cc' + i); if (c) c.textContent = e.target.value.length + ' characters'; } });

// ---------- evidence: side panel (desktop) / bottom sheet (phone) ----------
let lastFocus = null;
function cite(c, from) {
  if (isPhone()) { lastFocus = from; openSheet(c); }
  else { const sec = c.type === 'vd' ? c.sec : (pById(c.id) || {}).start; if (sec != null) seek(sec, false); showEvidence(c, true); }
}
function evidenceHtml(c) {
  const playBtn = sec => player ? `<button class="btn dark small" data-play="${sec}">▶ Play from ${fmtTime(sec)}</button>` : '';
  const ytA = (sec, label) => L.videoId ? `<a class="lnk" href="${esc(ytWatch(L.videoId, sec))}" target="_blank" rel="noopener">${label} ↗</a>` : '';
  if (c.type === 'vd') {
    return `<div class="sel"><div class="head"><span class="tpill vd">~${esc(fmtTime(c.sec))}</span><span class="eyebrow" style="color:var(--vid)">Video moment · approximate</span></div>
      ${c.what ? `<p class="para-note">${esc(c.what)}</p>` : ''}
      <p class="note" style="font-size:13.5px;color:var(--muted);margin:8px 0 0">Gemini identified this moment in the video. The answer paraphrases what the lecturer explains around here; it is not a transcript quote.</p>
      <div class="acts">${playBtn(c.sec)}${ytA(c.sec, 'Open on YouTube')}</div></div>`;
  }
  const P = L.tx.passages, i = P.findIndex(p => p.id === c.id); const p = P[i]; if (!p) return '';
  const prev = P[i - 1], next = P[i + 1], cut = s => { const w = s.split(/\s+/); return w.length > 28 ? '…' + w.slice(-28).join(' ') : s; }, cutN = s => { const w = s.split(/\s+/); return w.length > 28 ? w.slice(0, 28).join(' ') + '…' : s; };
  const timed = p.start != null, [kind, where] = txLabel(p);
  return `${prev ? `<p class="ctx">${esc(cut(prev.text))}</p>` : ''}
    <div class="sel"><div class="head"><span class="tpill">${esc(where)}</span><span class="eyebrow">${kind === 'Transcript' ? (L.tx.captions ? 'Caption cue' : 'Timestamped line') : kind === 'PDF' ? 'PDF page' : 'Pasted paragraph'}</span></div>
    <blockquote>“${esc(p.text)}”</blockquote>
    <div class="acts">${timed ? playBtn(p.start) + ytA(p.start, `Open on YouTube at ${fmtTime(p.start)}`) : `<span class="hint" style="margin:0">${p.page != null ? `Quoted from page ${esc(p.page)} of the PDF` : `Quoted from paragraph ${p.para} of the pasted text`}</span>`}</div></div>
    ${next ? `<p class="ctx">${esc(cutN(next.text))}</p>` : ''}`;
}
function showEvidence(c, scrollList) {
  if (!c) { $('ev').className = 'ev empty'; $('ev').textContent = 'Select a citation to see the passage the answer relies on.'; $('evSrc').textContent = ''; markActive(null); return; }
  $('ev').className = 'ev'; $('ev').innerHTML = evidenceHtml(c);
  $('evSrc').textContent = c.type === 'vd' ? 'from the video' : 'from the transcript';
  markActive(c.type === 'tx' ? c.id : null, scrollList);
}
function playFrom(sec) {
  if (seek(sec, true) && isPhone()) { closeSheet(); $('playerBox').scrollIntoView({ block: 'start', behavior: reduce() ? 'auto' : 'smooth' }); }
}
document.addEventListener('click', e => { const b = e.target.closest('[data-play]'); if (b) playFrom(+b.dataset.play); });

function openSheet(c) {
  $('shTitle').textContent = 'Selected passage';
  $('shBody').innerHTML = evidenceHtml(c);
  const sh = $('sheet'), sc = $('scrim'); sh.hidden = false; sc.hidden = false;
  requestAnimationFrame(() => { sh.classList.add('open'); sc.classList.add('open'); $('shClose').focus({ preventScroll: true }); });
}
function closeSheet() {
  const sh = $('sheet'), sc = $('scrim'); if (sh.hidden) return;
  sh.classList.remove('open'); sc.classList.remove('open');
  setTimeout(() => { sh.hidden = true; sc.hidden = true; }, reduce() ? 0 : 250);
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
}
$('shClose').onclick = closeSheet; $('scrim').onclick = closeSheet;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
$('shBody').addEventListener('click', e => { const b = e.target.closest('[data-tx]'); if (b) e.preventDefault(); });

// ---------- transcript panel (only when real transcript text exists) ----------
function renderTx() {
  const has = !!(L && L.tx); $('txPanel').hidden = !has; if (!has) return;
  $('txCount').textContent = `${L.tx.passages.length} passages`; $('find').value = '';
  $('txTitle').textContent = L.tx.mode === 'timed' && L.videoId ? 'Synchronized transcript' : 'Lecture transcript'; drawList();
}
let activeId = null, nowId = null;
// Follow the player in a timed transcript (Stitch "sync" pill + playing passage marker).
setInterval(() => {
  const pill = $('syncPill');
  if (!player || !player.getCurrentTime || !L || !L.tx || L.tx.mode !== 'timed' || $('studyView').hidden) { pill.hidden = true; return; }
  let t; try { t = player.getCurrentTime(); } catch (e) { return; }
  if (typeof t !== 'number') return;
  pill.hidden = false; pill.textContent = 'Sync ' + fmtTime(t);
  let cur = null; for (const p of L.tx.passages) { if (p.start <= t + 0.5) cur = p; else break; }
  const id = cur && cur.id; if (id === nowId) return;
  const old = nowId && $('pa-' + nowId); if (old) old.classList.remove('now');
  nowId = id; const el = id && $('pa-' + id); if (el) el.classList.add('now');
}, 1000);
function drawList() {
  const q = $('find').value.trim(), re = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
  const hl = s => { const e = esc(s); return q ? e.replace(new RegExp(esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), m => `<mark>${m}</mark>`) : e; };
  const ps = L.tx.passages.filter(p => !re || re.test(p.text));
  $('list').innerHTML = ps.length ? ps.map(p => {
    const body = p.cues && p.cues.length > 1 ? p.cues.map((c, i) => (i ? `<span class="cue">${esc(fmtTime(c.start))}</span>` : '') + hl(c.text)).join(' ') : hl(p.text);
    return `<div class="pa${p.id === activeId ? ' on' : ''}${p.id === nowId ? ' now' : ''}" id="pa-${p.id}" data-pa="${p.id}" tabindex="0"><span class="lab">${esc(p.label)}</span><div class="t">${body}</div></div>`;
  }).join('') : `<p class="hint" style="padding:12px">No passages match “${esc(q)}”.</p>`;
}
function markActive(id, scroll) {
  activeId = id; if (!L || !L.tx) return;
  if ($('find').value && id) { $('find').value = ''; drawList(); }
  document.querySelectorAll('.pa.on').forEach(x => x.classList.remove('on'));
  const el = id && $('pa-' + id); if (!el) return;
  el.classList.add('on');
  if (scroll) { const list = $('list'); const top = el.offsetTop - list.offsetTop - list.clientHeight / 3; list.scrollTo({ top, behavior: reduce() ? 'auto' : 'smooth' }); }
}
$('find').addEventListener('input', drawList);
$('list').addEventListener('click', e => { const el = e.target.closest('[data-pa]'); if (el) cite({ type: 'tx', id: el.dataset.pa }, el); });
$('list').addEventListener('keydown', e => { const el = e.target.closest('[data-pa]'); if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); cite({ type: 'tx', id: el.dataset.pa }, el); } });

// ---------- attach transcript (SRT / selectable-text PDF / pasted text) ----------
let attachTarget = 'home', retryTurn = null, attFile = null, attKind = 'up';
function openAttach(target, turn, prefer) {
  attachTarget = target; retryTurn = turn || null;
  setAttKind(prefer === 'paste' ? 'paste' : 'up'); attFile = null; $('file').value = ''; $('fileName').hidden = true; $('attErr').hidden = true; $('attLabel').value = ''; updAtt();
  $('file').accept = prefer === 'srt' ? '.srt,.vtt' : prefer === 'pdf' ? '.pdf,application/pdf' : '.srt,.vtt,.pdf,.txt,application/pdf,text/plain';
  $('attachDlg').showModal();
  if (prefer === 'srt' || prefer === 'pdf') $('file').click();
}
function setAttKind(k) { attKind = k; $('tUp').setAttribute('aria-selected', k === 'up'); $('tPaste').setAttribute('aria-selected', k === 'paste'); $('upPane').hidden = k !== 'up'; $('pastePane').hidden = k !== 'paste'; $('attErr').hidden = true; updAtt(); }
$('tUp').onclick = () => setAttKind('up'); $('tPaste').onclick = () => setAttKind('paste');
function updAtt() { $('attUse').disabled = attKind === 'up' ? !attFile : !$('paste').value.trim(); }
$('paste').oninput = updAtt;
function setAttFile(f) { attFile = f || null; $('fileName').hidden = !f; $('fileName').textContent = f ? 'Selected: ' + f.name : ''; $('attErr').hidden = true; updAtt(); }
$('file').onchange = e => setAttFile(e.target.files[0]);
const drop = $('drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) setAttFile(f); });
$('attCancel').onclick = () => $('attachDlg').close();
function attErr(msg, pasteBtn) {
  const a = $('attErr'); a.hidden = false; a.textContent = msg;
  if (pasteBtn) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn secondary small'; b.textContent = 'Paste text instead'; b.onclick = () => setAttKind('paste'); a.appendChild(b); }
}
$('attUse').onclick = async () => {
  $('attUse').disabled = true; $('attStatus').textContent = 'Reading…';
  try {
    let tx;
    if (attKind === 'paste') { const p = parsePasted($('paste').value); tx = { ...p, format: p.mode === 'timed' ? 'pasted text, timestamps kept' : 'pasted text', name: 'Pasted transcript' }; }
    else {
      const f = attFile, ext = (f.name.split('.').pop() || '').toLowerCase(), name = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
      if (ext === 'pdf' || f.type === 'application/pdf') {
        const pages = await readPdf(f); const p = fromPdfPages(pages);
        if (!p) return attErr('This PDF has no selectable text — it may be a scan. Upload an SRT caption file or paste the transcript text instead.', true);
        tx = { ...p, format: `PDF, ${pages.length} page${pages.length > 1 ? 's' : ''}`, name };
      } else {
        const text = await f.text();
        if (ext === 'srt' || ext === 'vtt' || /-->/.test(text)) {
          const segs = parseSRT(text); if (!segs.length) return attErr('No caption cues were found in this file. Check it’s a valid .srt, or paste the text instead.', true);
          tx = { mode: 'timed', passages: groupTimed(segs), format: `SRT, ${segs.length} cues`, name, captions: true };
        } else { const p = parsePasted(text); tx = { ...p, format: 'text file', name }; }
      }
    }
    if (!tx.passages.length) return attErr('No transcript text was found.', attKind === 'up');
    tx.origin = 'upload';
    const label = $('attLabel').value.trim(); if (label) tx.name = label.slice(0, 120);
    $('attachDlg').close();
    if (attachTarget === 'home') { homeTx = tx; $('homeAttached').hidden = false; $('homeAttTxt').textContent = `Transcript attached: ${tx.name} (${tx.format}). Answers will come from it.`; validateHome(); }
    else {
      L.tx = tx; if (!L.videoId) { L.title = tx.name; $('lTitle').textContent = tx.name; } renderMeta(); renderTx(); showEvidence(null);
      if (retryTurn) runTurn(retryTurn);
    }
  } catch (e) {
    attErr(e && e.pdf ? 'This PDF couldn’t be opened. If it’s scanned or password-protected, upload an SRT file or paste the text instead.' : 'Something went wrong reading that file.', true);
  } finally { $('attStatus').textContent = ''; updAtt(); }
};

let pdfLib = null;
function loadScript(src) { return new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); }); }
async function readPdf(file) {
  try {
    if (!pdfLib) {
      const base = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
      await loadScript(base + 'pdf.min.js'); await loadScript(base + 'pdf.worker.min.js');
      pdfLib = window.pdfjsLib; pdfLib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js';
    }
    const doc = await pdfLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
    let labels = null; try { labels = await doc.getPageLabels(); } catch (e) { }
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const tc = await (await doc.getPage(i)).getTextContent(); let out = '', lastY = null;
      for (const it of tc.items) {
        if (!('str' in it)) continue;
        const y = it.transform ? it.transform[5] : null, h = it.height || 10;
        if (lastY != null && y != null && Math.abs(lastY - y) > h * 1.9 && !out.endsWith('\n\n')) out += out.endsWith('\n') ? '\n' : '\n\n';
        out += it.str + (it.hasEOL ? '\n' : ''); if (y != null && it.str.trim()) lastY = y;
      }
      pages.push({ page: (labels && labels[i - 1] && labels[i - 1].trim()) || String(i), text: out });
    }
    return pages;
  } catch (e) { e.pdf = true; throw e; }
}
}
