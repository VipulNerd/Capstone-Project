# MinutesAI: Frontend

The React UI for the AI Minutes-of-Meeting system, built on the FastAPI backend in [`../backend`](../backend).

The browser acts as the backend's **overlay agent**. During a meeting it records two audio tracks: your microphone, and the meeting's audio from a shared tab or screen. It uploads the audio in slices as the meeting goes. When you end the meeting, the backend transcribes the audio, puts names to the voices and drafts the minutes. You review, approve and email them.

**Stack:** Vite · React 19 (JavaScript/JSX) · React Router 7 · Axios · Context API · CSS Modules · MediaRecorder · Document Picture-in-Picture

## Running locally

1. Start the backend (see [`backend/README.md`](../backend/README.md)): `alembic upgrade head`, then `uvicorn app.main:app --reload` on port 8000.
2. Start the frontend:
   ```bash
   cd frontend
   npm install
   cp .env.example .env     # first time only
   npm run dev              # http://localhost:5173
   ```
3. Open the app and **Create account**. Copy the API token it shows you; it's your sign-in key and is shown only once.

The dev server proxies `/api/*` to `http://localhost:8000/*`, so the backend's CORS settings don't matter. A red banner appears if the backend or its database is unreachable.

**Docker:** from the repo root, run `docker compose up --build` and open http://localhost:8080. nginx serves the app and forwards `/api` to the backend container.

| Script | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm run lint` | Lint with oxlint |
| `npm run test:e2e` | Full UI regression in Chrome against the backend with a fake AI (starts both servers itself) |
| `npm run test:smoke` | Real-AI smoke test against a deployment: set `E2E_BASE_URL` (and `E2E_AUDIO` for the AI part) |

### Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `VITE_API_BASE_URL` | `/api` | Where API calls go. A full URL calls the backend directly, and its `CORS_ORIGINS` must then include this site |
| `VITE_PROXY_TARGET` | `http://localhost:8000` | Dev server only: where `/api` is forwarded |
| `VITE_CHUNK_SECONDS` | `120` | Length of each recorded audio slice (backend recommends 2–5 min) |
| `VITE_MAX_CHUNK_MB` | `25` | Keep in sync with the backend's `MAX_CHUNK_MB` |
| `VITE_FEATURE_SEARCH` | `false` | Shows the semantic search screen (no backend endpoint yet) |

## Screens and workflow

| Route | Screen | Backend calls |
|---|---|---|
| `/login` | Create an account (token shown once) or sign in with a token | `POST /users`, `GET /users/me` |
| `/` | Dashboard: in progress, awaiting approval, recent | `GET /meetings` |
| `/meetings/new` | Pick the meeting: from **Outlook**, an **.ics invite**, or typed-in title and participants. **Recording consent** is required | `GET /calendar/events`, `POST /meetings`, `POST /meetings/from-ics` |
| `/meetings/:id/record` | Capture the mic and meeting audio, pause, pop out the overlay, upload a file instead, end or discard | `POST /meetings/{id}/audio`, `GET …/chunks`, `POST …/end`, `DELETE /meetings/{id}` |
| `/meetings/:id/processing` | Progress (chunks transcribed → speakers → MOM). On failure: **Retry**, or retry without unreadable chunks | `GET /meetings/{id}`, `GET …/chunks`, `POST …/retry` |
| `/meetings/:id/review` | Edit the MOM, participants and action items, read the transcript, then approve | `PUT …/mom`, `POST …/approve`, `GET …/transcript` |
| `/meetings/:id/distribute` | PDF or DOCX, send or resend, delivery log, withdraw approval | `POST …/distribute`, `GET …/deliveries`, `POST …/reopen`, `GET …/export` |
| `/meetings/:id` | Final MOM, transcript downloads (TXT/DOCX/PDF), delivery log, delete | `GET …/transcript?format=…`, `DELETE /meetings/{id}` |
| `/history` | Filter and sort your meetings | `GET /meetings` |
| `/settings` | Account, new API token, connect or disconnect Outlook | `POST /users/me/rotate-token`, `/calendar/…` |

