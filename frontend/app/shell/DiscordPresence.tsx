"use client";

import { useEffect, useRef, useState } from "react";
import { usePlayer } from "../player/PlayerContext";
import { isDesktop, setDiscordPresence, type DiscordPresence } from "../runtime";

export const discordKey = "antitube-discord";
export const discordSettingEvent = "antitube-discord-setting";

export function discordEnabled(): boolean {
  return typeof localStorage !== "undefined" && localStorage.getItem(discordKey) !== "0";
}

/**
 * Envía a Discord lo que suena: título, artista, portada (si es de internet),
 * barra de tiempo y un botón al original. Solo manda cambios de verdad
 * (otra canción, pausa, un salto), no cada segundo.
 */
export default function DiscordBridge() {
  const { current, playing, time, duration } = usePlayer();
  const [enabled, setEnabled] = useState(true);
  const last = useRef<string>("");
  // Al abrir la app con una canción en pausa de la vez anterior no se muestra nada hasta darle a play.
  const played = useRef(false);
  if (playing) played.current = true;

  useEffect(() => {
    setEnabled(discordEnabled());
    const onChange = () => setEnabled(discordEnabled());
    window.addEventListener(discordSettingEvent, onChange);
    return () => window.removeEventListener(discordSettingEvent, onChange);
  }, []);

  // Momento (en segundos) en que habría empezado la canción: solo cambia al saltar.
  const startedAt = playing ? Math.round(Date.now() / 1000 - time) : 0;

  useEffect(() => {
    if (!isDesktop) return;
    if (!enabled || !current || !played.current) {
      if (last.current !== "off") { last.current = "off"; void setDiscordPresence(null); }
      return;
    }
    const length = duration || current.durationSeconds || 0;
    const presence: DiscordPresence = {
      title: current.title,
      artist: current.artist,
      album: current.album && current.album !== "Streaming" && current.album !== "Vista previa" ? current.album : null,
      cover: current.cover && /^https:\/\//.test(current.cover) ? current.cover : null,
      sourceUrl: current.sourceUrl ?? null,
      video: current.kind === "video",
      playing,
      start: playing ? startedAt * 1000 : null,
      end: playing && length > 0 ? (startedAt + Math.round(length)) * 1000 : null
    };
    const key = JSON.stringify({ ...presence, start: presence.start ? Math.round(presence.start / 3000) : null, end: presence.end ? Math.round(presence.end / 3000) : null });
    if (key === last.current) return;
    last.current = key;
    void setDiscordPresence(presence);
  }, [enabled, current, playing, startedAt, duration]);

  return null;
}
