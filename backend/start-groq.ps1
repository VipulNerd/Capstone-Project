# Starts the backend using Groq's OpenAI-compatible API instead of OpenAI.
# Needs OPENAI_API_KEY (a Groq "gsk_" key) and Groq model names in .env.
# OPENAI_BASE_URL has to be a real environment variable: the OpenAI SDK reads it
# from the process environment, not from .env.
Set-Location $PSScriptRoot
$env:OPENAI_BASE_URL = "https://api.groq.com/openai/v1"
& .\.venv\Scripts\python.exe -m alembic upgrade head
& .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
