# Deploying to Azure

The whole system runs in **one existing resource group**. Users of the app never need an Azure account. They sign in with the app's own account and API token.

```
Browser ──HTTPS──> mom-frontend  (Container App, nginx, public)
                     │ /api/* → mom-backend (internal only, not reachable from the internet)
                     ▼
                   mom-backend  (Container App, FastAPI, exactly 1 replica)
                     ├── Azure Database for PostgreSQL Flexible Server (B1ms, SSL)
                     ├── Azure Files share "momdata" at /data (audio chunks, email outbox)
                     ├── Azure OpenAI in Azure AI Foundry (transcription + LLM)
                     ├── SMTP (e.g. Gmail app password) for emailing MOMs
                     └── Microsoft Graph (optional) for Outlook calendars
```

| Thing | How it authenticates |
|---|---|
| App users | App account + API token (`Authorization: Bearer …`) |
| Backend to Postgres, Azure OpenAI, Azure Files | Password, API key and storage key held as **Container App secrets**, injected as env vars |
| Outlook | Each user signs in with Microsoft once (Settings → Connect Outlook). Their token is stored encrypted with `SECRET_KEY` |
| You (deploying) | `az login` on your PC |

## 1. Prerequisites
- **Azure CLI** (`az --version`) and `az login`. If you have several subscriptions, run `az account set --subscription <id>`.
- The **name of your resource group**. Check your role with `az role assignment list --assignee <your-email> -g <rg> -o table`. **Contributor** is enough for everything below.
- **Resource providers** registered on the subscription. `provision.ps1` checks and tries to register them; if you lack rights, ask the subscription admin to run `az provider register -n <namespace>` for each of these: `Microsoft.App`, `Microsoft.OperationalInsights`, `Microsoft.DBforPostgreSQL`, `Microsoft.Storage`, `Microsoft.ContainerRegistry`, `Microsoft.CognitiveServices`.
- Docker Desktop is **not** needed, because images are built in Azure (`az acr build`).

## 2. Azure OpenAI (Azure AI Foundry)
1. Open https://ai.azure.com, then **Create project**. Choose your resource group, and a region that offers `gpt-4o-transcribe-diarize` (check the model catalogue; East US 2 and Sweden Central are typical).
2. **Models + endpoints → Deploy model**. Deploy each of these, naming the deployment after the model:
   - `gpt-4o-transcribe-diarize`. The backend needs `diarized_json` speaker labels, and this is the only model that provides them. It's in Preview.
   - `gpt-5.1` (tested; `gpt-5.1-mini` should also work). It writes the MOM. gpt-4o-mini and gpt-4.1-mini are deprecated and can no longer be deployed. The chat model must support JSON mode and accept `temperature=0.1`, which gpt-5.1 does. Check this with `scripts\azure_ai_smoke.py --llm-only` (step 4).
3. Copy the **endpoint** (`https://<resource>.openai.azure.com/`) and **key** from the project overview (Azure OpenAI tab), or from the Azure portal under the resource's **Keys and Endpoint**.
4. Check it locally before deploying:
   ```powershell
   # backend/.env:
   #   OPENAI_API_KEY=<key>
   #   OPENAI_BASE_URL=https://<resource>.openai.azure.com/
   #   OPENAI_API_VERSION=2025-04-01-preview
   #   OPENAI_TRANSCRIBE_MODEL=gpt-4o-transcribe-diarize    (deployment names)
   #   OPENAI_LLM_MODEL=gpt-5.1
   backend\.venv\Scripts\python.exe scripts\azure_ai_smoke.py --llm-only                  # chat model only, no audio, ~1 cent
   backend\.venv\Scripts\python.exe scripts\azure_ai_smoke.py C:\path\two_speakers.m4a    # transcription + chat
   .\backend\start-azure.ps1      # run the backend against Azure, then use the UI as usual
   ```
   **Why `OPENAI_API_VERSION` is needed:** Azure's newer `/openai/v1` API serves chat models but returns 404 for `gpt-4o-transcribe-diarize` (tested November 2026). With an API version set, the backend uses the `AzureOpenAI` client, which calls each model by its deployment (`/openai/deployments/<name>/...`), and both models work.

## 3. Production settings
```powershell
copy infra\azure.env.example infra\azure.env     # gitignored; fill in the Azure OpenAI key/URL and SMTP
```
For Gmail, create an **app password** (Google account → Security → 2-Step Verification → App passwords) and put it in `SMTP_PASSWORD`.

## 4. Provision (once)
```powershell
.\infra\provision.ps1 -ResourceGroup <your-rg>                 # add -AllowMyIp to reach Postgres from pgAdmin
```
This takes about 15 minutes, mostly creating Postgres. It creates the registry, Postgres, file share, Container Apps environment and both apps, then waits for `https://<frontend>/api/health` to report OK. The database tables are created automatically, because the backend runs `alembic upgrade head` at start. It prints the **app URL** and the **Outlook redirect URI**.

Resource names and generated secrets (Postgres password, `SECRET_KEY`) are saved in `infra/.azure-state.env`, which is gitignored. Keep that file: re-runs and `deploy.ps1` need it.

Re-run `provision.ps1` whenever you change `infra/azure.env`. It re-applies settings and secrets without recreating anything.

## 5. Outlook (optional)
1. In the Microsoft Entra admin center: **App registrations → New registration**, with supported accounts set to *any organizational directory + personal accounts*.
2. Under **Authentication → Add a platform → Web**, set the redirect URI to `https://<frontend-fqdn>/api/calendar/microsoft/callback`, as printed by provision.
3. Under **API permissions → Microsoft Graph → Delegated**, add `Calendars.Read`, `User.Read` and `offline_access`.
4. Under **Certificates & secrets → New client secret**, create a secret.
5. Put `MS_CLIENT_ID` and `MS_CLIENT_SECRET` in `infra/azure.env` and re-run `provision.ps1`.

## 6. Redeploy after code changes
```powershell
.\infra\deploy.ps1                  # or -Only backend / -Only frontend
```
This builds both images in Azure, tagged `<git-sha>-<time>`, rolls them out and checks health.

## Operations
| Task | Command |
|---|---|
| Live backend logs | `az containerapp logs show -n mom-backend -g <rg> --follow` |
| Frontend logs | `az containerapp logs show -n mom-frontend -g <rg> --follow` |
| Restart backend | `az containerapp revision restart -n mom-backend -g <rg> --revision <name>` (list with `az containerapp revision list`) |
| Query the database | Run `provision.ps1 -AllowMyIp`, then connect pgAdmin to `<pg-server>.postgres.database.azure.com` (SSL: require). The user and password are in `infra/.azure-state.env` |
| Save money when idle | `az postgres flexible-server stop -n <pg-server> -g <rg>` (it auto-starts after 7 days) |

## Design notes
- **The backend runs exactly 1 replica.** Processing runs as a background task inside the API process, so scale-to-zero or a second replica could cut a meeting's processing short.
- **The backend has internal ingress only.** The browser reaches it through nginx at `/api`, so there is no CORS and only one public URL. The OAuth callback also goes through `/api` (`PUBLIC_BASE_URL=https://<frontend>/api`).
- **nginx** resolves the backend at request time using the container's DNS server (`NGINX_ENTRYPOINT_LOCAL_RESOLVERS`). It sends the backend's own Host header, because Container Apps routes internal traffic by host.
- **Cost** at low use is roughly: Postgres B1ms about $15/month, two always-on small container apps about $15–30/month, the registry about $5/month, plus Azure OpenAI per minute of audio and per token.
