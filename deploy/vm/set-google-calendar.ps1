<#
.SYNOPSIS
  Turn on "Connect Google Calendar" on the MinutesAI VM.

.DESCRIPTION
  Prompts for the Google OAuth client ID and client secret (secret input is hidden), writes them
  to /opt/mom/.env on the VM over SSH (values go through stdin, never on a command line or screen),
  restarts the backend and checks that /api/calendar/providers reports Google as configured.

  Create the OAuth client first (see deploy/vm/README.md, "Google Calendar"):
  Google Cloud Console -> enable Google Calendar API -> OAuth consent screen (External, Testing,
  add test users) -> Credentials -> OAuth client ID (Web application) with redirect URI
  https://<VmHost>/api/calendar/google/callback

.EXAMPLE
  .\deploy\vm\set-google-calendar.ps1
#>
param(
    [string]$VmHost = "mom-f5mqx.southindia.cloudapp.azure.com",
    [string]$VmUser = "azureuser",
    [string]$KeyFile = "$env:USERPROFILE\.ssh\mom_vm",
    # For testing the script: write to another file and skip the restart and check.
    [string]$EnvFile = "/opt/mom/.env",
    [switch]$SkipRestart
)
$ErrorActionPreference = "Stop"

Write-Host "Redirect URI to register in Google Cloud: https://$VmHost/api/calendar/google/callback"
$clientId = (Read-Host "Google OAuth client ID (ends with .apps.googleusercontent.com)").Trim()
if ($clientId -notmatch '^[\w\-\.]+\.apps\.googleusercontent\.com$') { throw "That doesn't look like a Google OAuth client ID." }
$secure = Read-Host "Client secret (input is hidden)" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $secret = ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)).Trim() }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
if ($secret.Length -lt 10) { throw "The client secret looks too short." }

# Runs on the VM. Reads the ID and secret from stdin; nothing secret is in this text.
$remote = @'
set -euo pipefail
IFS= read -r CID; IFS= read -r SECRET
clean() { printf '%s' "$1" | sed 's/^\xEF\xBB\xBF//' | tr -d '\r'; }   # drop BOM / CR added by Windows
CID=$(clean "$CID"); SECRET=$(clean "$SECRET")
ENV_FILE="__ENVFILE__"
cp -p "$ENV_FILE" "$ENV_FILE.bak"
{ grep -vE '^(GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET)=' "$ENV_FILE.bak" || true
  printf 'GOOGLE_CLIENT_ID=%s\nGOOGLE_CLIENT_SECRET=%s\n' "$CID" "$SECRET"
} > "$ENV_FILE.new"
install -m 600 "$ENV_FILE.new" "$ENV_FILE" && rm -f "$ENV_FILE.new"
echo "Saved Google Calendar settings to $ENV_FILE (previous version: $ENV_FILE.bak)"
[ "__SKIP__" = "1" ] && exit 0
cd /opt/mom/app/deploy/vm
docker compose up -d backend >/dev/null 2>&1
for i in $(seq 1 30); do [ "$(docker compose ps backend --format '{{.Health}}')" = healthy ] && break; sleep 3; done
docker compose exec -T backend python -c "import json,urllib.request; p=json.load(urllib.request.urlopen('http://localhost:8000/calendar/providers')); g=[x for x in p if x['provider']=='google'][0]; print('OK: Google Calendar is enabled. Users can now click Connect Google Calendar.' if g['configured'] else 'FAILED: Google is still not configured; check GOOGLE_CLIENT_ID in /opt/mom/.env')" </dev/null
'@
$skip = if ($SkipRestart) { "1" } else { "0" }
$remote = $remote.Replace("__ENVFILE__", $EnvFile).Replace("__SKIP__", $skip).Replace("__HOST__", $VmHost).Replace("`r", "")
# Ship the script as base64 so no quoting survives (or breaks) the Windows -> ssh command line.
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remote))
$cmd = "echo $b64 | base64 -d > /tmp/mom-set-google.sh && bash /tmp/mom-set-google.sh; rc=`$?; rm -f /tmp/mom-set-google.sh; exit `$rc"

Write-Host "Updating $EnvFile on $VmHost$(if (-not $SkipRestart) { ' and restarting the backend' })..."
$OutputEncoding = New-Object Text.UTF8Encoding $false   # no BOM on what we pipe to ssh
"$clientId`n$secret`n" | ssh -i $KeyFile -o BatchMode=yes "$VmUser@$VmHost" $cmd
$secret = $null
if ($LASTEXITCODE -ne 0) { throw "Remote update failed (exit $LASTEXITCODE)." }
