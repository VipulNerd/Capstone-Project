# Shared helpers for provision.ps1 and deploy.ps1. Dot-source it: . "$PSScriptRoot\common.ps1"

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$StatePath = Join-Path $PSScriptRoot '.azure-state.env'   # gitignored: names + generated secrets

# Runs az and fails the script on a non-zero exit code (az does not throw on its own).
function Invoke-Az {
  $out = & az @args
  if ($LASTEXITCODE -ne 0) { throw "az $($args -join ' ') failed (exit $LASTEXITCODE)" }
  return $out
}

# Like Invoke-Az but returns $null instead of failing (for "does this exist?" checks).
function Test-Az {
  $out = & az @args 2>$null
  if ($LASTEXITCODE -ne 0) { return $null }
  return $out
}

# KEY=VALUE file -> hashtable. Ignores comments and blank lines; strips surrounding quotes.
function Read-EnvFile([string]$Path) {
  $map = @{}
  if (-not (Test-Path $Path)) { return $map }
  foreach ($line in Get-Content $Path) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $key, $value = $line -split '=', 2
    $map[$key.Trim()] = $value.Trim().Trim('"')
  }
  return $map
}

function Write-EnvFile([string]$Path, [hashtable]$Map) {
  $lines = $Map.Keys | Sort-Object | ForEach-Object { "$_=$($Map[$_])" }
  Set-Content -Path $Path -Value $lines -Encoding ascii
}

function New-RandomString([int]$Length, [string]$Chars = 'abcdefghijkmnopqrstuvwxyz23456789') {
  -join (1..$Length | ForEach-Object { $Chars[(Get-Random -Maximum $Chars.Length)] })
}

function Get-State {
  $s = Read-EnvFile $StatePath
  if (-not $s.ContainsKey('RESOURCE_GROUP')) { throw "No $StatePath yet. Run infra\provision.ps1 first." }
  return $s
}

function Get-GitTag {
  $sha = (& git -C $RepoRoot rev-parse --short HEAD 2>$null)
  $stamp = Get-Date -Format 'yyyyMMddHHmmss'
  if ($sha) { return "$sha-$stamp" } else { return $stamp }
}

function Wait-Healthy([string]$Url, [int]$TimeoutSeconds = 300) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-RestMethod -Uri $Url -TimeoutSec 15
      if ($r.status -eq 'ok') { Write-Host "Healthy: $Url -> $($r | ConvertTo-Json -Compress)"; return }
      Write-Host "Not ready yet: $($r | ConvertTo-Json -Compress)"
    } catch { Write-Host "Waiting for $Url ($($_.Exception.Message))" }
    Start-Sleep -Seconds 10
  }
  throw "$Url did not report status=ok within $TimeoutSeconds s. Check: az containerapp logs show -n <app> -g <rg> --follow"
}
