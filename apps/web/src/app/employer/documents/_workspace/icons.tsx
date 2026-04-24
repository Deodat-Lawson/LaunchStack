import type { CSSProperties, ReactNode } from "react";

export interface IconProps {
  size?: number;
  style?: CSSProperties;
  className?: string;
}

interface IcProps extends IconProps {
  children: ReactNode;
}

const Ic = ({ children, size = 16, style, className }: IcProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={style}
    className={className}
  >
    {children}
  </svg>
);

export const IconPlus = (p: IconProps) => <Ic {...p}><path d="M10 4v12M4 10h12"/></Ic>;
export const IconSearch = (p: IconProps) => <Ic {...p}><circle cx="9" cy="9" r="5.5"/><path d="m13.5 13.5 3 3"/></Ic>;
export const IconSend = (p: IconProps) => <Ic {...p}><path d="M3.5 10 16.5 4l-3 12-3-5.2-4-1.3Z"/></Ic>;
export const IconPaperclip = (p: IconProps) => <Ic {...p}><path d="M14.8 9.3 9.6 14.5a3 3 0 0 1-4.2-4.2l6-6a2 2 0 0 1 2.8 2.8l-6 6a1 1 0 0 1-1.4-1.4l5.3-5.3"/></Ic>;
export const IconX = (p: IconProps) => <Ic {...p}><path d="M5 5l10 10M15 5 5 15"/></Ic>;
export const IconSparkle = (p: IconProps) => <Ic {...p}><path d="M10 3v4M10 13v4M3 10h4M13 10h4M5.5 5.5l2.5 2.5M12 12l2.5 2.5M14.5 5.5 12 8M8 12l-2.5 2.5"/></Ic>;
export const IconArrowUp = (p: IconProps) => <Ic {...p}><path d="M10 15V5M5 10l5-5 5 5"/></Ic>;
export const IconChevronDown = (p: IconProps) => <Ic {...p}><path d="m5 7 5 6 5-6"/></Ic>;
export const IconChevronRight = (p: IconProps) => <Ic {...p}><path d="m7 5 6 5-6 5"/></Ic>;
export const IconChevronLeft = (p: IconProps) => <Ic {...p}><path d="m13 5-6 5 6 5"/></Ic>;
export const IconCheck = (p: IconProps) => <Ic {...p}><path d="m4 10 4 4 8-9"/></Ic>;
export const IconSettings = (p: IconProps) => <Ic {...p}><circle cx="10" cy="10" r="2.2"/><path d="M10 3v2M10 15v2M3 10h2M15 10h2M5.2 5.2l1.4 1.4M13.4 13.4l1.4 1.4M14.8 5.2l-1.4 1.4M6.6 13.4l-1.4 1.4"/></Ic>;
export const IconTokens = (p: IconProps) => <Ic {...p}><circle cx="10" cy="10" r="6"/><path d="M10 6v8M7.5 7.5c1.5-1 3.5-1 5 0M7.5 12.5c1.5 1 3.5 1 5 0"/></Ic>;
export const IconTrash = (p: IconProps) => <Ic {...p}><path d="M4 6h12M8 6V4.5A1.5 1.5 0 0 1 9.5 3h1A1.5 1.5 0 0 1 12 4.5V6M5.5 6l.8 9a1.5 1.5 0 0 0 1.5 1.4h4.4a1.5 1.5 0 0 0 1.5-1.4l.8-9"/></Ic>;
export const IconMore = (p: IconProps) => <Ic {...p}><circle cx="5" cy="10" r="0.9" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="0.9" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="0.9" fill="currentColor" stroke="none"/></Ic>;
export const IconKbd = (p: IconProps) => <Ic {...p}><rect x="2.5" y="5" width="15" height="10" rx="1.5"/><path d="M5 9h.01M8 9h.01M11 9h.01M14 9h.01M6 12h8"/></Ic>;
export const IconCommand = (p: IconProps) => <Ic {...p}><path d="M6 7.5a1.5 1.5 0 1 1 1.5 1.5H12.5a1.5 1.5 0 1 1-1.5-1.5V12.5a1.5 1.5 0 1 1-1.5 1.5H7.5a1.5 1.5 0 1 1 1.5-1.5V7.5"/></Ic>;

