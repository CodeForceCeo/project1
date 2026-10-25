param([switch]$Desktop)
$ErrorActionPreference='Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22 or newer first: https://nodejs.org/' }
if (-not (Test-Path config.local.json)) {
  if ($Desktop) { & node scripts/setup.mjs --desktop } else { & node scripts/setup.mjs }
  if ($LASTEXITCODE -ne 0) { throw 'Setup failed' }
}
& node src/main.mjs
