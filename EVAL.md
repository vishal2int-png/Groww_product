# LectureLoop — UI evaluation

**Date:** 26 Nov 2026 · **Build:** LectureLoop 2.1 (`npm start`, Node 22) at `http://localhost:3000`, run in Claude's cloud workspace
**Method:** Headless Chrome drove the app through its normal UI: typing into fields and clicking buttons. Network requests to `/api/ask` were captured to see exactly what the app sends to the model.
**Not deployed:** there is no public URL, so check 8 is *Not run*.

## Models

After this run, the text route was switched to **Gemma 4 26B (`gemma-4-26b-a4b-it`)**: transcript answers, recall questions and the key check. YouTube-link (video) questions stay on **Gemini 3.8 Flash**, because the Gemini API documents YouTube video input for Gemini models and only text and image input for Gemma 4. No model calls succeeded in this run (no key), so none of the results below depend on the model. Re-run the Not-run checks with these models. Each answer now shows the model that produced it.

## Test conditions that limit this run

- **No Gemini key was available.** `GEMINI_API_KEY` was unset, so every request that needs a model answer got `503 not_configured`. The app showed that error and no answer. Model-dependent criteria are marked **Not run**. No stand-in answers were used anywhere in this eval.
- **The test sandbox blocks youtube.com and Google APIs.** The embedded player and live video input could not be exercised here.
- Viewports tested: desktop 1360×900 and phone 390×844.

## Controlled fixture: "Braking test fixture"

This is a synthetic transcript supplied by the student as a test fixture. It is **not NPTEL material**. It was entered through *Upload or paste a transcript → Paste text*, with the label "Braking test fixture", and it is kept out of `data/`, which holds NPTEL content.

```
[00:10] Assume b is the positive magnitude of deceleration and is constant from the instant braking begins.
[00:35] With final speed zero, stopping distance is d = u²/(2b), where u is initial speed.
[01:05] In the measured run, brake pressure builds gradually. The deceleration history during buildup has not been specified.
```

## Results

| # | Check | Exact input | Expected | Observed | Result |
|---|---|---|---|---|---|
| 1 | Timestamped link | Link `https://youtu.be/T7el7XL1aK8?t=95`, then "I'm stuck at" edited to `01:50`, question "Why did the professor drop that term here?", **Ask** | Sample lecture recognised; field shows `01:35`; request uses the edited time | Link card: "Longitudinal Dynamics · NPTEL sample · link starts at 01:35". Field = `01:35`. Workspace title "Longitudinal Dynamics", field `01:50`, question header "stuck at 01:50". Captured request: `{"mode":"video","videoId":"T7el7XL1aK8","stuckAt":110,…}`. Response: not_configured | **Pass** (link parsing and edited time). Playback starting at 01:35 is **Not run**: YouTube was blocked |
| 2a | Fixture loads as 3 citable passages | Pasted fixture, label "Braking test fixture", stuck `01:05`, question "Why can't I use the earlier equation directly here?" | Three passages at 00:10, 00:35, 01:05; request uses the passage at 01:05 | **First run: FAIL (F1).** One passage labelled 00:10 held all three lines, so 00:35 and 01:05 could not be cited separately. **Retest after fix:** passages P1 00:10, P2 00:35, P3 01:05. Request `stuckAt: 65` with ids P1–P3 | **Fail → Pass after fix** |
| 2b | Answer links 01:05 to the 00:10 assumption and 00:35 equation | Same as 2a | Short answer citing 00:10, 00:35 and 01:05 | No answer (not_configured). The question, time and transcript were kept | **Not run** (no key) |
| 2c | Each citation opens its actual passage | Clicked each passage in the transcript panel (desktop) and each one on the phone | The selected-passage view shows the passage text for that time | Desktop and phone: 00:10 → "Assume b is…", 00:35 → "With final speed zero…", 01:05 → "In the measured run…". Each with neighbouring context, and on the phone in a bottom sheet | **Pass** for the passage view. Clicking citation chips inside an answer is **Not run** (no answer) |
| 3 | Unsupported calculation | "Exactly how many extra metres does buildup add?" (fixture, stuck 01:05) | Says the deceleration history is missing; no number given | The request reached the server in transcript mode with the fixture. Response: not_configured | **Not run** (no key) |
| 4 | Recall quality | **Test me on this step** after 2b | Tests the constant-deceleration assumption, answer hidden until reveal, specific feedback | Not reachable: needs a supported answer from 2b | **Not run** (no key). Note: the app shows the model's answer and explanation after reveal; it doesn't grade the attempt (no "check my reasoning" step) |
| 5 | Fresh public video, live video input | — | Live answer with "Video · around mm:ss"; a person listens at the cited moment | — | **Not run**: no key, YouTube and Gemini blocked in the sandbox, and listening needs a person |
| 6 | Recovery after video failure | — | Question, URL and time survive; attach a transcript; same question completes without retyping | A real video-processing failure can't be triggered without a key. On the not_configured error, the link, time and question were kept (see F3) | **Not run** for video-failure recovery. Note: the attach-and-rerun buttons appear only on a *video* failure. After a not_configured error, attaching a transcript doesn't re-run the question |
| 7 | Source switch, no leakage | From the fixture: **Change lecture** → remove the attached fixture → link `https://www.youtube.com/watch?v=T7el7XL1aK8` → "What happens to brake pressure during buildup in the measured run, and what was left unspecified?" | The new request carries no fixture text and no earlier turns | Title "Longitudinal Dynamics". Request: `mode: video`, no `passages`, `prior: ""`. None of the fixture strings ("Assume b is", "u²/(2b)", "deceleration history") are present. Transcript panel hidden; one turn on screen | **Pass** at the request level. That the *answer* doesn't use fixture content is **Not run** (no key) |
| 8 | Reviewer experience on the deployed URL | — | Private window, sample, new question, citation, recall, no key prompt | No deployment exists | **Not run.** Locally verified: no key prompt anywhere in the UI, the sample opens in one click, and the server keeps the key on the server side (none in `public/`) |

