$ErrorActionPreference = 'Stop'
$remoteRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $remoteRoot
$profile = Join-Path $repoRoot 'tools\adb-profile'
$env:ANDROID_SDK_HOME = $profile
$env:ANDROID_USER_HOME = Join-Path $profile '.android'
New-Item -ItemType Directory -Path $env:ANDROID_USER_HOME -Force | Out-Null

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    Write-Error 'Python 3 is required to run the local TV remote bridge.'
    exit 1
}

Write-Host 'Starting the local TV remote bridge…'
Write-Host 'Open http://127.0.0.1:8765 in your browser.'
Write-Host 'Leave this window open while using the remote. Press Ctrl+C to stop it.'
& $python.Source (Join-Path $remoteRoot 'bridge.py')
