# Backend: MOM Generator API

FastAPI + PostgreSQL service that turns a meeting recording or transcript into structured
Minutes of Meeting (MOM), lets the organiser review/edit/approve it, then emails it as PDF/DOCX.

## Workflow / status machine

```
upload ─► uploaded ─► POST /process ─► processing ─► draft ──► POST /approve ─► approved ─► POST /distribute ─► distributed
                                            │          ▲  │                       │
                                            ▼          │  └── PUT /mom (edit)      └── POST /reopen ─► draft
                                          failed ──────┘ (retry /process)
```

Distribution is refused (HTTP 409) unless the MOM is **approved**. Approved MOMs are locked against edits.

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/meetings` | Upload audio (`.mp3 .m4a .wav .webm .mp4 .ogg .flac`) or transcript (`.txt .md .vtt .srt`) as multipart form: `file`, `title`, `organizer_name`, `organizer_email`, optional `meeting_date`, optional `participants` (JSON `[{"name","email"}]`) |
| GET | `/meetings?status=` | List meetings |
| GET | `/meetings/{id}` | Full MOM + participants + action items |
| POST | `/meetings/{id}/process` | Transcribe (audio) + LLM extraction in background; poll `GET` until `draft`/`failed` |
| PUT | `/meetings/{id}/mom` | Edit draft (summary, points, decisions, participants, action items) |
| POST | `/meetings/{id}/approve` | `{"approved_by": "..."}` |
| POST | `/meetings/{id}/reopen` | Withdraw approval (before distribution) |
| GET | `/meetings/{id}/export?format=pdf\|docx` | Download MOM |
| POST | `/meetings/{id}/distribute` | `{"format": "pdf"\|"docx"}`. Emails participants + organiser, records per-recipient status |
| GET | `/meetings/{id}/deliveries` | Delivery log |
| DELETE | `/meetings/{id}` | Delete meeting and its uploaded file |

Interactive docs: http://localhost:8000/docs

## Local setup (no Azure needed)

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate            # Windows  (source .venv/bin/activate on Linux/macOS)
pip install -r requirements-dev.txt
copy .env.example .env            # then edit DATABASE_URL and OPENAI_API_KEY
```

Create the database, either on your local Postgres:

```bash
psql -U postgres -c "CREATE DATABASE mom_db;"
```

…or with Docker (`docker compose up -d db` from the repo root, then use
`DATABASE_URL=postgresql+psycopg://mom:mom@localhost:5433/mom_db`).

Then:

```bash
alembic upgrade head
uvicorn app.main:app --reload
pytest                            # runs offline: SQLite + fake OpenAI + fake mailer
```

To run the same tests against real Postgres, point `TEST_DATABASE_URL` at a **throwaway**
database (all tables in it are dropped between tests):

```bash
set TEST_DATABASE_URL=postgresql+psycopg://postgres:<password>@localhost:5432/mom_test
pytest
```

## Azure-free substitutes (swap later)

| Concern | Now | Later on Azure |
|---|---|---|
| Database | Local Postgres / Docker | Azure Database for PostgreSQL (just change `DATABASE_URL`) |
| File storage | `UPLOAD_DIR` on local disk (`app/services/storage.py`) | Azure Blob Storage |
| Email | `EMAIL_BACKEND=console` writes `.eml` files to `data/outbox/`; `smtp` sends for real | SMTP or Microsoft Graph (add a `Mailer` implementation) |

## Notes

- OpenAI transcription accepts files up to 25 MB; larger recordings need compressing or chunking (not yet implemented).
- Very long transcripts are sent to the LLM in one request; chunking can be added if you hit context limits.
- Semantic search (embeddings + FAISS) is not built yet. Approved MOMs are already stored, so it can be added as an indexing step on approve.
