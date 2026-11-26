import { handlers, send } from './_shared.js';
export default function handler(req, res) { send(res, handlers().sampleTranscript(String(req.query.id || ''))); }
