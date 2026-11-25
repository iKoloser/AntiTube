/** Iconos de línea de la interfaz (24×24, trazo actual). */

type IconProps = { size?: number; className?: string };

function Svg({ size = 20, className, children }: Readonly<IconProps & { children: React.ReactNode }>) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}

export const IconDownload = (props: IconProps) => <Svg {...props}><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></Svg>;
export const IconPlayer = (props: IconProps) => <Svg {...props}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" /><path d="M12 3a9 9 0 0 1 9 9" /></Svg>;
export const IconQueue = (props: IconProps) => <Svg {...props}><path d="M4 6h11" /><path d="M4 12h11" /><path d="M4 18h7" /><path d="m17 15 4 3-4 3z" /></Svg>;
export const IconWave = (props: IconProps) => <Svg {...props}><path d="M2 12h2l2-6 3 14 3-10 2 5 2-3h6" /></Svg>;
export const IconTools = (props: IconProps) => <Svg {...props}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Svg>;
export const IconSearch = (props: IconProps) => <Svg {...props}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Svg>;
export const IconLink = (props: IconProps) => <Svg {...props}><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></Svg>;
export const IconPlay = (props: IconProps) => <Svg {...props}><path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" /></Svg>;
export const IconPause = (props: IconProps) => <Svg {...props}><rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" /><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" /></Svg>;
export const IconNext = (props: IconProps) => <Svg {...props}><path d="M5 5v14l10-7z" fill="currentColor" stroke="none" /><path d="M18 5v14" strokeWidth="2.2" /></Svg>;
export const IconPrevious = (props: IconProps) => <Svg {...props}><path d="M19 5v14L9 12z" fill="currentColor" stroke="none" /><path d="M6 5v14" strokeWidth="2.2" /></Svg>;
export const IconShuffle = (props: IconProps) => <Svg {...props}><path d="M16 3h5v5" /><path d="M4 20 21 3" /><path d="M21 16v5h-5" /><path d="m15 15 6 6" /><path d="M4 4l5 5" /></Svg>;
export const IconRepeat = (props: IconProps) => <Svg {...props}><path d="m17 2 4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="m7 22-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></Svg>;
export const IconVolume = (props: IconProps) => <Svg {...props}><path d="M11 5 6 9H2v6h4l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M19 5a10 10 0 0 1 0 14" /></Svg>;
export const IconMute = (props: IconProps) => <Svg {...props}><path d="M11 5 6 9H2v6h4l5 4z" /><path d="m22 9-6 6" /><path d="m16 9 6 6" /></Svg>;
export const IconEq = (props: IconProps) => <Svg {...props}><path d="M4 21v-7" /><path d="M4 10V3" /><path d="M12 21v-9" /><path d="M12 8V3" /><path d="M20 21v-5" /><path d="M20 12V3" /><path d="M1 14h6" /><path d="M9 8h6" /><path d="M17 16h6" /></Svg>;
export const IconPlus = (props: IconProps) => <Svg {...props}><path d="M12 5v14" /><path d="M5 12h14" /></Svg>;
export const IconList = (props: IconProps) => <Svg {...props}><path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" /></Svg>;
export const IconGrid = (props: IconProps) => <Svg {...props}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></Svg>;
export const IconUser = (props: IconProps) => <Svg {...props}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></Svg>;
export const IconFolder = (props: IconProps) => <Svg {...props}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Svg>;
export const IconFile = (props: IconProps) => <Svg {...props}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></Svg>;
export const IconTrash = (props: IconProps) => <Svg {...props}><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></Svg>;
export const IconClose = (props: IconProps) => <Svg {...props}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></Svg>;
export const IconMore = (props: IconProps) => <Svg {...props}><circle cx="5" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="19" cy="12" r="1.2" fill="currentColor" /></Svg>;
export const IconScissors = (props: IconProps) => <Svg {...props}><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4 8.1 15.9" /><path d="M14.5 14.5 20 20" /><path d="M8.1 8.1 12 12" /></Svg>;
export const IconExpand = (props: IconProps) => <Svg {...props}><path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="m21 3-7 7" /><path d="m3 21 7-7" /></Svg>;
export const IconTimer = (props: IconProps) => <Svg {...props}><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2" /><path d="M9 2h6" /></Svg>;
export const IconHeadphones = (props: IconProps) => <Svg {...props}><path d="M3 18v-6a9 9 0 0 1 18 0v6" /><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3z" /><path d="M3 19a2 2 0 0 0 2 2h1v-6H3z" /></Svg>;
export const IconDisc = (props: IconProps) => <Svg {...props}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2" /><path d="M16.5 7.5a6 6 0 0 1 1.5 4.5" /></Svg>;
export const IconCheck = (props: IconProps) => <Svg {...props}><path d="m5 12 5 5L20 7" /></Svg>;
export const IconRefresh = (props: IconProps) => <Svg {...props}><path d="M21 12a9 9 0 1 1-2.6-6.4L21 8" /><path d="M21 3v5h-5" /></Svg>;
