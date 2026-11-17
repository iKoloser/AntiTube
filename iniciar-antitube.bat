@echo off
setlocal

title AntiTube - servidor local
cd /d "%~dp0"

where pnpm >nul 2>&1
if errorlevel 1 (
  echo No se ha encontrado pnpm en el PATH.
  echo Instala pnpm y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)

where yt-dlp >nul 2>&1
if errorlevel 1 (
  echo No se ha encontrado yt-dlp en el PATH.
  echo Instala yt-dlp o anade su carpeta al PATH de Windows.
  pause
  exit /b 1
)

for /f "delims=" %%Y in ('where yt-dlp 2^>nul') do if not defined YTDLP_BIN set "YTDLP_BIN=%%Y"

where python >nul 2>&1
if errorlevel 1 (
  echo No se ha encontrado Python en el PATH.
  echo Instala Python 3.10 o posterior para usar SHAZAM.
  pause
  exit /b 1
)

for /f "delims=" %%P in ('where python 2^>nul') do if not defined PYTHON_BIN set "PYTHON_BIN=%%P"

echo Iniciando AntiTube...
echo Frontend: http://localhost:3000
echo Backend:  http://localhost:4000
echo yt-dlp:   %YTDLP_BIN%
echo Python:   %PYTHON_BIN%
echo.

call pnpm dev

echo.
echo AntiTube se ha detenido.
pause
