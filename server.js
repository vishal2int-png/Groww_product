// Minimal Node server: serves public/ and the /api routes. `npm start` (reads GEMINI_API_KEY from the environment).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandlers } from './lib/handlers.js';
import * as K from './lib/keystore.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

export function createServer(h) {
  h ||= createHandlers();
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
    const send = (r) => {
      if (r.text != null) { res.writeHead(r.status, { 'content-type': 'text/plain; charset=utf-8' }); return res.end(r.text); }
      res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(r.json));
    };
    try {
      if (url.pathname === '/api/config' && req.method === 'GET') return send(h.config());
      if (url.pathname === '/api/sample' && req.method === 'GET') return send(h.sampleTranscript(url.searchParams.get('id')));
      if ((url.pathname === '/api/ask' || url.pathname === '/api/test') && req.method === 'POST') {
        const body = await readJSON(req);
        if (!body) return send({ status: 413, json: { error: 'too_large', message: 'The request was too large or not valid JSON.' } });
        return send(await h[url.pathname === '/api/ask' ? 'ask' : 'test'](body, ip));
      }
      if (url.pathname.startsWith('/api/admin/')) {
        const auth = req.headers.authorization;
        if (url.pathname === '/api/admin/status' && req.method === 'GET') return send(h.adminStatus(auth, ip));
        if (req.method === 'POST' && (url.pathname === '/api/admin/test' || url.pathname === '/api/admin/key')) {
          const body = await readJSON(req, 10000);
          if (!body) return send({ status: 400, json: { error: 'bad_request' } });
          return send(url.pathname === '/api/admin/test' ? await h.adminTest(auth, body, ip) : await h.adminSetKey(auth, body, ip));
        }
      }
      if (url.pathname.startsWith('/api/')) return send({ status: 404, json: { error: 'not_found' } });
      // static
      let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
      if (!p || p.endsWith('/')) p += 'index.html';
      if (p === 'admin') p = 'admin.html';
      const file = path.join(PUB, p);
      if (!file.startsWith(PUB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin' });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      console.error(e); send({ status: 500, json: { error: 'server_error', message: 'Server error.' } });
    }
  });
}

function readJSON(req, limit = 4 * 1024 * 1024) {
  return new Promise(resolve => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { resolve(null); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve(null); } });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const st = K.init(); K.watchEnvFile();
  const port = Number(process.env.PORT || 3000);
  createServer().listen(port, () => {
    console.log(`LectureLoop on http://localhost:${port}`);
    console.log(st.configured ? `Gemini key: set (…${st.last4}, from ${st.source}), text model ${st.model}, video model ${st.videoModel}` : 'GEMINI_API_KEY is not set: questions will return "not configured". Set it with `npm run set-key` or the /admin page.');
    console.log(K.adminEnabled() ? `Key admin page: http://localhost:${port}/admin` : 'Key admin page is off (set ADMIN_TOKEN to enable /admin).');
  });
}
