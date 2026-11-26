<#
.SYNOPSIS
  Turn on real email for the MinutesAI VM (Gmail SMTP with an app password).

.DESCRIPTION
  Prompts for the Gmail address and its 16-character app password (hidden input), writes them to
  /opt/mom/.env on the VM over SSH (values go through stdin, never on a command line or screen),
  restarts the backend and checks that Gmail accepts the login.

  Gmail app password: Google Account -> Security -> 2-Step Verification on ->
  https://myaccount.google.com/apppasswords -> create one (e.g. "MinutesAI").

.EXAMPLE
  .\deploy\vm\set-email.ps1
  .\deploy\vm\set-email.ps1 -VmHost mom-f5mqx.southindia.cloudapp.azure.com -KeyFile ~\.ssh\mom_vm
#>
param(
    [string]$VmHost = "mom-f5mqx.southindia.cloudapp.azure.com",
    [string]$VmUser = "azureuser",
    [string]$KeyFile = "$env:USERPROFILE\.ssh\mom_vm",
    [string]$SmtpHost = "smtp.gmail.com",
    [int]$SmtpPort = 587,
    # For testing the script: write to another file and skip the restart and login check.
    [string]$EnvFile = "/opt/mom/.env",
    [switch]$SkipRestart
)
$ErrorActionPreference = "Stop"

$address = (Read-Host "Gmail address to send MOMs from").Trim()
if ($address -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { throw "That doesn't look like an email address." }
$secure = Read-Host "App password (16 letters; input is hidden)" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $password = ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)) -replace '\s', '' }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
if ($password.Length -lt 8) { throw "The app password looks too short." }

# Runs on the VM. Reads address and password from stdin; nothing secret is in this text.
$remote = @'
set -euo pipefail
IFS= read -r ADDR; IFS= read -r PASS
clean() { printf '%s' "$1" | sed 's/^\xEF\xBB\xBF//' | tr -d '\r'; }   # drop BOM / CR added by Windows
ADDR=$(clean "$ADDR"); PASS=$(clean "$PASS")
ENV_FILE="__ENVFILE__"
cp -p "$ENV_FILE" "$ENV_FILE.bak"
{ grep -vE '^(EMAIL_BACKEND|EMAIL_FROM|SMTP_HOST|SMTP_PORT|SMTP_USERNAME|SMTP_PASSWORD|SMTP_USE_TLS)=' "$ENV_FILE.bak" || true
  printf 'EMAIL_BACKEND=smtp\nEMAIL_FROM=%s\nSMTP_HOST=%s\nSMTP_PORT=%s\nSMTP_USERNAME=%s\nSMTP_PASSWORD=%s\nSMTP_USE_TLS=true\n' \
    "$ADDR" "__HOST__" "__PORT__" "$ADDR" "$PASS"
} > "$ENV_FILE.new"
install -m 600 "$ENV_FILE.new" "$ENV_FILE" && rm -f "$ENV_FILE.new"
echo "Saved email settings to $ENV_FILE (previous version: $ENV_FILE.bak)"
[ "__SKIP__" = "1" ] && exit 0
cd /opt/mom/app/deploy/vm
docker compose up -d backend >/dev/null 2>&1
for i in $(seq 1 30); do [ "$(docker compose ps backend --format '{{.Health}}')" = healthy ] && break; sleep 3; done
docker compose exec -T backend python - <<'PY'
import smtplib
from app.config import get_settings
s = get_settings()
try:
    cls = smtplib.SMTP_SSL if s.smtp_port == 465 else smtplib.SMTP
    with cls(s.smtp_host, s.smtp_port, timeout=20) as c:
        if s.smtp_port != 465:
            c.starttls()
        c.login(s.smtp_username, s.smtp_password)
    print(f"OK: {s.smtp_host} accepted the login for {s.smtp_username}. Emails will now be sent.")
except smtplib.SMTPAuthenticationError:
    print("FAILED: the mail server rejected the login. Use a Gmail APP password (not your normal one) "
          "and make sure 2-Step Verification is on. Run this script again with the right password.")
except Exception as e:
    print(f"FAILED: could not reach {s.smtp_host}:{s.smtp_port}: {type(e).__name__}: {e}")
PY
'@
$skip = if ($SkipRestart) { "1" } else { "0" }
$remote = $remote.Replace("__HOST__", $SmtpHost).Replace("__PORT__", "$SmtpPort").Replace("__ENVFILE__", $EnvFile).Replace("__SKIP__", $skip).Replace("`r", "")
# Ship the script as base64 so no quoting survives (or breaks) the Windows -> ssh command line.
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remote))
$cmd = "echo $b64 | base64 -d > /tmp/mom-set-email.sh && bash /tmp/mom-set-email.sh; rc=`$?; rm -f /tmp/mom-set-email.sh; exit `$rc"

Write-Host "Updating $EnvFile on $VmHost$(if (-not $SkipRestart) { ' and restarting the backend' })..."
$OutputEncoding = New-Object Text.UTF8Encoding $false   # no BOM on what we pipe to ssh
"$address`n$password`n" | ssh -i $KeyFile -o BatchMode=yes "$VmUser@$VmHost" $cmd
$password = $null
if ($LASTEXITCODE -ne 0) { throw "Remote update failed (exit $LASTEXITCODE)." }
