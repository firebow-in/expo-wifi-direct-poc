# Build release APK with short paths to avoid Windows MAX_PATH (260 chars).
# Run this script from a normal PowerShell/terminal (e.g. Windows Terminal),
# not from inside Cursor, so Gradle does not use the sandbox cache path.
$shortRoot = "D:\g"
if (-not (Test-Path $shortRoot)) { New-Item -ItemType Directory -Path $shortRoot -Force | Out-Null }
$env:GRADLE_USER_HOME = $shortRoot
$env:TEMP = "$shortRoot\tmp"
$env:TMP = "$shortRoot\tmp"
if (-not (Test-Path $env:TEMP)) { New-Item -ItemType Directory -Path $env:TEMP -Force | Out-Null }

Set-Location $PSScriptRoot
.\gradlew.bat --stop 2>$null
# --no-daemon avoids "file in use" locks when multiple builds run.
.\gradlew.bat assembleRelease -x lint -x test --no-daemon
Write-Host ""
if (Test-Path "app\build\outputs\apk\release\app-release.apk") {
    Write-Host "APK updated: app\build\outputs\apk\release\app-release.apk" -ForegroundColor Green
} else {
    Write-Host "APK not found; build may have failed." -ForegroundColor Yellow
}
