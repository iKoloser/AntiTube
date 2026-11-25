/**
 * Logo grande del arranque: emblema centrado con anillos HUD que giran,
 * el nombre debajo y una línea de escaneo. Todo toma el color del tema.
 */
export default function BootLogo() {
  return <div className="boot-logo" role="img" aria-label="AntiTube">
    <svg className="boot-emblem" viewBox="-60 -60 120 120" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="bootAccent" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--accent-2)" />
          <stop offset="60%" stopColor="var(--accent)" />
          <stop offset="100%" stopColor="#1d6ff2" />
        </linearGradient>
        <linearGradient id="bootMetal" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#bfcbdb" />
        </linearGradient>
        <radialGradient id="bootCore">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
        <filter id="bootGlow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.4" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <circle r="56" fill="url(#bootCore)" />
      <g className="boot-ring-outer">
        <circle r="54" stroke="var(--accent)" strokeOpacity="0.45" strokeWidth="0.9" strokeDasharray="22 8 3 8" />
        <circle cx="0" cy="-54" r="2" fill="var(--accent-2)" />
      </g>
      <g className="boot-ring-inner">
        <circle r="46" stroke="var(--accent-2)" strokeOpacity="0.3" strokeWidth="0.8" strokeDasharray="3 7" />
        <path d="M 46 0 A 46 46 0 0 1 0 46" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" filter="url(#bootGlow)" />
      </g>
      <polygon points="0,-38 32.9,-19 32.9,19 0,38 -32.9,19 -32.9,-19" fill="#050a12" stroke="url(#bootAccent)" strokeWidth="1.8" />
      <polygon points="0,-31 26.8,-15.5 26.8,15.5 0,31 -26.8,15.5 -26.8,-15.5" stroke="var(--accent)" strokeOpacity="0.18" strokeWidth="0.8" />
      <path d="M -40 -30 L -40 -40 L -30 -40" stroke="var(--accent)" strokeOpacity="0.7" strokeWidth="1.2" />
      <path d="M 40 30 L 40 40 L 30 40" stroke="var(--accent)" strokeOpacity="0.7" strokeWidth="1.2" />
      <path d="M -11 -17 L 19 0 L -11 17 Z" fill="var(--accent)" fillOpacity="0.14" stroke="url(#bootMetal)" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M -4.5 -7.5 L 8.5 0 L -4.5 7.5 Z" fill="url(#bootAccent)" />
      <line x1="-19" y1="24" x2="16" y2="-24" stroke="#030508" strokeWidth="7" strokeLinecap="round" />
      <line x1="-19" y1="24" x2="16" y2="-24" stroke="url(#bootAccent)" strokeWidth="3" strokeLinecap="round" filter="url(#bootGlow)" />
      <circle cx="0" cy="-38" r="2.4" fill="var(--accent-2)" />
      <circle cx="32.9" cy="19" r="2" fill="var(--accent)" />
      <circle cx="-32.9" cy="19" r="2" fill="var(--accent)" />
    </svg>
    <div className="boot-wordmark"><span className="boot-anti">ANTI</span><span className="boot-tube">TUBE</span></div>
    <div className="boot-rule" aria-hidden="true"><i /></div>
    <p className="boot-tagline">DESCARGA · REPRODUCE · RECONOCE</p>
  </div>;
}
