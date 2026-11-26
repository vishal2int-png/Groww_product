# LectureLoop

LectureLoop is for an engineering student stuck at one step of a recorded lecture. They paste the YouTube link at the
moment they paused and ask "Why did the professor drop that term here?". The app gives a short answer pinned to where
the lecture explains it, then offers one practice question on that step.

## Models

| Route | Model | Why |
|---|---|---|
| Transcript answers, recall questions, key check | **Gemma 4 26B** (`gemma-4-26b-a4b-it`), served by the Gemini API | Chosen by the project owner |
| YouTube-link (video) answers and video recall | **Gemini 3.8 Flash** (`gemini-3.8-flash`) | The Gemini API documents YouTube video input for Gemini models; for Gemma 4 it documents text and image input only |

Both use the same `GEMINI_API_KEY`. Override with `GEMINI_TEXT_MODEL` / `GEMINI_VIDEO_MODEL`.

## How answers are grounded

| Evidence | When | Citation shown |
|---|---|---|
| Real timestamped transcript | A transcript is attached, or the link matches a sample whose transcript is in `data/transcripts/` | **Transcript · 12:40** (caption cue start). Untimed PDF → **PDF · p. 4**, pasted text → **Text · ¶ 3** |
| The video itself | Any public YouTube link without a transcript | **Video · around 12:40**. The answer is labelled as Gemini's paraphrase |

Video answers use the Gemini API's YouTube video input, with Gemini 3.8 Flash. The URL is sent as a `fileData` part (`fileUri`), not as
text in the prompt. When the student gives a time, only a clip around it is sent (`videoMetadata.startOffset` /
`endOffset`, 4 minutes before to 1 minute after). If video processing fails, the student keeps their link, time and
question, and can continue with an SRT, a selectable-text PDF or pasted text.

## Run locally

```bash
npm install
GEMINI_API_KEY=your-key npm start      # http://localhost:3000
npm test                               # server tests (use a fake model client, never the app)
```

Without `GEMINI_API_KEY`, the app still loads but shows a banner, and questions return a "not configured" error.
There are no canned answers.

## Updating the Gemini key

The key is read from the `GEMINI_API_KEY` environment variable. You can update it three ways. None of them expose
the key to the browser: the app only ever reports whether it's set and its last 4 characters.

1. **Admin page: `/admin`** (owner only). Set `ADMIN_TOKEN` (12+ characters) on the server, open `/admin`, unlock
   it with the token, then use **Test current key** or **Test and save** a new one. A new key is checked with a live
   Gemini call before it's accepted. On a Node host, it's written to the server's git-ignored `.env` and switched over
   without a restart. On Vercel, the page explains how to change the variable in the dashboard and redeploy, because
   serverless functions can't rewrite their own environment. Without `ADMIN_TOKEN`, the page stays off.
2. **Terminal on the server:** `npm run set-key`. It prompts for the key without showing it, checks it live, and
   writes `.env`. A running `npm start` reloads it within about 2 seconds.
3. **Hosting dashboard:** edit `GEMINI_API_KEY` there (Vercel: Settings → Environment Variables → Redeploy).
   A variable set by the host takes priority over `.env`.

## Deploy (needs a host that runs Node and stores secrets)

The key lives only on the server, in the `GEMINI_API_KEY` environment variable. Browser code never sees it, and it
is not in this repo (`.env` is git-ignored; see `.env.example`).

**Vercel:** import the repo → Settings → Environment Variables → add `GEMINI_API_KEY` → Deploy.
`public/` is served statically and `api/*.js` become serverless functions. Video answers can take 20–60 s, and
`vercel.json` sets `maxDuration: 60`. If the key changes later, edit the variable and redeploy, or follow the
steps on `/admin`.

**Render / Railway / Fly / any Node host:** start command `npm start`, set `GEMINI_API_KEY`, Node 20+.

Optional variables: `ADMIN_TOKEN` (turns on `/admin`), `GEMINI_TEXT_MODEL` (default `gemma-4-26b-a4b-it`), `GEMINI_VIDEO_MODEL` (default `gemini-3.8-flash`) and `RATE_LIMIT` (questions per IP per 10 minutes,
default 40; this protects the shared key on a public demo).

YouTube input limits (Gemini docs, Nov 2026): public videos only, about 8 hours of video per day on the free tier,
and the feature is in preview.

## Samples

`data/samples.json` lists the demo lectures.

- **Vehicle Dynamics, Lecture 2 – Longitudinal Dynamics.** NPTEL, Dr. R. Krishnakumar, IIT Madras.
  YouTube `T7el7XL1aK8` ("Mod-01 Lec-02 Longitudinal Dynamics", nptelhrd). It's ready now and answers from the video.
  To switch it to transcript evidence, add the real caption file as `data/transcripts/T7el7XL1aK8.srt`. The app picks
  it up automatically.
- **Vehicle Load Distribution – Acceleration and Braking.** It shows as "coming soon" until `videoUrl` is set and
  its real transcript file exists (`requireTranscript: true`).

Never write, edit or generate lecture text, timestamps or quotes for a sample.

## Layout

```
server.js            Node server (static + /api)
api/*.js             Vercel function wrappers
lib/gemini.js        prompts, Gemini request building, reply parsing (server-only)
lib/handlers.js      /api/config, /api/sample, /api/ask, /api/test, /api/admin/*
lib/keystore.js      key loading, live key test, .env update + hot swap, admin token check
scripts/set-key.js   `npm run set-key`
public/              the app + admin.html (no secrets)
data/                sample registry + real transcripts
test/                node:test suite; fake-client.js is test-only
```
