# MinutesAI — Frontend

The React UI for the AI Minutes-of-Meeting system. MinutesAI runs as an **overlay on Microsoft Teams meetings**. It captures the meeting audio, transcribes it live with speaker labels, and picks up the participants automatically from the Teams roster. When the meeting ends it drafts the MOM. The organiser reviews and approves it, then emails it to every participant. Uploading a recording or transcript is still supported for meetings that weren't captured live.

**Stack:** Vite · React 19 (JavaScript/JSX) · React Router 7 · Axios · Context API · CSS Modules

## Getting started

```bash
cd frontend
npm install
cp .env.example .env     # first time only
npm run dev              # http://localhost:5173
```

In demo mode you can sign in with any email and a password of 6 or more characters.

| Script | What it does |
|---|---|
| `npm run dev` | Start the dev server with hot reload |
| `npm run build` | Build for production into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Lint with oxlint |

### Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:8000` | FastAPI backend URL |
| `VITE_USE_MOCK` | `true` | `true` uses the in-browser mock backend (`src/api/mockServer.js`); `false` calls the real API |

Vite reads these when it **builds**, so restart `npm run dev` after you change them.

## Screens and workflow

| Route | Screen | Workflow step |
|---|---|---|
| `/login` | Login | Organiser signs in |
| `/` | Dashboard | Stats, drafts awaiting approval, recent meetings |
| `/live/new` | Start live capture | Pick one of today's Teams meetings (Microsoft Graph) or paste a join link |
| `/live/:id` | Live session | Real-time transcript with speakers, auto-detected participants, pause/stop, **pop-out overlay** |
| `/meetings/new` | Upload (fallback) | Audio file, transcript file, or pasted transcript. Optionally link a Teams meeting for its roster |
| `/meetings/:id/processing` | Processing | Transcription → LLM extraction, updated by polling |
| `/meetings/:id/review` | Review & approve | Edit summary, points, decisions, action items (owner, deadline) and participants, then **approve** |
| `/meetings/:id/distribute` | Distribute | Choose PDF/DOCX, send, track delivery for each recipient, retry failures |
| `/meetings/:id` | Meeting detail | Read-only approved MOM, downloads, delivery log |
| `/history` | History | Filter and sort all meetings |
| `/search` | Search | Semantic search over approved MOMs |

### How the overlay works

1. The organiser opens MinutesAI in Chrome/Edge and starts a capture for their Teams meeting.
2. **Share Teams audio** calls `getDisplayMedia`. The organiser picks the Teams tab or window with audio on, and their microphone is mixed in. `src/api/audioCapture.js` records 1-second webm/opus chunks and streams them over a WebSocket.
3. **Pop out overlay** uses the Document Picture-in-Picture API (`src/hooks/usePictureInPicture.js`) to open a small always-on-top window over Teams. It shows the timer, the current speaker, the latest lines, and Pause/Stop.
4. The backend transcribes the audio, separates the speakers (diarization) and matches them to the Teams roster from Microsoft Graph. It pushes transcript and participant events back to the page.
5. **Stop** ends the session, and the backend generates the MOM draft.

Participants are never typed in by hand. They come from the Teams roster, or from detected voices for uploads with no Teams link. A detected voice shows as "Speaker 1", and the organiser must name it before approving. People without an email (for example external guests) are kept in the minutes but aren't emailed.

Every route except `/login` sits behind `ProtectedRoute`. Nothing can be emailed until the MOM is approved.

## Project structure

```
src/
  api/          axios client, one service per backend area, mockServer.js
  context/      AuthContext (session), ToastContext (notifications)
  hooks/        useApi, usePolling, useLiveSession (live reducer), usePictureInPicture
  components/
    common/     Button, Input/TextArea/Select, Modal/ConfirmDialog, Spinner, ErrorMessage, ...
    layout/     AppLayout (sidebar + top bar)
    mom/        EditableList, ActionItemTable, ParticipantList, MomView, DeliveryTable, WorkflowStepper
    live/       TranscriptFeed, LiveParticipants, OverlayPanel, RecTimer, Avatar
  pages/        one component per route
  routes/       ProtectedRoute
  utils/        validators, date/file helpers, status labels
```

## API contract (for the FastAPI backend)

Pages never call axios directly. They call the service functions in `src/api/`, and each one either calls the mock or makes the REST call below. Requests send `Authorization: Bearer <token>`. Errors should return `{ "detail": "message" }`.

