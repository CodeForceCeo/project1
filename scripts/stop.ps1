$ErrorActionPreference='Stop'
$root = Split-Path $PSScriptRoot -Parent
$config = Get-Content (Join-Path $root 'config.local.json') -Raw | ConvertFrom-Json
Invoke-RestMethod "http://127.0.0.1:$($config.port)/api/shutdown" -Method Post -Headers @{Authorization="Bearer $($config.panelToken)"} | Out-Null
Write-Host 'Pocket Codex stopped. A tunnel started by connect.ps1 will also stop.'