export const IconFile = (p: IconProps) => <Ic {...p}><path d="M5 2.5h6L15 6.5V17a.5.5 0 0 1-.5.5h-9A.5.5 0 0 1 5 17V2.5Z"/><path d="M11 2.5V6.5H15"/></Ic>;
export const IconFolder = (p: IconProps) => <Ic {...p}><path d="M3 5.5a1 1 0 0 1 1-1h3.2l1.5 1.5h7.3a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5.5Z"/></Ic>;
export const IconAudio = (p: IconProps) => <Ic {...p}><path d="M7 14V6l7-1.5v8"/><circle cx="5.5" cy="14" r="1.8"/><circle cx="12.5" cy="12.5" r="1.8"/></Ic>;
export const IconVideo = (p: IconProps) => <Ic {...p}><rect x="2.5" y="5" width="11" height="10" rx="1.5"/><path d="m13.5 8.5 4-2v7l-4-2z"/></Ic>;
export const IconLink = (p: IconProps) => <Ic {...p}><path d="M8.5 11.5a3 3 0 0 0 4.3 0l2-2a3 3 0 0 0-4.3-4.3l-.8.8"/><path d="M11.5 8.5a3 3 0 0 0-4.3 0l-2 2a3 3 0 0 0 4.3 4.3l.8-.8"/></Ic>;
export const IconPaste = (p: IconProps) => <Ic {...p}><rect x="5" y="4" width="10" height="13" rx="1.5"/><path d="M7.5 4V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1"/><path d="M7.5 9h5M7.5 12h5M7.5 15h3"/></Ic>;
export const IconYoutube = (p: IconProps) => <Ic {...p}><rect x="2" y="5" width="16" height="10" rx="2.5"/><path d="m8.5 8 4 2-4 2z" fill="currentColor"/></Ic>;
export const IconMic = (p: IconProps) => <Ic {...p}><rect x="7.5" y="3" width="5" height="9" rx="2.5"/><path d="M4.5 10a5.5 5.5 0 0 0 11 0M10 15.5v2"/></Ic>;
export const IconGlobe = (p: IconProps) => <Ic {...p}><circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3c2.2 2.3 3.3 4.7 3.3 7s-1.1 4.7-3.3 7M10 3C7.8 5.3 6.7 7.7 6.7 10s1.1 4.7 3.3 7"/></Ic>;

export const IconGmail = (p: IconProps) => <Ic {...p}><rect x="2.5" y="5" width="15" height="10" rx="1.5"/><path d="m2.5 6 7.5 5.5L17.5 6"/></Ic>;
export const IconNotion = (p: IconProps) => <Ic {...p}><rect x="3.5" y="3.5" width="13" height="13" rx="1.5"/><path d="M7 6v8M7 6l6 8M13 6v8"/></Ic>;
export const IconDrive = (p: IconProps) => <Ic {...p}><path d="m7 3 6 0 5 9-3 5-6 0L4 8Z"/><path d="M7 3 4 8l5 9M13 3l5 9h-8"/></Ic>;
export const IconSlack = (p: IconProps) => <Ic {...p}><rect x="8" y="3" width="3" height="7" rx="1.5"/><rect x="10" y="10" width="7" height="3" rx="1.5"/><rect x="9" y="10" width="3" height="7" rx="1.5"/><rect x="3" y="7" width="7" height="3" rx="1.5"/></Ic>;
export const IconGithub = (p: IconProps) => <Ic {...p}><path d="M10 2.5a7.5 7.5 0 0 0-2.4 14.6c.4.1.5-.2.5-.4v-1.4c-2.1.4-2.5-1-2.5-1-.3-.8-.8-1.1-.8-1.1-.6-.4.05-.4.05-.4.7 0 1.1.7 1.1.7.6 1.1 1.7.8 2.1.6.1-.5.3-.8.5-1-1.7-.2-3.5-.9-3.5-3.8 0-.8.3-1.5.8-2-.1-.2-.3-1 .1-2 0 0 .6-.2 2.1.8a7 7 0 0 1 3.8 0c1.5-1 2.1-.8 2.1-.8.4 1 .2 1.8.1 2 .5.5.8 1.2.8 2 0 2.9-1.8 3.5-3.5 3.7.3.3.5.7.5 1.4v2.1c0 .2.1.5.5.4A7.5 7.5 0 0 0 10 2.5Z"/></Ic>;
export const IconDropbox = (p: IconProps) => <Ic {...p}><path d="m5 4 5 3-5 3-3.5-3Zm10 0 3.5 3L15 10l-5-3Zm-10 9 5 3 5-3-5-3ZM5 10l5 3"/></Ic>;