| Method & path | Body / params | Response |
|---|---|---|
| `POST /auth/login` | `{ email, password }` | `{ token, user: { email, name } }` |
| `GET /auth/me` | | `{ email, name }` |
| `POST /meetings` | multipart: `file`, `metadata` (JSON string: `{ title, date, sourceType: "audio"\|"transcript", participants: [{name,email}] }`) | `{ id, status }` |
| `GET /meetings` | | `[{ id, title, date, sourceType, fileName, status, createdAt, participantCount, actionItemCount, failedDeliveries }]` |
| `GET /meetings/{id}` | | `{ id, title, date, sourceType, status, ... }` |
| `GET /meetings/{id}/mom` | | `MOM & { status, title, date }` (409 if the draft isn't ready) |
| `PUT /meetings/{id}/mom` | `MOM` | `MOM` (409 if already approved) |
| `POST /meetings/{id}/approve` | | `{ id, status: "approved" }` |
| `GET /meetings/{id}/export?format=pdf\|docx` | | file (blob) |
| `POST /meetings/{id}/send` | `{ formats: ["pdf","docx"] }` | `{ queued }` (409 if not approved) |
| `GET /meetings/{id}/deliveries` | | `[{ email, name, formats, status: "queued"\|"sent"\|"failed", error?, updatedAt }]` |
| `POST /meetings/{id}/deliveries/retry` | `{ email }` | `{ ok: true }` |
| `GET /search?q=...` | | `[{ meetingId, title, date, score (0–1), snippet }]` |
| `GET /teams/meetings?range=today` | | `[{ id, title, start, end, organizer, joinUrl, attendees: [{name,email}] }]` |
| `POST /live-sessions` | `{ teamsMeetingId }` or `{ joinUrl, title? }` | `{ id, status: "live" }` (the id is the meeting id) |
| `GET /live-sessions/{id}` | | snapshot (see below) |
| `POST /live-sessions/{id}/pause` · `/resume` | | `{ paused }` |
| `POST /live-sessions/{id}/stop` | | `{ id, status: "extracting" }` |
| `GET /meetings/{id}/transcript` | | `[{ id, t (seconds), speaker, text }]` |
| `WS /ws/live-sessions/{id}?token=…` | client sends binary audio chunks | server sends JSON events (below) |

**Live WebSocket events (server → client):**

```jsonc
{ "type": "snapshot", "title": "…", "status": "live", "paused": false, "elapsed": 35.2,
  "transcript": [/* lines */], "participants": [/* people */], "invited": 5, "speaking": "Rahul Verma" }
{ "type": "transcript",  "line": { "id": "l9", "t": 32, "speaker": "Karan Mehta", "text": "…" } }
{ "type": "participant", "participant": { "name": "Karan Mehta", "email": "…", "source": "teams", "joinedAt": 30 } }
{ "type": "speaking",    "speaker": "Ananya Iyer" }
{ "type": "status",      "status": "live", "paused": true, "elapsed": 40 }
```

Participants carry `source`: `"teams"` (Teams roster), `"speaker"` (detected voice, not yet named) or `"manual"` (added by the organiser). `email` may be empty.

**Meeting status values:** `live → extracting` (live capture) or `uploaded → transcribing → extracting` (upload), then `draft_ready → approved → sent` (or `failed`).

**MOM shape:**

```json
{
  "summary": "string",
  "discussionPoints": ["string"],
  "decisions": ["string"],
  "actionItems": [{ "id": "string", "task": "string", "owner": "string", "ownerEmail": "string", "deadline": "YYYY-MM-DD" }],
  "participants": [{ "name": "string", "email": "string (may be empty)", "source": "teams|speaker|manual" }]
}
```

FastAPI must allow CORS from the frontend origin (`http://localhost:5173` in development).

## Deployment

**Docker** (nginx serves the static build, with SPA fallback):

```bash
docker build -t mom-frontend --build-arg VITE_USE_MOCK=false --build-arg VITE_API_BASE_URL=https://api.example.com .
docker run -p 8080:80 mom-frontend
```

**Azure Static Web Apps:** `.github/workflows/frontend.yml` lints and builds on every push and PR. On `main` it deploys `dist/`, but only after you add the `AZURE_STATIC_WEB_APPS_API_TOKEN` repository secret. Set the `VITE_API_BASE_URL` and `VITE_USE_MOCK` repository variables to configure the build. SPA routing is configured in `public/staticwebapp.config.json`.
