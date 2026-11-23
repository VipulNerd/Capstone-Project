# Starts the backend against Azure OpenAI (Azure AI Foundry).
#
# In backend/.env set:
#   OPENAI_API_KEY=<Azure OpenAI key>
#   OPENAI_BASE_URL=https://<resource>.openai.azure.com/
#   OPENAI_API_VERSION=2025-04-01-preview     # calls models by deployment (AzureOpenAI client)
#   OPENAI_TRANSCRIBE_MODEL=<deployment name of gpt-4o-transcribe-diarize>
#   OPENAI_LLM_MODEL=<deployment name of gpt-5.1>
Set-Location $PSScriptRoot

$cfg = Get-Content .env | Where-Object { $_ -match '^\s*OPENAI_(BASE_URL|API_VERSION)\s*=\s*\S' }
if (@($cfg).Count -lt 2) { throw "Set OPENAI_BASE_URL and OPENAI_API_VERSION in backend/.env (see the comments at the top of this script)." }

& .\.venv\Scripts\python.exe -m alembic upgrade head
& .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
