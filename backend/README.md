# Backend: MOM Generator API

FastAPI + PostgreSQL backend for an on-screen **overlay agent** that records a meeting, produces a
refined, speaker-labelled transcript, drafts Minutes of Meeting (MOM), and emails them after the
organiser approves.

## How it works

```
Overlay agent (desktop)                          Backend
──────────────────────                           ───────
1. User connects Outlook once ─── OAuth consent ──► /calendar/microsoft/connect  (tokens stored encrypted)
2. Picks today's meeting ◄──────────────────────── GET /calendar/events
3. Confirms recording consent, starts ──────────► POST /meetings   (participants from the invite)
4. Streams audio every few minutes:
     mic track      (user's own voice) ─────────► POST /meetings/{id}/audio  track=mic
     meeting track  (system/loopback audio) ────► POST /meetings/{id}/audio  track=meeting
5. Meeting ends ────────────────────────────────► POST /meetings/{id}/end
                                                   ├ transcribe all chunks (parallel, diarized)
                                                   ├ merge both tracks on one timeline
                                                   ├ LLM: map speaker labels -> invite names
                                                   ├ LLM: clean text, drop mic echo
                                                   └ LLM: draft MOM
6. Shows / downloads transcript ◄──────────────── GET /meetings/{id}/transcript?format=txt|docx|pdf|json
7. Review → approve → email MOM ────────────────► PUT /mom, POST /approve, POST /distribute
```

Why two tracks: the meeting app does not play the user's own voice back through the speakers, so
loopback audio has everyone *except* the user, and the mic has the user. Labelling the mic track
with the user's name is therefore free and reliable; only the meeting track needs diarization.

### Status machine

```
recording ──/end──► finalizing ──► draft ──/approve──► approved ──/distribute──► distributed
                        │            ▲  └─ PUT /mom        └─ /reopen ─► draft
                        ▼            │
                      failed ──/retry┘   (resumes: already-transcribed chunks are not re-sent)
```

The refined transcript is saved as soon as it is built, so it stays downloadable even if MOM
generation fails.

## API

All endpoints except `POST /users` and the OAuth callback need `Authorization: Bearer <api_token>`.
Users only ever see their own meetings.

| Method | Path | Purpose |
|---|---|---|
| POST | `/users` | Register `{name, email}` → returns `api_token` **once** |
| GET | `/users/me` · POST `/users/me/rotate-token` | Current user · new token (old one stops working) |
| GET | `/calendar/microsoft/connect` | Returns Microsoft consent URL to open in a browser |
| GET | `/calendar/connections` · DELETE `/calendar/connections/microsoft` | List · withdraw consent (deletes tokens) |
| GET | `/calendar/events?start=&end=` | Outlook meetings (default: 2 h ago → 12 h ahead) with attendees |
| POST | `/meetings` | Start recording: `{recording_consent: true, calendar_event_id}` or `{recording_consent: true, title, participants}` |
| POST | `/meetings/from-ics` | Start recording from an invite file (multipart: `invite`, `recording_consent`) |
| POST | `/meetings/{id}/audio` | Multipart: `track` (`mic`/`meeting`), `seq`, `offset_ms`, `file`. Idempotent per (track, seq) |
| GET | `/meetings/{id}/chunks` | What the server received (to re-send gaps) |
| POST | `/meetings/{id}/end` | Stop recording, start finalization (poll `GET /meetings/{id}`) |
| POST | `/meetings/{id}/retry` | After `failed`; `{"skip_failed_chunks": true}` continues without unreadable chunks |
| GET | `/meetings/{id}/transcript?format=txt\|docx\|pdf\|json` | Download refined transcript |
| GET | `/meetings`, `/meetings/{id}` · DELETE `/meetings/{id}` | List / detail / delete (also deletes audio) |
| PUT | `/meetings/{id}/mom` | Edit draft MOM, participants, action items |
| POST | `/meetings/{id}/approve` · `/reopen` | Approve (locks MOM) · withdraw approval |
| GET | `/meetings/{id}/export?format=pdf\|docx` | Download MOM |
| POST | `/meetings/{id}/distribute` · GET `/deliveries` | Email approved MOM · per-recipient delivery log |

Interactive docs: http://localhost:8000/docs

### Contract for the overlay agent

- **Chunks:** record each track continuously, cut every 2–5 minutes, upload each slice as it closes.
  `seq` counts from 0 per track; `offset_ms` is when that slice started, measured from the moment
  recording began (one monotonic clock shared by both tracks; this is what aligns mic and meeting audio).
- **Format:** webm/opus, ogg, wav, mp3, m4a, flac. Mono, 16 kHz, compressed is plenty (≈ 1 MB/min as opus).
  Max 25 MB per chunk.
- **Retries:** re-sending the same (track, seq) is safe. Before `/end`, compare with `GET /chunks`.
- **Consent:** show a clear "this meeting will be recorded" confirmation before calling `POST /meetings`.

## Local setup (no Azure needed)

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate                    # Windows  (source .venv/bin/activate on Linux/macOS)
pip install -r requirements-dev.txt
copy .env.example .env                    # set DATABASE_URL, OPENAI_API_KEY, SECRET_KEY
psql -U postgres -c "CREATE DATABASE mom_db;"   # or: docker compose up -d db  (port 5433)
alembic upgrade head
uvicorn app.main:app --reload
pytest                                    # offline: SQLite + fake OpenAI/mailer/Graph
```

Run the tests against real Postgres with a **throwaway** database (tables are dropped between tests):
`set TEST_DATABASE_URL=postgresql+psycopg://postgres:<password>@localhost:5432/mom_test`

### Outlook calendar (optional)

Without `MS_CLIENT_ID` the calendar endpoints return 503 and you use `.ics` invites or manual
participants. To enable it, register an app in the **Microsoft Entra admin center** (free; this is
not an Azure subscription):

1. App registrations → New registration → "Accounts in any organizational directory and personal
   Microsoft accounts" → Redirect URI (Web) `http://localhost:8000/calendar/microsoft/callback`
2. Certificates & secrets → new client secret → `MS_CLIENT_SECRET`; Application (client) ID → `MS_CLIENT_ID`
3. API permissions → Microsoft Graph → Delegated: `Calendars.Read`, `User.Read`, `offline_access`

## Azure-free substitutes (swap later)

| Concern | Now | Later on Azure |
|---|---|---|
| Database | Local Postgres / Docker | Azure Database for PostgreSQL (change `DATABASE_URL`) |
| Audio storage | `AUDIO_DIR` on local disk (`app/services/storage.py`) | Azure Blob Storage |
| Email | `console` (`.eml` files) or `smtp` | SMTP or Microsoft Graph `sendMail` |

## Known limitations

- **Model lifetime:** OpenAI has announced shutdown of `gpt-4o-transcribe-diarize` on 2027-02-26;
  `OPENAI_TRANSCRIBE_MODEL` must point to a successor that supports `diarized_json`.
- **Speaker names are inferred.** Diarization labels are per chunk; the LLM maps them to invite names
  from context and only accepts names on the invite. Unconfident labels stay as `Speaker 3A`.
  Longer chunks give better consistency.
- **Background work runs in the API process.** A restart during `finalizing` leaves the meeting stuck
  in that status (a job queue such as Celery/RQ would fix this).
- **PDF fonts:** built-in Helvetica cannot render Devanagari etc.; DOCX/TXT/JSON are fine.
- **Registration is open** (`POST /users`); put it behind an admin or SSO before real use.
- Semantic search (embeddings + FAISS/pgvector) is not built yet.
