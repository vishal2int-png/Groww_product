// Vercel function helpers. Files starting with "_" are not deployed as routes.
import { createHandlers } from '../lib/handlers.js';
import * as K from '../lib/keystore.js';
let h;
export const handlers = () => { if (!h) { K.init(); h = createHandlers(); } return h; };
export const ipOf = req => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
export const bodyOf = req => typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
export function send(res, r) {
  if (r.text != null) { res.setHeader('content-type', 'text/plain; charset=utf-8'); return res.status(r.status).send(r.text); }
  return res.status(r.status).json(r.json);
}
