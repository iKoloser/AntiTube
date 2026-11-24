$ErrorActionPreference = "Stop"
$vendor = Join-Path $PSScriptRoot "vendor"
$archive = Join-Path $env:TEMP "antitube-ffmpeg-release.zip"
$extract = Join-Path $env:TEMP "antitube-ffmpeg-release"

New-Item -ItemType Directory -Force -Path $vendor | Out-Null
Invoke-WebRequest "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -OutFile (Join-Path $vendor "yt-dlp.exe")
Invoke-WebRequest "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile $archive
Expand-Archive -LiteralPath $archive -DestinationPath $extract -Force
$ffmpeg = Get-ChildItem $extract -Filter "ffmpeg.exe" -Recurse | Select-Object -First 1
Copy-Item $ffmpeg.FullName (Join-Path $vendor "ffmpeg.exe") -Force
Remove-Item $archive -Force
Remove-Item $extract -Recurse -Force
Write-Host "Herramientas preparadas en $vendor"