## Failures found, fixes and retests

| ID | First observed failure | Cause | Fix | Retest |
|---|---|---|---|---|
| F1 | Check 2a: the three timestamped fixture lines became **one** passage (label 00:10). Citations for 00:35 and 01:05 were impossible | Pasted-text parser grouped any timestamped lines averaging under 20 words. That rule was meant for YouTube transcript copies | Keep each timestamped line as its own passage. Group only when lines are very short (<8 words) **and** stamped ≤10 s apart. (`public/parsers.js`) | **Pass**: P1 00:10, P2 00:35, P3 01:05 (desktop and phone). A 12-line YouTube-style paste still groups into 1 passage |
| F2 | A pasted transcript couldn't be named, so the fixture showed as "Pasted transcript" | No label field | Added an optional **Label** field to the transcript dialog; with no video link, the label becomes the lecture title | **Pass**: title "Braking test fixture" |
| F3 | Recovery note read "Your time (01:05), and question are kept." (broken sentence when there's no link) | String built with fixed commas | Build the list from the parts actually kept | **Pass**: "Your time (01:05) and question are kept." / "Your link, time (01:50) and question are kept." |
| F4 | Pasted timestamped lines were labelled **"Caption cue"**, which implies a real caption file | Same label for every timed source | "Caption cue" only for SRT/VTT; pasted timestamped text shows **"Timestamped line"**. The chip format stays "Transcript · mm:ss" | **Pass**: 01:05 shows "Timestamped line" |

Server unit tests after the fixes: 11/11 pass (`npm test`). These use a test-only fake model client, and only test request building and parsing.

## What remains unverified, and how to run it

1. Deploy (Vercel or any Node host) and set `GEMINI_API_KEY`. Optionally set `ADMIN_TOKEN` and confirm the key with **Test current key** at `/admin`.
2. Re-run checks 2b, 2c (citation chips in the answer), 3, 4, 5, 6, the answer half of 7, and 8 on the deployed URL, in a private window. Record the exact answer text and the cited times.
3. For check 5, open the cited "Video · around" moment and listen for whether it supports the paraphrase.

## Evidence files

`eval/` holds the screenshots: `c1.png` (check 1), `c2_first.png` (F1 as first observed), `c2_retest.png` (after the fix), `c7.png` (source switch).
