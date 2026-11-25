"use client";

import { useEffect, useRef } from "react";
import { usePlayer } from "../player/PlayerContext";
import { useTheme } from "./theme";

const glyphs = "アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEF<>/{}[]#$%&*+=";

type Column = { x: number; y: number; speed: number; length: number; chars: string[] };
type Spark = { x: number; y: number; vy: number; vx: number; life: number; size: number };

/**
 * Fondo vivo: horizonte de rejilla en perspectiva, lluvia de datos y chispas.
 * Late con los graves de lo que suena (lee el analizador del reproductor) y
 * toma el color del tema. Se detiene cuando la ventana no está visible.
 */
export default function LiveBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { analyser, playing } = usePlayer();
  const { effects, theme } = useTheme();
  const audioRef = useRef({ analyser, playing });
  audioRef.current = { analyser, playing };

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    let width = 0;
    let height = 0;
    let frame = 0;
    let last = 0;
    let offset = 0;
    let energy = 0;
    let columns: Column[] = [];
    const sparks: Spark[] = [];
    const bins = new Uint8Array(1024);
    const rgb = theme.vars["--accent-rgb"].split(/\s+/).map(Number);
    const [r, g, b] = rgb.length === 3 && rgb.every(Number.isFinite) ? rgb : [57, 167, 255];
    const color = (alpha: number) => `rgba(${r}, ${g}, ${b}, ${alpha})`;
    const randomGlyph = () => glyphs[Math.floor(Math.random() * glyphs.length)];

    const resize = () => {
      const scale = Math.min(window.devicePixelRatio || 1, 1.5);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * scale);
      canvas.height = Math.floor(height * scale);
      context.setTransform(scale, 0, 0, scale, 0, 0);
      const count = Math.floor(width / 34);
      columns = Array.from({ length: count }, (_, index) => ({
        x: index * 34 + 12 + Math.random() * 10,
        y: Math.random() * height,
        speed: 22 + Math.random() * 60,
        length: 6 + Math.floor(Math.random() * 14),
        chars: Array.from({ length: 22 }, randomGlyph)
      }));
    };

    const draw = (now: number) => {
      const delta = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
      last = now;
      const { analyser: node, playing: isPlaying } = audioRef.current;

      // Energía de los graves (0..1), suavizada para que el latido no sea brusco.
      let target = 0;
      if (effects.reactive && node && isPlaying) {
        node.getByteFrequencyData(bins.subarray(0, node.frequencyBinCount));
        let sum = 0;
        for (let index = 1; index < 10; index += 1) sum += bins[index];
        target = Math.pow(sum / (9 * 255), 1.6);
      }
      energy += (target - energy) * (target > energy ? 0.35 : 0.08);

      context.clearRect(0, 0, width, height);
      const horizon = height * 0.6;

      // Resplandor del horizonte.
      const glow = context.createRadialGradient(width / 2, horizon, 0, width / 2, horizon, Math.max(width, height) * 0.7);
      glow.addColorStop(0, color(0.16 + energy * 0.22));
      glow.addColorStop(0.35, color(0.04 + energy * 0.05));
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      context.fillStyle = glow;
      context.fillRect(0, 0, width, height);

      // Lluvia de datos en la parte de arriba.
      context.font = "13px 'JetBrains Mono', Consolas, monospace";
      context.textAlign = "center";
      for (const column of columns) {
        column.y += column.speed * delta * (1 + energy * 2.5);
        if (column.y - column.length * 16 > horizon) {
          column.y = -Math.random() * 200;
          column.speed = 22 + Math.random() * 60;
        }
        if (Math.random() < 0.04) column.chars[Math.floor(Math.random() * column.chars.length)] = randomGlyph();
        for (let index = 0; index < column.length; index += 1) {
          const y = column.y - index * 16;
          if (y < 0 || y > horizon) continue;
          const fade = 1 - index / column.length;
          const nearHorizon = 1 - Math.max(0, (y - horizon * 0.55) / (horizon * 0.45));
          const alpha = (index === 0 ? 0.32 : 0.1 * fade) * nearHorizon * (0.75 + energy * 0.8);
          if (alpha < 0.01) continue;
          context.fillStyle = index === 0 ? `rgba(235, 245, 255, ${alpha})` : color(alpha);
          context.fillText(column.chars[index % column.chars.length], column.x, y);
        }
      }

      // Suelo de rejilla en perspectiva que avanza hacia ti.
      offset = (offset + delta * (0.35 + energy * 2.2)) % 1;
      const depthLines = 18;
      context.lineWidth = 1;
      for (let index = 0; index < depthLines; index += 1) {
        const t = (index + offset) / depthLines;
        const y = horizon + Math.pow(t, 2.4) * (height - horizon) * 1.05;
        context.strokeStyle = color(Math.min(0.5, 0.05 + t * 0.32 + energy * 0.25 * t));
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();
      }
      const rays = 26;
      for (let index = -rays; index <= rays; index += 1) {
        const spread = index / rays;
        context.strokeStyle = color(0.06 + (1 - Math.abs(spread)) * 0.12 + energy * 0.12);
        context.beginPath();
        context.moveTo(width / 2 + spread * width * 0.08, horizon);
        context.lineTo(width / 2 + spread * width * 2.2, height);
        context.stroke();
      }
      // Línea del horizonte.
      const line = context.createLinearGradient(0, 0, width, 0);
      line.addColorStop(0, "rgba(0, 0, 0, 0)");
      line.addColorStop(0.5, color(0.55 + energy * 0.45));
      line.addColorStop(1, "rgba(0, 0, 0, 0)");
      context.fillStyle = line;
      context.fillRect(0, horizon - 1, width, 2);

      // Chispas que suben desde el horizonte con cada golpe de graves.
      if (sparks.length < 90 && Math.random() < 0.08 + energy * 0.9) {
        sparks.push({ x: width / 2 + (Math.random() - 0.5) * width * 0.9, y: horizon + Math.random() * 40, vy: -(18 + Math.random() * 50) * (1 + energy * 2), vx: (Math.random() - 0.5) * 12, life: 1, size: 0.6 + Math.random() * 1.6 });
      }
      for (let index = sparks.length - 1; index >= 0; index -= 1) {
        const spark = sparks[index];
        spark.x += spark.vx * delta;
        spark.y += spark.vy * delta;
        spark.life -= delta * 0.35;
        if (spark.life <= 0 || spark.y < 0) { sparks.splice(index, 1); continue; }
        context.fillStyle = color(spark.life * 0.7);
        context.beginPath();
        context.arc(spark.x, spark.y, spark.size, 0, Math.PI * 2);
        context.fill();
      }
    };

    let paused = false;
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (paused) return;
      // Sin música basta con 30 fotogramas por segundo.
      if (!audioRef.current.playing && now - last < 32) return;
      draw(now);
    };

    resize();
    window.addEventListener("resize", resize);
    const onVisibility = () => { paused = document.hidden; last = 0; };
    document.addEventListener("visibilitychange", onVisibility);
    if (effects.motion) frame = requestAnimationFrame(loop);
    else draw(performance.now());
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [effects.motion, effects.reactive, theme]);

  return <div className="live-bg" aria-hidden="true">
    <canvas ref={canvasRef} className="live-bg-canvas" />
    <div className="live-bg-vignette" />
  </div>;
}
