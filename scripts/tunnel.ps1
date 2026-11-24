# Share the CRM running on this PC through a free Cloudflare quick tunnel (https://<random>.trycloudflare.com).
#
#   powershell -ExecutionPolicy Bypass -File scripts/tunnel.ps1
#
# What it runs (all on this PC, against your local database and files):
#   - the PRODUCTION build of the web app (vite preview, port 4173) — no dev server or source code is exposed
#   - the API in production mode on port 3000, with the demo stand-ins (ALLOW_SIMULATED_PROVIDERS=true) and the
#     background jobs inside the API (RUN_JOBS_IN_PROCESS=true)
#   - cloudflared, which gives port 4173 a public https address
# The address changes every time you start this script, and works only while this PC and the script are running.
# Stop the dev servers first (ports 3000 and 4173 must be free). Press Ctrl+C to stop everything.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$logs = Join-Path $root '.data\tunnel'
New-Item -ItemType Directory -Force $logs | Out-Null

$cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cloudflared) {
  # winget's default install location (terminals opened before the install do not see the new PATH yet)
  $cloudflared = @("${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe", "$env:ProgramFiles\cloudflared\cloudflared.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $cloudflared) {
  throw 'cloudflared is not installed. Install it with: winget install --id Cloudflare.cloudflared'
}
foreach ($port in 3000, 4173) {
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $port is in use. Stop the dev servers first."
  }
}

$procs = @()
function Start-Logged([string]$name, [string]$command, [string]$dir) {
  $p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $command -WorkingDirectory $dir -NoNewWindow -PassThru `
    -RedirectStandardOutput (Join-Path $logs "$name.log") -RedirectStandardError (Join-Path $logs "$name.err.log")
  $script:procs += $p
  return $p
}

try {
  Write-Host 'Building the web app...'
  Push-Location $root
  & cmd.exe /c 'pnpm --filter @crm/web build' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Web build failed' }
  Pop-Location

  Write-Host 'Opening the tunnel...'
  $tunnelLog = Join-Path $logs 'cloudflared.err.log'
  if (Test-Path $tunnelLog) { Remove-Item $tunnelLog }
  Start-Logged 'cloudflared' "`"$cloudflared`" tunnel --no-autoupdate --url http://localhost:4173" $root | Out-Null
  $url = $null
  for ($i = 0; $i -lt 60 -and -not $url; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path $tunnelLog) {
      $m = Select-String -Path $tunnelLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
      if ($m) { $url = $m.Matches[0].Value }
    }
  }
  if (-not $url) { throw "No tunnel address after 60 s. See $tunnelLog" }

  # The app only accepts sign-in and changes from its own public address, so both origins are the tunnel URL.
  $env:NODE_ENV = 'production'
  $env:APP_ORIGIN = $url
  $env:BUYER_ORIGIN = $url
  $env:ALLOW_SIMULATED_PROVIDERS = 'true'
  $env:RUN_JOBS_IN_PROCESS = 'true'
  $env:PORT = '3000'

  Write-Host 'Starting the API and the web app...'
  Start-Logged 'api' 'pnpm --filter @crm/server serve' $root | Out-Null
  Start-Logged 'web' 'pnpm --filter @crm/web exec vite preview' $root | Out-Null

  $ready = $false
  for ($i = 0; $i -lt 60 -and -not $ready; $i++) {
    Start-Sleep -Seconds 1
    try { $ready = (Invoke-WebRequest -UseBasicParsing "$url/api/v1/me" -TimeoutSec 5 -ErrorAction Stop).StatusCode -gt 0 }
    catch { $ready = $null -ne $_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401 }
  }

  Write-Host ''
  Write-Host "  Your CRM is live at:  $url" -ForegroundColor Green
  Write-Host '  Staff sign in there; proposal links sent from the app use the same address.'
  Write-Host "  Logs: $logs"
  Write-Host '  Press Ctrl+C to stop.'
  while ($true) {
    Start-Sleep -Seconds 5
    foreach ($p in $procs) { if ($p.HasExited) { throw "A process stopped (exit $($p.ExitCode)). See $logs" } }
  }
}
finally {
  foreach ($p in $procs) { if (-not $p.HasExited) { & taskkill.exe /T /F /PID $p.Id 2>$null | Out-Null } }
  Write-Host 'Stopped the tunnel, API and web app.'
}
