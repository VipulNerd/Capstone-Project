# Testing

| Level | What it covers | How to run | When |
|---|---|---|---|
| Backend unit/API | Routers, recording pipeline, speaker mapping, review and approval rules, calendar, users (31 tests, fake AI, in-memory SQLite) | `cd backend && .venv\Scripts\python -m pytest` | CI on every push/PR (`.github/workflows/backend.yml`) |
| Frontend static | Lint + production build | `cd frontend && npm run lint && npm run build` | CI on every push/PR (`.github/workflows/frontend.yml`) |
| E2E regression | Whole UI flow in Chrome against the **real backend code** with a fake AI (see below) | `cd frontend && npm run test:e2e` | Before every merge |
| AI integration | Real diarized transcription + MOM extraction against Azure OpenAI | `backend\.venv\Scripts\python scripts\azure_ai_smoke.py <audio>` | After changing models, keys or region |
| Deployed smoke | Health, sign-up, real upload → AI → approve → email on a deployment | `E2E_BASE_URL=https://<app> E2E_AUDIO=<audio> npm run test:smoke` | After every `deploy.ps1` |
| Acceptance (UAT) | Real Teams meeting, checklist below | Manual | Before the demo |
| Non-functional | Long meeting, network drop, timings, cost | Manual, checklist below | Once, for the report |

## E2E regression (`frontend/e2e/regression.spec.js`)
`npm run test:e2e` starts `scripts/fake_ai_backend.py` (the real FastAPI app with a fresh SQLite database, a fake AI and a mailer that rejects `bounce*` addresses) on port 8001, and a Vite dev server on port 5174 with 4-second audio slices. It then drives Chrome through:
1. Login redirect, form validation, account creation, one-time token, duplicate email
2. Outlook hidden when not configured
3. New meeting: validation, recording consent, organiser added automatically
4. Microphone capture sliced into chunks, meeting-audio screen share, pause/resume, file-upload fallback, navigation guard
5. End → every chunk on the server → processing → review
6. Approval blocked by an unnamed "Speaker 0B" and missing owners, then fixed and approved
7. Email distribution with one failed recipient shown
8. Transcript TXT download
9. Meeting from an `.ics` invite (4 participants)
10. An unreadable chunk → "Processing failed" → "retry without unreadable chunks" offered
11. Discard a meeting
12. Token sign-in, wrong token rejected, token rotation revokes the old one
13. A second user can't open the first user's meeting
14. No horizontal scrolling at phone width

The HTML report with screenshots is in `frontend/e2e/report` (`npx playwright show-report e2e/report`).

## Test recordings
Keep 2–3 real recordings for the AI and smoke tests, for example yourself plus a friend reading a short scripted meeting with names, a decision and two action items with deadlines:
- `two_speakers_2min.m4a`: basic check
- `four_speakers_10min.m4a`: diarization quality
- `noisy_5min.m4a`: background noise or accents

Write down the expected decisions and action items so the AI output can be scored.

## UAT checklist (real Teams meeting, 3 people)
| # | Check | Pass? | Notes |
|---|---|---|---|
| 1 | Teams in the browser: "Share meeting audio" → tab with *Share tab audio* records the other participants | | |
| 2 | Teams desktop: *Entire screen + Share system audio* records the other participants (Windows) | | |
| 3 | Pop-out overlay stays above Teams; Pause, Resume and End work from it | | |
| 4 | Meeting picked from Outlook brings in the title and attendees | | |
| 5 | Processing finishes; time taken: ___ min for ___ min of audio | | |
| 6 | Speakers named correctly: ___ / ___ | | |
| 7 | Decisions captured: ___ / ___ expected | | |
| 8 | Action items captured with the right owner: ___ / ___ | | |
| 9 | Edits needed before approving: ___ | | |
| 10 | Email received by every participant, PDF opens | | |
| 11 | DOCX export opens in Word | | |
| 12 | Transcript downloads (TXT/DOCX/PDF) | | |

## Non-functional checks
| Check | How | Result |
|---|---|---|
| 60-min meeting (30 slices × 2 tracks) | Record a long call or play a long video into the tab | |
| Network drop | Turn Wi-Fi off for 1 min while recording; uploads should retry and the chunk table catch up | |
| Browser reload mid-meeting | Reload the record page; continue; numbering continues | |
| Processing time vs audio length | From the smoke test annotations or the UI | |
| Azure cost per meeting | Cost Management → filter by resource group, before/after a test day | |
| Logs on failure | `az containerapp logs show -n mom-backend -g <rg>` shows the pipeline error | |
