import type { CSSProperties, ReactNode } from "react";

/**
 * Third-party brand marks (lucide-react deprecated its brand glyphs).
 * Everything else comes straight from lucide-react — do not add
 * general-purpose icons here.
 */
export interface BrandIconProps {
    size?: number;
    style?: CSSProperties;
    className?: string;
}

interface IcProps extends BrandIconProps {
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

export const IconYoutube = (p: BrandIconProps) => (
    <Ic {...p}>
        <rect x="2" y="5" width="16" height="10" rx="2.5" />
        <path d="m8.5 8 4 2-4 2z" fill="currentColor" />
    </Ic>
);

export const IconGmail = (p: BrandIconProps) => (
    <Ic {...p}>
        <rect x="2.5" y="5" width="15" height="10" rx="1.5" />
        <path d="m2.5 6 7.5 5.5L17.5 6" />
    </Ic>
);

export const IconNotion = (p: BrandIconProps) => (
    <Ic {...p}>
        <rect x="3.5" y="3.5" width="13" height="13" rx="1.5" />
        <path d="M7 6v8M7 6l6 8M13 6v8" />
    </Ic>
);

export const IconDrive = (p: BrandIconProps) => (
    <Ic {...p}>
        <path d="m7 3 6 0 5 9-3 5-6 0L4 8Z" />
        <path d="M7 3 4 8l5 9M13 3l5 9h-8" />
    </Ic>
);

export const IconSlack = (p: BrandIconProps) => (
    <Ic {...p}>
        <rect x="8" y="3" width="3" height="7" rx="1.5" />
        <rect x="10" y="10" width="7" height="3" rx="1.5" />
        <rect x="9" y="10" width="3" height="7" rx="1.5" />
        <rect x="3" y="7" width="7" height="3" rx="1.5" />
    </Ic>
);

export const IconGithub = (p: BrandIconProps) => (
    <Ic {...p}>
        <path d="M10 2.5a7.5 7.5 0 0 0-2.4 14.6c.4.1.5-.2.5-.4v-1.4c-2.1.4-2.5-1-2.5-1-.3-.8-.8-1.1-.8-1.1-.6-.4.05-.4.05-.4.7 0 1.1.7 1.1.7.6 1.1 1.7.8 2.1.6.1-.5.3-.8.5-1-1.7-.2-3.5-.9-3.5-3.8 0-.8.3-1.5.8-2-.1-.2-.3-1 .1-2 0 0 .6-.2 2.1.8a7 7 0 0 1 3.8 0c1.5-1 2.1-.8 2.1-.8.4 1 .2 1.8.1 2 .5.5.8 1.2.8 2 0 2.9-1.8 3.5-3.5 3.7.3.3.5.7.5 1.4v2.1c0 .2.1.5.5.4A7.5 7.5 0 0 0 10 2.5Z" />
    </Ic>
);

export const IconDropbox = (p: BrandIconProps) => (
    <Ic {...p}>
        <path d="m5 4 5 3-5 3-3.5-3Zm10 0 3.5 3L15 10l-5-3Zm-10 9 5 3 5-3-5-3ZM5 10l5 3" />
    </Ic>
);
