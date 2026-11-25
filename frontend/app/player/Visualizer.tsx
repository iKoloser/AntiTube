"use client";

import { useEffect, useRef } from "react";

type Variant = "bars" | "radial" | "mini" | "wave";

/**
 * Visualizador del audio en un <canvas>. Lee el analizador de Web Audio del
 * reproductor; sin sonido dibuja una línea de reposo que respira despacio.
 */
export default function Visualizer({ analyser, playing, variant = "bars", className, hue = 205 }: Readonly<{ analyser: AnalyserNode | null; playing: boolean; variant?: Variant; className?: string; hue?: number }>) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hueRef = useRef(hue);
  hueRef.current = hue;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    let frame = 0;
    let running = true;
    const frequency = new Uint8Array(analyser?.frequencyBinCount ?? 1024);
    const waveform = new Uint8Array(analyser?.fftSize ?? 2048);
    const peaks = new Float32Array(96);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const draw = (now: number) => {
      if (!running) return;
      const { width, height } = canvas.getBoundingClientRect();
      context.clearRect(0, 0, width, height);
      const base = hueRef.current;
      const live = Boolean(analyser && playing);
      if (analyser) {
        analyser.getByteFrequencyData(frequency);
        analyser.getByteTimeDomainData(waveform);
      }
      // Bandas en escala logarítmica: los graves no se comen todo el ancho.
      const band = (position: number, count: number) => {
        if (!live) return (Math.sin(now / 900 + position * 0.35) + 1) * 0.04;
        const start = Math.floor(Math.pow(position / count, 2.1) * frequency.length * 0.72);
        const end = Math.max(start + 1, Math.floor(Math.pow((position + 1) / count, 2.1) * frequency.length * 0.72));
        let total = 0;
        for (let bin = start; bin < end; bin += 1) total += frequency[bin];
        return total / (end - start) / 255;
      };

      if (variant === "radial") {
        const count = 96;
        const centerX = width / 2;
        const centerY = height / 2;
        const radius = Math.min(width, height) * 0.36;
        const energy = live ? band(1, 24) : 0.05;
        context.save();
        context.translate(centerX, centerY);
        // Anillo exterior que late con los graves.
        context.beginPath();
        context.arc(0, 0, radius * (1 + energy * 0.08), 0, Math.PI * 2);
        context.strokeStyle = `hsla(${base}, 100%, 65%, ${0.25 + energy * 0.5})`;
        context.lineWidth = 1.5;
        context.shadowBlur = 18;
        context.shadowColor = `hsla(${base}, 100%, 60%, 0.8)`;
        context.stroke();
        for (let position = 0; position < count; position += 1) {
          const mirrored = position < count / 2 ? position : count - position - 1;
          const value = band(mirrored, count / 2);
          peaks[position] = Math.max(value, peaks[position] - 0.012);
          const angle = (position / count) * Math.PI * 2 - Math.PI / 2;
          const length = radius * 0.06 + value * radius * 0.55;
          const inner = radius * 1.08;
          context.strokeStyle = `hsla(${base + value * 70}, 100%, ${55 + value * 20}%, ${0.35 + value * 0.65})`;
          context.lineWidth = Math.max(1.5, (Math.PI * 2 * inner) / count * 0.5);
          context.beginPath();
          context.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
          context.lineTo(Math.cos(angle) * (inner + length), Math.sin(angle) * (inner + length));
          context.stroke();
          const peak = inner + radius * 0.06 + peaks[position] * radius * 0.55 + 4;
          context.fillStyle = `hsla(${base + 40}, 100%, 75%, 0.7)`;
          context.fillRect(Math.cos(angle) * peak - 1, Math.sin(angle) * peak - 1, 2, 2);
        }
        context.restore();
      } else if (variant === "wave") {
        context.lineWidth = 2;
        context.strokeStyle = `hsla(${base}, 100%, 65%, 0.9)`;
        context.shadowBlur = 12;
        context.shadowColor = `hsla(${base}, 100%, 60%, 0.8)`;
        context.beginPath();
        const step = Math.max(1, Math.floor(waveform.length / width));
        for (let x = 0; x < width; x += 1) {
          const sample = live ? (waveform[x * step] ?? 128) / 128 - 1 : Math.sin(now / 600 + x / 30) * 0.03;
          const y = height / 2 + sample * height * 0.45;
          if (x === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
        context.shadowBlur = 0;
      } else {
        const count = variant === "mini" ? 18 : Math.max(24, Math.min(96, Math.floor(width / 9)));
        const gap = variant === "mini" ? 2 : 3;
        const barWidth = (width - gap * (count - 1)) / count;
        const gradient = context.createLinearGradient(0, height, 0, 0);
        gradient.addColorStop(0, `hsla(${base}, 100%, 55%, 0.95)`);
        gradient.addColorStop(0.65, `hsla(${base + 35}, 100%, 62%, 0.9)`);
        gradient.addColorStop(1, `hsla(${base + 80}, 100%, 70%, 0.9)`);
        for (let position = 0; position < count; position += 1) {
          const value = band(position, count);
          peaks[position] = Math.max(value, peaks[position] - (variant === "mini" ? 0.02 : 0.008));
          const barHeight = Math.max(2, value * height * 0.95);
          const x = position * (barWidth + gap);
          context.fillStyle = gradient;
          context.fillRect(x, height - barHeight, barWidth, barHeight);
          if (variant !== "mini") {
            context.fillStyle = `hsla(${base + 60}, 100%, 80%, 0.75)`;
            context.fillRect(x, height - Math.max(2, peaks[position] * height * 0.95) - 3, barWidth, 2);
          }
        }
      }
      if (!reduced || live) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => { running = false; cancelAnimationFrame(frame); observer.disconnect(); };
  }, [analyser, playing, variant]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