export const IconCircle = (p: IconProps) => <Ic {...p}><circle cx="10" cy="10" r="7"/></Ic>;
export const IconDot = (p: IconProps) => <Ic {...p}><circle cx="10" cy="10" r="3" fill="currentColor"/></Ic>;
export const IconSpinner = (p: IconProps) => <Ic {...p}><path d="M10 3a7 7 0 1 1-7 7" opacity={1}/></Ic>;
export const IconBolt = (p: IconProps) => <Ic {...p}><path d="M11 2.5 4.5 11H10l-1 6.5L15.5 9H10Z"/></Ic>;
export const IconGraph = (p: IconProps) => <Ic {...p}><circle cx="5" cy="6" r="2"/><circle cx="15" cy="5" r="2"/><circle cx="14" cy="15" r="2"/><circle cx="5" cy="14" r="2"/><path d="M6.5 6.8 13.5 5.5M5 8v4M13.5 6.5 13.7 13M6.5 14.5 12.3 14.9"/></Ic>;
export const IconUser = (p: IconProps) => <Ic {...p}><circle cx="10" cy="7.5" r="3"/><path d="M4 16.5c1-2.5 3.3-4 6-4s5 1.5 6 4"/></Ic>;
export const IconBuilding = (p: IconProps) => <Ic {...p}><rect x="4" y="3" width="12" height="14" rx="1"/><path d="M7 7h2M11 7h2M7 10h2M11 10h2M7 13h2M11 13h2"/></Ic>;
export const IconUsers = (p: IconProps) => <Ic {...p}><circle cx="8" cy="8" r="2.5"/><path d="M3 16c0-2.2 2.2-4 5-4s5 1.8 5 4"/><circle cx="14" cy="7" r="2"/><path d="M13 12c2.5 0 4 1.5 4 3.5"/></Ic>;
export const IconChart = (p: IconProps) => <Ic {...p}><path d="M3 16h14M6 13V9M10 13V5M14 13v-6"/></Ic>;
export const IconShield = (p: IconProps) => <Ic {...p}><path d="M10 2.5 3.5 5v5c0 3.5 2.5 6.2 6.5 7.5 4-1.3 6.5-4 6.5-7.5V5Z"/></Ic>;
export const IconPen = (p: IconProps) => <Ic {...p}><path d="m12.5 3.5 4 4L7 17l-4 1 1-4Z"/></Ic>;
export const IconNote = (p: IconProps) => <Ic {...p}><path d="M4.5 3.5h7L15.5 7v9a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5Z"/><path d="M11.5 3.5V7H15.5M7 10h6M7 13h4"/></Ic>;
export const IconTag = (p: IconProps) => <Ic {...p}><path d="M3.5 3.5h6l7 7-6 6-7-7Z"/><circle cx="6.5" cy="6.5" r="0.9" fill="currentColor" stroke="none"/></Ic>;
export const IconList = (p: IconProps) => <Ic {...p}><path d="M6 5h11M6 10h11M6 15h11"/><circle cx="3.5" cy="5" r="0.8" fill="currentColor" stroke="none"/><circle cx="3.5" cy="10" r="0.8" fill="currentColor" stroke="none"/><circle cx="3.5" cy="15" r="0.8" fill="currentColor" stroke="none"/></Ic>;
export const IconLogout = (p: IconProps) => <Ic {...p}><path d="M8 4H4v12h4M12 10H17M14 7l3 3-3 3"/></Ic>;
export const IconSun = (p: IconProps) => <Ic {...p}><circle cx="10" cy="10" r="3"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.5 4.5l1.5 1.5M14 14l1.5 1.5M15.5 4.5 14 6M6 14l-1.5 1.5"/></Ic>;
export const IconMoon = (p: IconProps) => <Ic {...p}><path d="M16 11a6 6 0 0 1-8-8 7 7 0 1 0 8 8Z"/></Ic>;
export const IconWorkflow = (p: IconProps) => <Ic {...p}><rect x="3" y="3" width="5" height="5" rx="1"/><rect x="12" y="3" width="5" height="5" rx="1"/><rect x="3" y="12" width="5" height="5" rx="1"/><rect x="12" y="12" width="5" height="5" rx="1"/><path d="M8 5.5h4M8 14.5h4M5.5 8v4M14.5 8v4"/></Ic>;
export const IconCopy = (p: IconProps) => <Ic {...p}><rect x="6" y="6" width="10" height="11" rx="1"/><path d="M12 3H5a1 1 0 0 0-1 1v9"/></Ic>;
export const IconBrain = (p: IconProps) => <Ic {...p}><path d="M7.5 4a2.5 2.5 0 0 0-2.5 2.5c-1 0-1.5 1-1.5 2s.5 2 1.5 2c0 1.5 1 2.5 2.5 2.5V4Z"/><path d="M12.5 4a2.5 2.5 0 0 1 2.5 2.5c1 0 1.5 1 1.5 2s-.5 2-1.5 2c0 1.5-1 2.5-2.5 2.5V4Z"/><path d="M10 4v9M7.5 7.5h1.5M11 7.5h1.5M7.5 10.5h1.5M11 10.5h1.5M8 13.5v2.5M12 13.5v2.5"/></Ic>;
export const IconImage = (p: IconProps) => <Ic {...p}><rect x="3" y="3.5" width="14" height="13" rx="1.5"/><circle cx="7" cy="7.5" r="1.5"/><path d="m3.5 13.5 4-3.5 3 2.5 2-1.5 4 3"/></Ic>;
export const IconMegaphone = (p: IconProps) => <Ic {...p}><path d="M4 8.5v3a1 1 0 0 0 1 1h1.5l3 3.5V5L6.5 8.5H5a1 1 0 0 0-1 1Z"/><path d="M13 6.5a5 5 0 0 1 0 7"/><path d="M16 4.5a8 8 0 0 1 0 11"/></Ic>;
