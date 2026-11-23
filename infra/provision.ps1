<#
.SYNOPSIS
  One-time setup of the whole system in ONE existing Azure resource group.

.DESCRIPTION
  Creates, inside -ResourceGroup (never creates resource groups):
    - Azure Container Registry (Basic) + builds both Docker images in Azure (no local Docker needed)
    - Azure Database for PostgreSQL Flexible Server (Burstable B1ms) + database mom_db
    - Storage account + Azure Files share "momdata" (audio chunks, email outbox)
    - Container Apps environment (with a Log Analytics workspace)
    - Container App "mom-frontend" (nginx, public HTTPS) and "mom-backend" (FastAPI, internal only)

  Prerequisites:
    - az login (az account set --subscription <id> if you have several)
    - Azure OpenAI models deployed in Foundry, and infra/azure.env filled in (copy azure.env.example)

  Safe to re-run: existing resources are reused, and the backend's settings and secrets are re-applied.
  Names and generated secrets are kept in infra/.azure-state.env (gitignored).

.EXAMPLE
  .\infra\provision.ps1 -ResourceGroup rg-student-123
  .\infra\provision.ps1 -ResourceGroup rg-student-123 -Location eastus2 -AllowMyIp
#>
param(
  [Parameter(Mandatory)] [string]$ResourceGroup,
  [string]$Location,                       # default: the resource group's location
  [string]$Prefix = 'mom',
  [string]$AzureEnvFile = (Join-Path $PSScriptRoot 'azure.env'),
  [switch]$AllowMyIp                       # also open Postgres to this PC's public IP (pgAdmin)
)

. "$PSScriptRoot\common.ps1"

# ---- 0. Checks -------------------------------------------------------------------------------
Invoke-Az account show --query "{subscription:name, user:user.name}" -o table | Out-Host
if (-not (Test-Az group show -n $ResourceGroup)) { throw "Resource group '$ResourceGroup' not found or no access." }
if (-not $Location) { $Location = Invoke-Az group show -n $ResourceGroup --query location -o tsv }

$cfg = Read-EnvFile $AzureEnvFile
if (-not $cfg['OPENAI_API_KEY'] -or $cfg['OPENAI_BASE_URL'] -notmatch '^https://' -or -not $cfg['OPENAI_API_VERSION']) {
  throw "Fill in OPENAI_API_KEY, OPENAI_BASE_URL and OPENAI_API_VERSION in $AzureEnvFile (copy azure.env.example)."
}

# Resource providers are registered per subscription; registering needs subscription-level rights.
foreach ($ns in 'Microsoft.App', 'Microsoft.OperationalInsights', 'Microsoft.DBforPostgreSQL',
                'Microsoft.Storage', 'Microsoft.ContainerRegistry') {
  $state = Test-Az provider show -n $ns --query registrationState -o tsv
  if ($state -ne 'Registered') {
    Write-Host "Registering provider $ns ..."
    & az provider register -n $ns --wait 2>$null
    if ($LASTEXITCODE -ne 0) { throw "Provider $ns is not registered and you lack rights to register it. Ask the subscription admin to run: az provider register -n $ns" }
  }
}
& az extension add --name containerapp --upgrade --only-show-errors 2>$null

