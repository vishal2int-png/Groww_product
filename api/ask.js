import { handlers, send, ipOf, bodyOf } from './_shared.js';
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const body = bodyOf(req);
  send(res, await handlers().ask(body, ipOf(req)));
}
