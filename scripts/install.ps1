# Quiro installer for Windows.
#   irm https://raw.githubusercontent.com/Nweremizu/quiro/main/scripts/install.ps1 | iex
$ErrorActionPreference = 'Stop'

$repo = 'Nweremizu/quiro'
$url  = "https://github.com/$repo/releases/latest/download/Quiro-windows-x64.exe"
$out  = Join-Path $env:TEMP 'Quiro-Setup.exe'

Write-Host 'Downloading Quiro...'
Invoke-WebRequest -Uri $url -OutFile $out

Write-Host 'Launching installer...'
Start-Process -FilePath $out -Wait

$exe = Join-Path $env:LOCALAPPDATA 'Programs\Quiro\Quiro.exe'
if (Test-Path $exe) {
  Write-Host 'Opening Quiro...'
  Start-Process -FilePath $exe
} else {
  Write-Host 'Installed. Launch Quiro from the Start menu.'
}
