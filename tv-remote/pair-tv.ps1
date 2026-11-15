$ErrorActionPreference = 'Stop'
$remoteRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $remoteRoot
$adb = Join-Path $repoRoot 'tools\platform-tools\adb.exe'
$profile = Join-Path $repoRoot 'tools\adb-profile'
$adbHome = Join-Path $profile '.android'
if (-not (Test-Path -LiteralPath $adb)) { throw 'Android Platform Tools are missing.' }
New-Item -ItemType Directory -Path $adbHome -Force | Out-Null
$env:ANDROID_SDK_HOME = $profile
$env:ANDROID_USER_HOME = $adbHome

Write-Host 'TV and computer must be on the same Wi-Fi network.'
$pairAddress = Read-Host 'Pairing address from Pair device with pairing code (IP:port)'
$secureCode = Read-Host 'Temporary six-digit pairing code' -AsSecureString
$handle = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureCode)
try {
    $pairCode = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($handle)
    & $adb pair $pairAddress $pairCode
    if ($LASTEXITCODE -ne 0) { throw 'Pairing failed. Reopen the pairing-code screen on the TV and try with a fresh code.' }
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($handle)
    $pairCode = $null
}

$connectAddress = Read-Host 'Connection address from the main Wireless debugging screen (IP:port)'
& $adb connect $connectAddress
if ($LASTEXITCODE -ne 0) { throw 'Pairing worked, but ADB could not connect. Check the main Wireless debugging connection address.' }
$devices = & $adb devices
if (-not ($devices | Select-String -SimpleMatch "$connectAddress`tdevice")) {
    throw 'The TV did not appear as connected in ADB. Recheck its connection port and Wi-Fi.'
}
Set-Content -LiteralPath (Join-Path $profile 'tv-endpoint') -Value $connectAddress -NoNewline -Encoding ascii
Write-Host 'Paired and connected. The key and TV address are kept in the ignored tools\adb-profile folder.'
