import { handlers, send, ipOf } from '../_shared.js';
export default function handler(req, res) { send(res, handlers().adminStatus(req.headers.authorization, ipOf(req))); }
