# Run this yourself to expose the authenticated bridge through a temporary HTTPS tunnel.
# A Quick Tunnel is a development convenience: its address changes on every launch.
param([string]$Cloudflared)
$ErrorActionPreference='Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
if (-not (Test-Path config.local.json)) { throw 'Run scripts/start.ps1 first, then stop it before running connect.ps1.' }
$config = Get-Content config.local.json -Raw | ConvertFrom-Json
try { $listener = Get-NetTCPConnection -LocalPort $config.port -State Listen -ErrorAction Stop } catch { $listener = $null }
if ($listener) { throw "Port $($config.port) is already in use. Stop the local Pocket Codex server before starting connect.ps1." }
New-Item -ItemType Directory -Force .local | Out-Null
if (-not $Cloudflared) {
  $existing = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($existing) { $Cloudflared = $existing.Source } else { $Cloudflared = Join-Path $root '.local/cloudflared.exe' }
}
if (-not (Test-Path -LiteralPath $Cloudflared)) { throw 'Install cloudflared from https://developers.cloudflare.com/tunnel/downloads/ or pass -Cloudflared C:\path\cloudflared.exe' }
$log = Join-Path $root '.local/tunnel.log'
[IO.File]::WriteAllText($log, '')
$tunnel = $null
try {
  $tunnel = Start-Process -FilePath $Cloudflared -ArgumentList @('tunnel','--url',"http://127.0.0.1:$($config.port)",'--no-autoupdate') -WindowStyle Hidden -RedirectStandardError $log -RedirectStandardOutput (Join-Path $root '.local/tunnel-out.log') -PassThru
  $address = $null
  for ($i=0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    if ($tunnel.HasExited) { throw "Tunnel exited. See $log" }
    $match = [regex]::Match((Get-Content $log -Raw), 'https://[a-z0-9-]+\.trycloudflare\.com')
    if ($match.Success) { $address = $match.Value; break }
  }
  if (-not $address) { throw "No HTTPS address received. See $log" }
  $config.publicUrl = $address
  [IO.File]::WriteAllText((Join-Path $root 'config.local.json'), ($config | ConvertTo-Json -Depth 8))
  Write-Host "Phone dashboard: $address"
  Write-Host "GPT Actions schema: $address/openapi.json"
  Write-Host 'Use panelToken for the dashboard and actionsToken for GPT Actions (from config.local.json).'
  Write-Host 'Keep this window open. Ctrl+C stops the bridge and tunnel.'
  & node src/main.mjs
} finally {
  if ($tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -ErrorAction SilentlyContinue }
}
