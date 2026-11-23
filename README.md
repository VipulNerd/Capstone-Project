# Capstone-Project: AI Minutes of Meeting

Record a meeting from the browser (your mic + the meeting's audio). The backend transcribes it, puts names to the speakers and drafts structured minutes (summary, discussion points, decisions, action items). The organiser reviews and approves them, and they are emailed as PDF or DOCX.

| Folder | What | Docs |
|---|---|---|
| [`backend/`](backend) | FastAPI + PostgreSQL + OpenAI API | [backend/README.md](backend/README.md) |
| [`frontend/`](frontend) | React (Vite) UI | [frontend/README.md](frontend/README.md) |

## Quick start

```bash
# backend (terminal 1)
cd backend && pip install -r requirements-dev.txt && copy .env.example .env   # set DATABASE_URL, OPENAI_API_KEY, SECRET_KEY
alembic upgrade head && uvicorn app.main:app --reload                        # http://localhost:8000/docs

# frontend (terminal 2)
cd frontend && npm install && cp .env.example .env && npm run dev            # http://localhost:5173
```

Or run everything in Docker: `docker compose up --build`, then open http://localhost:8080. This needs `backend/.env`.

**Azure OpenAI:** deploy `gpt-4o-transcribe-diarize` and `gpt-5.1` in Azure AI Foundry. Put the key, deployment names, `OPENAI_BASE_URL=https://<resource>.openai.azure.com/` and `OPENAI_API_VERSION=2025-04-01-preview` in `backend/.env`, then start the backend with `backend\start-azure.ps1`.

## Docs

| | |
|---|---|
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deploy to Azure Container Apps + PostgreSQL + Azure OpenAI in one resource group (`infra/provision.ps1`, `infra/deploy.ps1`) |
| [docs/TESTING.md](docs/TESTING.md) | Unit, E2E (`npm run test:e2e`), AI smoke, deployed smoke, UAT and non-functional checklists |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | Recording a Teams meeting with the floating overlay |
