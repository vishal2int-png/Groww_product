// Update the Gemini key on this machine/server: `npm run set-key` (add --skip-test to save without a live check).
// Writes GEMINI_API_KEY to the git-ignored .env file. A running `npm start` picks it up within ~2 s, no restart.
import readline from 'node:readline';
import * as K from '../lib/keystore.js';

function ask(q) {
  return new Promise(res => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => { if (s.includes(q)) rl.output.write(s); else rl.output.write('*'); };
    rl.question(q, a => { rl.close(); process.stdout.write('\n'); res(a.trim()); });
  });
}
const key = process.env.NEW_GEMINI_API_KEY || await ask('Paste the new Gemini API key (input hidden): ');
if (!K.looksLikeKey(key)) { console.error('That doesn’t look like a Gemini API key. Nothing changed.'); process.exit(1); }
if (!process.argv.includes('--skip-test')) {
  process.stdout.write('Checking the key with a live Gemini call… ');
  try { await K.testKey(key); console.log('OK'); }
  catch (e) { console.log('failed'); console.error(String(e.message || e).slice(0, 300)); console.error('Nothing changed. Use --skip-test to save anyway.'); process.exit(1); }
}
K.saveKey(key);
console.log(`Saved to ${K.ENV_FILE} (…${key.slice(-4)}). A running server reloads it automatically.`);