# ---- Names and generated secrets (kept across runs) ---------------------------------------------
$s = Read-EnvFile $StatePath
if (-not $s['SUFFIX']) { $s['SUFFIX'] = New-RandomString 5 }
$sfx = $s['SUFFIX']
$defaults = @{
  RESOURCE_GROUP = $ResourceGroup
  LOCATION       = $Location
  ACR_NAME       = "${Prefix}acr$sfx"
  PG_SERVER      = "$Prefix-pg-$sfx"
  PG_ADMIN       = 'momadmin'
  PG_PASSWORD    = 'Pg' + (New-RandomString 24 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789') + '9'
  STORAGE_NAME   = "${Prefix}st$sfx"
  ENV_NAME       = "$Prefix-env"
  BACKEND_APP    = "$Prefix-backend"
  FRONTEND_APP   = "$Prefix-frontend"
  SECRET_KEY     = New-RandomString 64 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
}
foreach ($k in $defaults.Keys) { if (-not $s[$k]) { $s[$k] = $defaults[$k] } }
Write-EnvFile $StatePath $s
$rg = $ResourceGroup

# ---- 1. Container registry + images ---------------------------------------------------------------
if (-not (Test-Az acr show -n $s.ACR_NAME -g $rg)) {
  Write-Host "Creating container registry $($s.ACR_NAME) ..."
  Invoke-Az acr create -n $s.ACR_NAME -g $rg -l $Location --sku Basic --admin-enabled true -o none
}
Invoke-Az acr update -n $s.ACR_NAME --admin-enabled true -o none
$acrServer = Invoke-Az acr show -n $s.ACR_NAME --query loginServer -o tsv
$acrPassword = Invoke-Az acr credential show -n $s.ACR_NAME --query "passwords[0].value" -o tsv

$tag = Get-GitTag
Write-Host "Building images in Azure (tag $tag) ..."
Invoke-Az acr build -r $s.ACR_NAME -t "mom-backend:$tag" (Join-Path $RepoRoot 'backend') -o none
Invoke-Az acr build -r $s.ACR_NAME -t "mom-frontend:$tag" (Join-Path $RepoRoot 'frontend') -o none

# ---- 2. PostgreSQL ------------------------------------------------------------------------------
if (-not (Test-Az postgres flexible-server show -n $s.PG_SERVER -g $rg)) {
  Write-Host "Creating PostgreSQL server $($s.PG_SERVER) (takes 5-10 min) ..."
  # --public-access 0.0.0.0 = only Azure services (the Container Apps) may connect
  Invoke-Az postgres flexible-server create -n $s.PG_SERVER -g $rg -l $Location `
    --tier Burstable --sku-name Standard_B1ms --version 16 --storage-size 32 `
    --admin-user $s.PG_ADMIN --admin-password $s.PG_PASSWORD --public-access 0.0.0.0 --yes -o none
}
if (-not (Test-Az postgres flexible-server db show -g $rg -s $s.PG_SERVER -d mom_db)) {
  Invoke-Az postgres flexible-server db create -g $rg -s $s.PG_SERVER -d mom_db -o none
}
if ($AllowMyIp) {
  $ip = (Invoke-RestMethod https://api.ipify.org).Trim()
  Invoke-Az postgres flexible-server firewall-rule create -g $rg -n $s.PG_SERVER --rule-name my-pc `
    --start-ip-address $ip --end-ip-address $ip -o none
  Write-Host "Postgres open to $ip (pgAdmin: host $($s.PG_SERVER).postgres.database.azure.com, user $($s.PG_ADMIN), SSL require)"
}
$databaseUrl = "postgresql+psycopg://$($s.PG_ADMIN):$($s.PG_PASSWORD)@$($s.PG_SERVER).postgres.database.azure.com:5432/mom_db?sslmode=require"

# ---- 3. Azure Files -----------------------------------------------------------------------------
if (-not (Test-Az storage account show -n $s.STORAGE_NAME -g $rg)) {
  Write-Host "Creating storage account $($s.STORAGE_NAME) ..."
  Invoke-Az storage account create -n $s.STORAGE_NAME -g $rg -l $Location --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 -o none
}
if (-not (Test-Az storage share-rm show --storage-account $s.STORAGE_NAME -g $rg -n momdata)) {
  Invoke-Az storage share-rm create --storage-account $s.STORAGE_NAME -g $rg -n momdata --quota 20 -o none
}
$storageKey = Invoke-Az storage account keys list -n $s.STORAGE_NAME -g $rg --query "[0].value" -o tsv

# ---- 4. Container Apps environment ------------------------------------------------------------
if (-not (Test-Az containerapp env show -n $s.ENV_NAME -g $rg)) {
  Write-Host "Creating Container Apps environment $($s.ENV_NAME) ..."
  Invoke-Az containerapp env create -n $s.ENV_NAME -g $rg -l $Location -o none
}
Invoke-Az containerapp env storage set -n $s.ENV_NAME -g $rg --storage-name momdata `
  --azure-file-account-name $s.STORAGE_NAME --azure-file-account-key $storageKey `
  --azure-file-share-name momdata --access-mode ReadWrite -o none
$envId = Invoke-Az containerapp env show -n $s.ENV_NAME -g $rg --query id -o tsv
$envDomain = Invoke-Az containerapp env show -n $s.ENV_NAME -g $rg --query properties.defaultDomain -o tsv
# nginx's resolver does not use DNS search domains, so the frontend needs the backend's full internal name.
$backendInternalUrl = "http://$($s.BACKEND_APP).internal.$envDomain"

# ---- 5. Frontend (public) -------------------------------------------------------------------------
if (-not (Test-Az containerapp show -n $s.FRONTEND_APP -g $rg)) {
  Write-Host "Creating $($s.FRONTEND_APP) ..."
  Invoke-Az containerapp create -n $s.FRONTEND_APP -g $rg --environment $s.ENV_NAME `
    --image "$acrServer/mom-frontend:$tag" --registry-server $acrServer `
    --registry-username $s.ACR_NAME --registry-password $acrPassword `
    --ingress external --target-port 80 --min-replicas 1 --max-replicas 2 `
    --cpu 0.25 --memory 0.5Gi --env-vars "BACKEND_URL=$backendInternalUrl" -o none
} else {
  Invoke-Az containerapp update -n $s.FRONTEND_APP -g $rg --image "$acrServer/mom-frontend:$tag" `
    --set-env-vars "BACKEND_URL=$backendInternalUrl" -o none
}
$frontendFqdn = Invoke-Az containerapp show -n $s.FRONTEND_APP -g $rg --query properties.configuration.ingress.fqdn -o tsv
$publicUrl = "https://$frontendFqdn"
$s['FRONTEND_URL'] = $publicUrl
Write-EnvFile $StatePath $s

# ---- 6. Backend (internal only) -------------------------------------------------------------------
$secrets = [ordered]@{
  'acr-password'   = $acrPassword
  'database-url'   = $databaseUrl
  'secret-key'     = $s.SECRET_KEY
  'openai-api-key' = $cfg['OPENAI_API_KEY']
}
$envVars = [System.Collections.ArrayList]@(
  @{ name = 'DATABASE_URL';    secretRef = 'database-url' },
  @{ name = 'SECRET_KEY';      secretRef = 'secret-key' },
  @{ name = 'OPENAI_API_KEY';  secretRef = 'openai-api-key' },
  @{ name = 'PUBLIC_BASE_URL'; value = "$publicUrl/api" },   # OAuth callback goes through nginx
  @{ name = 'CORS_ORIGINS';    value = "[`"$publicUrl`"]" },
  @{ name = 'AUDIO_DIR';       value = '/data/audio' },
  @{ name = 'EMAIL_OUTBOX_DIR'; value = '/data/outbox' }
)
foreach ($k in 'OPENAI_BASE_URL', 'OPENAI_API_VERSION', 'OPENAI_TRANSCRIBE_MODEL', 'OPENAI_LLM_MODEL', 'TRANSCRIBE_CONCURRENCY',
               'EMAIL_BACKEND', 'EMAIL_FROM', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USERNAME', 'SMTP_USE_TLS',
               'MS_CLIENT_ID', 'MS_TENANT', 'MAX_CHUNK_MB', 'RETAIN_AUDIO') {
  if ($cfg[$k]) { [void]$envVars.Add(@{ name = $k; value = $cfg[$k] }) }
}
foreach ($pair in @(@('SMTP_PASSWORD', 'smtp-password'), @('MS_CLIENT_SECRET', 'ms-client-secret'))) {
  if ($cfg[$pair[0]]) { $secrets[$pair[1]] = $cfg[$pair[0]]; [void]$envVars.Add(@{ name = $pair[0]; secretRef = $pair[1] }) }
}

$spec = @{
  location   = $Location
  properties = @{
    managedEnvironmentId = $envId
    configuration = @{
      activeRevisionsMode = 'Single'
      # Internal = reachable only from inside the environment (the nginx frontend).
      ingress    = @{ external = $false; targetPort = 8000; transport = 'auto'; allowInsecure = $true }
      registries = @(@{ server = $acrServer; username = $s.ACR_NAME; passwordSecretRef = 'acr-password' })
      secrets    = @($secrets.Keys | ForEach-Object { @{ name = $_; value = $secrets[$_] } })
    }
    template = @{
      containers = @(@{
        name         = 'backend'
        image        = "$acrServer/mom-backend:$tag"
        resources    = @{ cpu = 1.0; memory = '2Gi' }
        env          = @($envVars)
        volumeMounts = @(@{ volumeName = 'data'; mountPath = '/data' })
      })
      # Exactly one replica: processing runs as a background task inside the process,
      # so scaling to zero (or killing a replica) mid-meeting would lose work.
      scale   = @{ minReplicas = 1; maxReplicas = 1 }
      volumes = @(@{ name = 'data'; storageType = 'AzureFile'; storageName = 'momdata' })
    }
  }
}
# JSON is valid YAML; the file holds secrets, so it lives in TEMP and is deleted right after.
$specFile = Join-Path $env:TEMP "mom-backend-$([guid]::NewGuid()).yaml"
[System.IO.File]::WriteAllText($specFile, ($spec | ConvertTo-Json -Depth 20))   # UTF-8 without BOM
try {
  if (-not (Test-Az containerapp show -n $s.BACKEND_APP -g $rg)) {
    Write-Host "Creating $($s.BACKEND_APP) ..."
    Invoke-Az containerapp create -n $s.BACKEND_APP -g $rg --yaml $specFile -o none
  } else {
    Write-Host "Updating $($s.BACKEND_APP) settings ..."
    Invoke-Az containerapp update -n $s.BACKEND_APP -g $rg --yaml $specFile -o none
  }
} finally { Remove-Item $specFile -Force -ErrorAction SilentlyContinue }

# ---- Done -------------------------------------------------------------------------------------------
Wait-Healthy "$publicUrl/api/health"
Write-Host ""
Write-Host "App:                $publicUrl"
Write-Host "Outlook redirect:   $publicUrl/api/calendar/microsoft/callback  (Entra app registration > Authentication > Web)"
Write-Host "Redeploy code:      .\infra\deploy.ps1"
