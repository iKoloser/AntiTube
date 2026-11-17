"""Reconoce un fragmento de audio usando ShazamIO y devuelve JSON."""

from __future__ import annotations

import asyncio
import json
import site
import sys
from urllib.parse import quote_plus

try:
    from shazamio import Serialize, Shazam
except ModuleNotFoundError as error:
    # Algunas instalaciones de Python lanzadas desde Node/tsx desactivan
    # accidentalmente el site-packages del usuario. ShazamIO se instala ahí
    # con `python -m pip install --user`, así que lo añadimos como fallback.
    user_site = site.getusersitepackages()
    if user_site not in sys.path:
        sys.path.append(user_site)
    try:
        from shazamio import Serialize, Shazam
    except ModuleNotFoundError:
        raise error


def search_url(base: str, query: str) -> str:
    return f"{base}{quote_plus(query)}"


async def recognize(audio_path: str) -> dict[str, object]:
    async with Shazam() as shazam:
        raw = await shazam.recognize(audio_path, max_skew=1e-3)

    response = Serialize.full_track(raw)
    track = response.track
    if track is None:
        return {"matched": False, "message": "No se ha reconocido ninguna canción en el fragmento."}

    query = f"{track.subtitle} {track.title}".strip()
    youtube_url = track.youtube_link or search_url("https://www.youtube.com/results?search_query=", query)
    if track.youtube_link:
        try:
            youtube_data = await shazam.get_youtube_data(link=track.youtube_link)
            youtube_url = Serialize.youtube(youtube_data).uri or youtube_url
        except Exception:
            # Shazam puede reconocer la canción aunque su consulta de vídeo falle.
            pass
    # Shazam suele devolver un proxy CDN, no una página pública de YouTube.
    # Para el enlace visible usamos una búsqueda oficial; la descarga usa
    # ytsearch1 con el título y artista reconocidos.
    if "cdn.shazam.com" in youtube_url:
        youtube_url = search_url("https://www.youtube.com/results?search_query=", query)
    spotify_url = track.spotify_uri if track.spotify_uri and track.spotify_uri.startswith("http") else search_url("https://open.spotify.com/search/", query)
    soundcloud_url = search_url("https://soundcloud.com/search?q=", query)
    return {
        "matched": True,
        "title": track.title,
        "artist": track.subtitle,
        "artworkUrl": track.photo_url,
        "shazamUrl": track.shazam_url,
        "youtubeUrl": youtube_url,
        "spotifyUrl": spotify_url,
        "soundcloudUrl": soundcloud_url,
        "providerLinks": [
            {"name": provider.caption, "url": provider.actions[0].uri}
            for provider in track.providers
            if provider.actions
        ],
    }


async def main() -> None:
    if len(sys.argv) != 2:
        raise ValueError("Indica la ruta del archivo de audio.")
    print(json.dumps(await recognize(sys.argv[1]), ensure_ascii=False))


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False))
        raise
