"use client";

export default function AntiTubeLogo() {
  return (
    <svg
      className="brand-logo-svg"
      viewBox="0 0 320 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="AntiTube"
    >
      <defs>
        <linearGradient id="atCyberCyan" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00e5ff" />
          <stop offset="55%" stopColor="#39a7ff" />
          <stop offset="100%" stopColor="#1d6ff2" />
        </linearGradient>
        <linearGradient id="atMetalWhite" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#c9d4e3" />
        </linearGradient>
        <filter id="atNeonGlow" x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation="2.2" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Emblem Group: Futuristic HUD Hexagon + Deconstructed Play/Slash */}
      <g transform="translate(32, 32)">
        {/* Outer rotating dashed HUD orbital ring */}
        <circle
          className="logo-orbit-outer"
          r="26"
          stroke="#39a7ff"
          strokeOpacity="0.38"
          strokeWidth="1"
          strokeDasharray="10 6 2 6"
        />
        {/* Inner counter-rotating ring */}
        <circle
          className="logo-orbit-inner"
          r="21"
          stroke="#00e5ff"
          strokeOpacity="0.24"
          strokeWidth="0.9"
          strokeDasharray="4 8"
        />

        {/* Outer Wireframe Hexagon */}
        <polygon
          points="0,-22 19.05,-11 19.05,11 0,22 -19.05,11 -19.05,-11"
          fill="#060b14"
          fillOpacity="0.9"
          stroke="url(#atCyberCyan)"
          strokeWidth="1.4"
        />

        {/* Corner HUD brackets */}
        <path
          d="M -23 -17 L -23 -23 L -17 -23"
          stroke="#39a7ff"
          strokeOpacity="0.6"
          strokeWidth="1.1"
        />
        <path
          d="M 23 17 L 23 23 L 17 23"
          stroke="#39a7ff"
          strokeOpacity="0.6"
          strokeWidth="1.1"
        />

        {/* Futuristic Play Prism */}
        <path
          d="M -7 -10.5 L 11.5 0 L -7 10.5 Z"
          fill="#39a7ff"
          fillOpacity="0.16"
          stroke="url(#atMetalWhite)"
          strokeWidth="1.65"
          strokeLinejoin="round"
        />
        <path d="M -3 -4.8 L 5.2 0 L -3 4.8 Z" fill="url(#atCyberCyan)" />

        {/* "ANTI" Cybernetic Vector Slash cutting across the Play icon */}
        <line
          x1="-11.5"
          y1="14.5"
          x2="9.5"
          y2="-14.5"
          stroke="#030508"
          strokeWidth="4.2"
          strokeLinecap="round"
        />
        <line
          x1="-11.5"
          y1="14.5"
          x2="9.5"
          y2="-14.5"
          stroke="url(#atCyberCyan)"
          strokeWidth="2"
          strokeLinecap="round"
          filter="url(#atNeonGlow)"
        />

        {/* Vertex telemetry nodes */}
        <circle cx="0" cy="-22" r="1.8" fill="#00e5ff" />
        <circle cx="19.05" cy="11" r="1.5" fill="#39a7ff" />
        <circle cx="-19.05" cy="11" r="1.5" fill="#39a7ff" />
      </g>

      {/* Top HUD Micro-telemetry label */}
      <g transform="translate(72, 16)">
        <circle className="logo-status-dot" cx="3" cy="-3" r="2" fill="#00e5ff" />
        <text
          x="10"
          y="0"
          fill="#647080"
          fontFamily="var(--font-mono), monospace"
          fontSize="8"
          fontWeight="600"
          letterSpacing="2.6"
        >
          SYS // MEDIA.NODE
        </text>
      </g>

      {/* Custom Geometric Wordmark: ANTI + TUBE */}
      <g transform="translate(71, 44)">
        <text
          x="0"
          y="0"
          fontFamily="var(--font-mono), monospace"
          fontSize="25"
          fontWeight="800"
          letterSpacing="2.2"
        >
          <tspan fill="url(#atMetalWhite)">ANTI</tspan>
          <tspan fill="url(#atCyberCyan)" filter="url(#atNeonGlow)">
            TUBE
          </tspan>
        </text>
      </g>

      {/* Bottom Technical Accent Line + Data ticks */}
      <g transform="translate(72, 52)">
        <line x1="0" y1="0" x2="172" y2="0" stroke="#162231" strokeWidth="1" />
        <line x1="0" y1="0" x2="50" y2="0" stroke="url(#atCyberCyan)" strokeWidth="1.8" />
        <rect x="54" y="-1" width="6" height="2" fill="#39a7ff" fillOpacity="0.75" />
        <rect x="63" y="-1" width="3" height="2" fill="#00e5ff" fillOpacity="0.45" />
      </g>
    </svg>
  );
}