Each page checks the meeting's status and redirects to the right screen, e.g. opening `/review` on a meeting that's still recording goes to `/record`.

**Status flow:** `recording → finalizing → draft → approved → distributed`. `finalizing` can end in `failed`, and `/retry` resumes it. `approved → draft` happens via *Withdraw approval*.

### How recording works

[`src/api/trackRecorder.js`](src/api/trackRecorder.js) and [`src/hooks/useMeetingRecorder.js`](src/hooks/useMeetingRecorder.js) implement the backend's agent contract:

- **Two tracks.** `mic` comes from `getUserMedia` and is automatically labelled with your name. `meeting` comes from `getDisplayMedia`: pick the Teams/Meet/Zoom browser tab with "Share tab audio" on, or your entire screen with "Share system audio" for a desktop app. Either track can be used alone.
- **Slices.** Every `VITE_CHUNK_SECONDS` a fresh `MediaRecorder` starts, so each upload is a standalone webm/opus file the backend can transcribe on its own. Pausing closes the current slice.
- **`offset_ms`** is measured from the server's `recording_started_at`, so both tracks share one clock. If you reload the page you can continue recording, and numbering carries on from `GET /chunks`.
- **Uploads** run in order and retry with backoff, which is safe because the endpoint is idempotent per (track, seq). Before `/end` the app waits for the queue, compares it with `GET /chunks` and re-sends any gaps.
- **Overlay:** "Pop out overlay" opens an always-on-top mini window (Chrome/Edge) with the timer, track status, Pause and End.
- **Fallback:** "Upload a recording instead" sends an existing audio file (≤ 25 MB) as one slice.

### Sign-in

`POST /users` returns an API token **once**. The app keeps it in `localStorage` and sends it as `Authorization: Bearer …` on every request. A 401 (for example after the token was rotated elsewhere) signs you out. To use another browser, choose *I have a token*. Settings → *Get a new token* revokes the old one.

### Other behaviour that follows the backend

- **Participants** come from the invite or calendar, plus the ones you type in, plus you. The backend adds anyone the AI hears (marked *Heard in the meeting*). Voices it can't match keep names like `Speaker 3A`, and approval is blocked until they're named.
- **Recipients** are every participant with an email plus the organiser, de-duplicated the same way the backend does it.
- **Datetimes** are treated as UTC even when the database omits the offset (SQLite does), see `utc()` in [`src/api/mappers.js`](src/api/mappers.js). All snake_case ↔ camelCase mapping lives in that file.
- **Outlook** appears only if the backend has `MS_CLIENT_ID` set. Otherwise the app offers `.ics` invites and manual entry.

## Project structure

```
src/
  api/          axios client, mappers, services (users, calendar, meetings, mom, email), trackRecorder
  context/      AuthContext (API token session), ToastContext
  hooks/        useApi, usePolling, useMeetingRecorder, usePictureInPicture
  components/
    common/     Button, form fields, Modal/ConfirmDialog, Spinner, ErrorMessage, TokenReveal, ...
    layout/     AppLayout (sidebar, top bar, backend health banner)
    mom/        EditableList, ActionItemTable, ParticipantList, MomView, TranscriptView, DeliveryTable, WorkflowStepper
    live/       RecTimer, RecordingOverlay, TranscriptFeed, Avatar
  pages/        one component per route
  utils/        validators, recipients, date/file helpers, status labels
```

## Deployment

**Docker:** a multi-stage build (node, then nginx) serves the app and proxies `/api` to `BACKEND_URL` (default `http://backend:8000`). It's part of the root `docker-compose.yml`. nginx uses the container's own DNS server, so the same image works in Docker and Azure.

**Azure Container Apps:** the same image runs as the public `mom-frontend` app, forwarding `/api` to the internal backend app. See [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md). Recording needs HTTPS, which Container Apps provides. `.github/workflows/frontend.yml` lints and builds on every push and PR.
