// TEST ONLY: serves the real app with a fake model client (no Gemini calls). Never used by `npm start`.
import { createServer } from '../server.js';
import { createHandlers } from '../lib/handlers.js';
import * as K from '../lib/keystore.js';
import { fakeClient } from './fake-client.js';
const failVideo = process.argv.includes('--fail-video');
K.init();
createServer(createHandlers({ client: fakeClient({ failVideo }), makeClient: () => fakeClient() })).listen(+process.argv[2] || 3111);
