"use client";

import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  baseAlpha: number;
  pulseSpeed: number;
  pulseOffset: number;
  color: string;
  isNode: boolean;
}

interface FloatingGlyph {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  baseSize: number;
  rotation: number;
  rotationSpeed: number;
  floatPhase: number;
  floatSpeed: number;
  type: "hexagon" | "diamond" | "triangle" | "reticle" | "brackets" | "cube";
  alpha: number;
  color: string;
}

interface OrbitalRing {
  anchorX: number; // normalized 0..1
  anchorY: number; // normalized 0..1
  driftPhase: number;
  driftSpeed: number;
  driftRadius: number;
  radius: number;
  rotation: number;
  speed: number;
  dashPattern: number[];
  alpha: number;
  hasTicks: boolean;
  innerRingRatio: number;
}

interface DataPulse {
  x: number;
  y: number;
  vx: number;
  vy: number;
  length: number;
  alpha: number;
  life: number;
  maxLife: number;
}

export default function FuturisticBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    let animationFrameId = 0;

    const mouse = {
      x: width / 2,
      y: height / 2,
      targetX: width / 2,
      targetY: height / 2,
      active: false,
    };

    const colors = [
      "57, 167, 255",  // electric blue (--accent)
      "0, 229, 255",   // cyber cyan
      "120, 195, 255", // soft sky blue
      "232, 228, 220", // warm terminal off-white
    ];

    let particles: Particle[] = [];
    let glyphs: FloatingGlyph[] = [];
    let orbitals: OrbitalRing[] = [];
    let pulses: DataPulse[] = [];

    function randomVelocity(minSpeed: number, maxSpeed: number) {
      const angle = Math.random() * Math.PI * 2;
      const speed = minSpeed + Math.random() * (maxSpeed - minSpeed);
      return {
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
      };
    }

    function initScene() {
      width = window.innerWidth;
      height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (!canvas || !ctx) return;

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Scale particle count for 1080p without overloading
      const area = width * height;
      const particleCount = Math.min(115, Math.max(55, Math.floor(area / 18000)));

      particles = Array.from({ length: particleCount }, (_, i) => {
        const isNode = i % 5 === 0;
        const baseAlpha = isNode ? 0.38 + Math.random() * 0.25 : 0.16 + Math.random() * 0.25;
        const vel = randomVelocity(0.35, 0.85);
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          vx: vel.vx,
          vy: vel.vy,
          radius: isNode ? 1.8 + Math.random() * 1.4 : 0.9 + Math.random() * 1.1,
          alpha: baseAlpha,
          baseAlpha,
          pulseSpeed: 0.03 + Math.random() * 0.04,
          pulseOffset: Math.random() * Math.PI * 2,
          color: colors[i % colors.length],
          isNode,
        };
      });

      const glyphTypes: FloatingGlyph["type"][] = [
        "hexagon",
        "diamond",
        "triangle",
        "reticle",
        "brackets",
        "cube",
      ];

      const glyphCount = Math.min(24, Math.max(14, Math.floor(area / 90000)));
      glyphs = Array.from({ length: glyphCount }, (_, i) => {
        // Bias glyphs toward left/right flanks so they shine on 1080p widescreen around the central card
        const onFlank = i % 3 !== 0;
        let x = Math.random() * width;
        if (onFlank && width > 1100) {
          const side = i % 2 === 0 ? 0 : 1;
          x = side === 0
            ? Math.random() * (width * 0.28)
            : width - Math.random() * (width * 0.28);
        }
        const vel = randomVelocity(0.45, 0.95);
        const dir = i % 2 === 0 ? 1 : -1;
        const baseSize = 16 + Math.random() * 28;
        return {
          x,
          y: Math.random() * height,
          vx: vel.vx,
          vy: vel.vy,
          size: baseSize,
          baseSize,
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: dir * (0.008 + Math.random() * 0.014),
          floatPhase: Math.random() * Math.PI * 2,
          floatSpeed: 0.02 + Math.random() * 0.025,
          type: glyphTypes[i % glyphTypes.length],
          alpha: 0.14 + Math.random() * 0.18,
          color: i % 3 === 0 ? colors[1] : colors[0],
        };
      });

      // Futuristic HUD orbital drawings positioned on the left & right flanks of 1080p screens
      orbitals = [
        {
          anchorX: 0.12,
          anchorY: 0.32,
          driftPhase: 0,
          driftSpeed: 0.012,
          driftRadius: 22,
          radius: 135,
          rotation: 0,
          speed: 0.0065,
          dashPattern: [18, 10, 4, 10],
          alpha: 0.17,
          hasTicks: true,
          innerRingRatio: 0.68,
        },
        {
          anchorX: 0.88,
          anchorY: 0.66,
          driftPhase: 1.8,
          driftSpeed: 0.01,
          driftRadius: 26,
          radius: 155,
          rotation: 1.2,
          speed: -0.0055,
          dashPattern: [28, 14, 6, 14],
          alpha: 0.16,
          hasTicks: true,
          innerRingRatio: 0.72,
        },
        {
          anchorX: 0.86,
          anchorY: 0.2,
          driftPhase: 3.1,
          driftSpeed: 0.015,
          driftRadius: 18,
          radius: 75,
          rotation: 0.5,
          speed: 0.009,
          dashPattern: [10, 8],
          alpha: 0.14,
          hasTicks: false,
          innerRingRatio: 0.55,
        },
        {
          anchorX: 0.14,
          anchorY: 0.8,
          driftPhase: 4.5,
          driftSpeed: 0.013,
          driftRadius: 20,
          radius: 90,
          rotation: 2.1,
          speed: -0.008,
          dashPattern: [14, 12, 3, 12],
          alpha: 0.14,
          hasTicks: false,
          innerRingRatio: 0.6,
        },
      ];

      pulses = [];
    }

    function spawnPulse() {
      const horizontal = Math.random() > 0.45;
      const gridStep = 64;
      if (horizontal) {
        const y = Math.round((Math.random() * height) / gridStep) * gridStep;
        const dir = Math.random() > 0.5 ? 1 : -1;
        pulses.push({
          x: dir === 1 ? -80 : width + 80,
          y,
          vx: dir * (3.2 + Math.random() * 2.2),
          vy: 0,
          length: 80 + Math.random() * 70,
          alpha: 0.32,
          life: 0,
          maxLife: Math.ceil((width + 200) / 3),
        });
      } else {
        const x = Math.round((Math.random() * width) / gridStep) * gridStep;
        const dir = Math.random() > 0.5 ? 1 : -1;
        pulses.push({
          x,
          y: dir === 1 ? -80 : height + 80,
          vx: 0,
          vy: dir * (2.8 + Math.random() * 2.0),
          length: 75 + Math.random() * 65,
          alpha: 0.28,
          life: 0,
          maxLife: Math.ceil((height + 200) / 2.6),
        });
      }
    }

    function drawGlyph(context: CanvasRenderingContext2D, g: FloatingGlyph) {
      context.save();
      context.translate(g.x, g.y);
      context.rotate(g.rotation);
      context.strokeStyle = `rgba(${g.color}, ${g.alpha})`;
      context.fillStyle = `rgba(${g.color}, ${g.alpha * 0.65})`;
      context.lineWidth = 1.1;

      const s = g.size;

      switch (g.type) {
        case "hexagon": {
          context.beginPath();
          for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i;
            const px = Math.cos(angle) * s;
            const py = Math.sin(angle) * s;
            if (i === 0) context.moveTo(px, py);
            else context.lineTo(px, py);
          }
          context.closePath();
          context.stroke();

          // Inner circuit spokes
          context.beginPath();
          for (let i = 0; i < 6; i += 2) {
            const angle = (Math.PI / 3) * i;
            context.moveTo(0, 0);
            context.lineTo(Math.cos(angle) * (s * 0.55), Math.sin(angle) * (s * 0.55));
          }
          context.strokeStyle = `rgba(${g.color}, ${g.alpha * 0.55})`;
          context.stroke();
          break;
        }

        case "cube": {
          // Isometric wireframe cube projection
          const r = s * 0.85;
          context.beginPath();
          for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i - Math.PI / 6;
            const px = Math.cos(angle) * r;
            const py = Math.sin(angle) * r;
            if (i === 0) context.moveTo(px, py);
            else context.lineTo(px, py);
          }
          context.closePath();
          for (let i = 0; i < 6; i += 2) {
            const angle = (Math.PI / 3) * i - Math.PI / 6;
            context.moveTo(0, 0);
            context.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
          }
          context.stroke();
          break;
        }

        case "diamond": {
          context.beginPath();
          context.moveTo(0, -s);
          context.lineTo(s * 0.75, 0);
          context.lineTo(0, s);
          context.lineTo(-s * 0.75, 0);
          context.closePath();
          context.stroke();

          context.beginPath();
          context.arc(0, 0, 2.2, 0, Math.PI * 2);
          context.fill();
          break;
        }

        case "triangle": {
          context.beginPath();
          for (let i = 0; i < 3; i++) {
            const angle = ((Math.PI * 2) / 3) * i - Math.PI / 2;
            const px = Math.cos(angle) * s;
            const py = Math.sin(angle) * s;
            if (i === 0) context.moveTo(px, py);
            else context.lineTo(px, py);
          }
          context.closePath();
          context.stroke();

          // Center target dot
          context.beginPath();
          context.arc(0, 0, s * 0.22, 0, Math.PI * 2);
          context.strokeStyle = `rgba(${g.color}, ${g.alpha * 0.55})`;
          context.stroke();
          break;
        }

        case "reticle": {
          const r = s * 0.7;
          context.beginPath();
          context.arc(0, 0, r, 0, Math.PI * 2);
          context.stroke();

          context.beginPath();
          context.moveTo(-s, 0);
          context.lineTo(-r * 0.45, 0);
          context.moveTo(r * 0.45, 0);
          context.lineTo(s, 0);
          context.moveTo(0, -s);
          context.lineTo(0, -r * 0.45);
          context.moveTo(0, r * 0.45);
          context.lineTo(0, s);
          context.stroke();
          break;
        }

        case "brackets": {
          const b = s * 0.65;
          const arm = b * 0.45;
          context.beginPath();
          // Top-left
          context.moveTo(-b, -b + arm);
          context.lineTo(-b, -b);
          context.lineTo(-b + arm, -b);
          // Top-right
          context.moveTo(b - arm, -b);
          context.lineTo(b, -b);
          context.lineTo(b, -b + arm);
          // Bottom-right
          context.moveTo(b, b - arm);
          context.lineTo(b, b);
          context.lineTo(b - arm, b);
          // Bottom-left
          context.moveTo(-b + arm, b);
          context.lineTo(-b, b);
          context.lineTo(-b, b - arm);
          context.stroke();

          context.beginPath();
          context.moveTo(-3, 0);
          context.lineTo(3, 0);
          context.moveTo(0, -3);
          context.lineTo(0, 3);
          context.stroke();
          break;
        }
      }

      context.restore();
    }

    function drawOrbital(context: CanvasRenderingContext2D, orb: OrbitalRing, parallaxX: number, parallaxY: number) {
      const driftX = Math.cos(orb.driftPhase) * orb.driftRadius;
      const driftY = Math.sin(orb.driftPhase * 0.8) * orb.driftRadius;
      const cx = orb.anchorX * width + driftX + parallaxX * 0.35;
      const cy = orb.anchorY * height + driftY + parallaxY * 0.35;

      context.save();
      context.translate(cx, cy);

      // Outer dashed ring
      context.save();
      context.rotate(orb.rotation);
      context.strokeStyle = `rgba(57, 167, 255, ${orb.alpha})`;
      context.lineWidth = 1.1;
      context.setLineDash(orb.dashPattern);
      context.beginPath();
      context.arc(0, 0, orb.radius, 0, Math.PI * 2);
      context.stroke();

      // Compass ticks around outer ring
      if (orb.hasTicks) {
        context.setLineDash([]);
        context.strokeStyle = `rgba(0, 229, 255, ${orb.alpha * 0.85})`;
        const tickCount = 24;
        for (let i = 0; i < tickCount; i++) {
          const angle = ((Math.PI * 2) / tickCount) * i;
          const len = i % 6 === 0 ? 9 : 4;
          const r1 = orb.radius + 4;
          const r2 = r1 + len;
          context.beginPath();
          context.moveTo(Math.cos(angle) * r1, Math.sin(angle) * r1);
          context.lineTo(Math.cos(angle) * r2, Math.sin(angle) * r2);
          context.stroke();
        }
      }
      context.restore();

      // Counter-rotating inner schematic ring
      context.save();
      context.rotate(-orb.rotation * 1.5);
      context.strokeStyle = `rgba(0, 229, 255, ${orb.alpha * 0.8})`;
      context.lineWidth = 1;
      context.setLineDash([6, 12, 24, 12]);
      context.beginPath();
      context.arc(0, 0, orb.radius * orb.innerRingRatio, 0, Math.PI * 2);
      context.stroke();

      // Subtle orbital node dots on inner ring
      context.setLineDash([]);
      context.fillStyle = `rgba(57, 167, 255, ${orb.alpha * 1.5})`;
      for (let i = 0; i < 3; i++) {
        const a = ((Math.PI * 2) / 3) * i;
        const rx = Math.cos(a) * (orb.radius * orb.innerRingRatio);
        const ry = Math.sin(a) * (orb.radius * orb.innerRingRatio);
        context.beginPath();
        context.arc(rx, ry, 2.2, 0, Math.PI * 2);
        context.fill();
      }
      context.restore();

      // Center subtle crosshair
      context.strokeStyle = `rgba(57, 167, 255, ${orb.alpha * 0.65})`;
      context.beginPath();
      context.moveTo(-6, 0);
      context.lineTo(6, 0);
      context.moveTo(0, -6);
      context.lineTo(0, 6);
      context.stroke();

      context.restore();
    }

    let tick = 0;
    let lastTime = performance.now();

    function render(now: number) {
      if (!ctx) return;
      const elapsed = now - lastTime;
      lastTime = now;
      // Normalize delta to 60fps (16.67ms per frame), clamped to avoid huge jumps on tab switch
      const dt = Math.min(2.5, Math.max(0.5, elapsed / 16.667));
      tick += dt;

      ctx.clearRect(0, 0, width, height);

      // Smooth mouse interpolation for gentle parallax
      mouse.x += (mouse.targetX - mouse.x) * 0.06 * dt;
      mouse.y += (mouse.targetY - mouse.y) * 0.06 * dt;
      const parallaxX = ((mouse.x - width / 2) / width) * -32;
      const parallaxY = ((mouse.y - height / 2) / height) * -32;

      // 1. Subtle technical blueprint grid (slowly scrolling + parallax)
      const gridStep = 64;
      ctx.strokeStyle = "rgba(57, 167, 255, 0.035)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      const offsetX = (((parallaxX * 0.25 + tick * 0.12) % gridStep) + gridStep) % gridStep;
      const offsetY = (((parallaxY * 0.25 + tick * 0.08) % gridStep) + gridStep) % gridStep;
      for (let x = offsetX; x < width; x += gridStep) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      for (let y = offsetY; y < height; y += gridStep) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();

      // 2. Data pulses traveling along the grid lines
      if (pulses.length < 5 && Math.random() < 0.05) {
        spawnPulse();
      }

      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life += dt;

        const tailX = p.x - Math.sign(p.vx) * p.length;
        const tailY = p.y - Math.sign(p.vy) * p.length;

        const grad = ctx.createLinearGradient(tailX, tailY, p.x, p.y);
        grad.addColorStop(0, "rgba(0, 229, 255, 0)");
        grad.addColorStop(1, `rgba(0, 229, 255, ${p.alpha})`);

        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();

        if (p.life >= p.maxLife) {
          pulses.splice(i, 1);
        }
      }

      // 3. Futuristic HUD orbitals (rotating & gently drifting)
      for (const orb of orbitals) {
        orb.rotation += orb.speed * dt;
        orb.driftPhase += orb.driftSpeed * dt;
        drawOrbital(ctx, orb, parallaxX, parallaxY);
      }

      // 4. Floating geometric wireframe drawings (glyphs)
      for (const g of glyphs) {
        g.floatPhase += g.floatSpeed * dt;
        g.x += (g.vx + Math.sin(g.floatPhase) * 0.25) * dt;
        g.y += (g.vy + Math.cos(g.floatPhase * 0.85) * 0.25) * dt;
        g.rotation += g.rotationSpeed * dt;
        g.size = g.baseSize * (1 + Math.sin(g.floatPhase) * 0.08);

        if (g.x < -70) g.x = width + 70;
        if (g.x > width + 70) g.x = -70;
        if (g.y < -70) g.y = height + 70;
        if (g.y > height + 70) g.y = -70;

        drawGlyph(ctx, g);
      }

      // 5. Constellation particles & network connections
      const connectionDist = 135;
      const connectionDistSq = connectionDist * connectionDist;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        p.x += p.vx * dt;
        p.y += p.vy * dt;

        // Gentle interaction with cursor
        if (mouse.active) {
          const dxMouse = p.x - mouse.x;
          const dyMouse = p.y - mouse.y;
          const distMouseSq = dxMouse * dxMouse + dyMouse * dyMouse;
          if (distMouseSq < 22000 && distMouseSq > 1) {
            const distMouse = Math.sqrt(distMouseSq);
            const force = (148 - distMouse) / 148;
            p.x += (dxMouse / distMouse) * force * 0.75 * dt;
            p.y += (dyMouse / distMouse) * force * 0.75 * dt;
          }
        }

        if (p.x < -10) p.x = width + 10;
        if (p.x > width + 10) p.x = -10;
        if (p.y < -10) p.y = height + 10;
        if (p.y > height + 10) p.y = -10;

        p.alpha =
          p.baseAlpha +
          Math.sin(tick * p.pulseSpeed + p.pulseOffset) * (p.baseAlpha * 0.35);

        // Connect nearby particles with futuristic circuit/constellation lines
        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dx = p.x - p2.x;
          const dy = p.y - p2.y;
          const distSq = dx * dx + dy * dy;

          if (distSq < connectionDistSq) {
            const dist = Math.sqrt(distSq);
            const lineAlpha = (1 - dist / connectionDist) * 0.15;
            ctx.strokeStyle = `rgba(57, 167, 255, ${lineAlpha})`;
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }

        // Draw particle core
        ctx.fillStyle = `rgba(${p.color}, ${p.alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();

        // Subtle outer halo for key data nodes
        if (p.isNode) {
          ctx.strokeStyle = `rgba(${p.color}, ${p.alpha * 0.45})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius + 3.2, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      animationFrameId = window.requestAnimationFrame(render);
    }

    initScene();
    animationFrameId = window.requestAnimationFrame(render);

    const handleResize = () => {
      initScene();
    };

    const handleMouseMove = (event: MouseEvent) => {
      mouse.targetX = event.clientX;
      mouse.targetY = event.clientY;
      mouse.active = true;
    };

    const handleMouseLeave = () => {
      mouse.active = false;
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    window.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, []);

  return (
    <div className="futuristic-bg" aria-hidden="true">
      <canvas ref={canvasRef} className="futuristic-canvas" />
      <div className="futuristic-vignette" />
    </div>
  );
}
