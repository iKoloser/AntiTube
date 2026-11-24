# Empaquetado Windows

La rama `codex/exe-portable` genera un ejecutable portable de AntiTube:

```powershell
pnpm install
pnpm desktop:package
```

El resultado aparece en `release/AntiTube-0.1.0-portable.exe`. No requiere instalar
Node.js en el equipo del usuario. Al abrirlo, la aplicación lanza el frontend y el
backend localmente dentro de Electron y guarda las descargas en la carpeta de datos
de AntiTube del usuario.

## Herramientas multimedia

El EXE generado actualmente ya incluye estos ejecutables. Para regenerarlo desde
un clon limpio, prepara las herramientas con:

```powershell
powershell -ExecutionPolicy Bypass -File .\desktop\get-tools.ps1
```

También puedes colocarlos manualmente en `desktop/vendor`:

- `desktop/vendor/yt-dlp.exe`
- `desktop/vendor/ffmpeg.exe`

El empaquetador los copia dentro del EXE portable y el backend los usa directamente.

SHAZAM necesita además Python y `shazamio`; se mantiene opcional porque Python y
sus dependencias no se pueden asumir en un Windows limpio sin añadir una runtime
embebida grande. La pestaña principal de descargas no depende de Python.
