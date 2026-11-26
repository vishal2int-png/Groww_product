// TEST ONLY: stands in for the Gemini client so the flow can be exercised without a key.
export function fakeClient({ failVideo = false } = {}) {
  const calls = [];
  return {
    calls,
    models: {
      async generateContent(req) {
        calls.push(req);
        const parts = req.contents[0].parts, text = parts[parts.length - 1].text;
        const video = parts[0].fileData;
        if (video && failVideo) throw new Error('INVALID_ARGUMENT: video not accessible');
        if (/practice question/.test(text)) return { text: video
          ? JSON.stringify({ question: 'TEST-Q video', answer: 'TEST-A', why: 'TEST-WHY', time: '03:20' })
          : JSON.stringify({ question: 'TEST-Q transcript', answer: 'TEST-A [P2]', why: 'TEST-WHY [P2]', citations: ['P2'] }) };
        if (video) return { text: JSON.stringify({ supported: true, answer: 'TEST video answer [P9]', moments: [{ time: '03:20', what: 'TEST what' }, { time: 'bad' }], step: 'TEST step' }) };
        const ids = [...text.matchAll(/^\[(P\d+)\]/gm)].map(m => m[1]);
        return { text: '```json\n' + JSON.stringify({ supported: true, answer: `TEST transcript answer [${ids[1] || ids[0]}]`, citations: [ids[1] || ids[0], 'P999'], step: 'TEST step' }) + '\n```' };
      },
    },
  };
}
