<#
.SYNOPSIS
  Redeploys the current code to Azure: builds both images in ACR and rolls them out.

.DESCRIPTION
  Run after provision.ps1 has set everything up (it reads infra/.azure-state.env).
  Builds happen in Azure (az acr build), so Docker Desktop is not needed.
  Settings and secrets are not touched; to change those, edit infra/azure.env and re-run provision.ps1.

.EXAMPLE
  .\infra\deploy.ps1                 # backend + frontend
  .\infra\deploy.ps1 -Only frontend
#>
param([ValidateSet('all', 'backend', 'frontend')] [string]$Only = 'all')

. "$PSScriptRoot\common.ps1"
$s = Get-State
$rg = $s.RESOURCE_GROUP
$acrServer = Invoke-Az acr show -n $s.ACR_NAME --query loginServer -o tsv
$tag = Get-GitTag

$dirty = & git -C $RepoRoot status --porcelain
if ($dirty) { Write-Warning "Uncommitted changes will be deployed too (image tag $tag)." }

if ($Only -in 'all', 'backend') {
  Write-Host "Building mom-backend:$tag ..."
  Invoke-Az acr build -r $s.ACR_NAME -t "mom-backend:$tag" (Join-Path $RepoRoot 'backend') -o none
  Invoke-Az containerapp update -n $s.BACKEND_APP -g $rg --image "$acrServer/mom-backend:$tag" -o none
}
if ($Only -in 'all', 'frontend') {
  Write-Host "Building mom-frontend:$tag ..."
  Invoke-Az acr build -r $s.ACR_NAME -t "mom-frontend:$tag" (Join-Path $RepoRoot 'frontend') -o none
  Invoke-Az containerapp update -n $s.FRONTEND_APP -g $rg --image "$acrServer/mom-frontend:$tag" -o none
}

Wait-Healthy "$($s.FRONTEND_URL)/api/health"
Write-Host "Deployed $tag -> $($s.FRONTEND_URL)"
