import type { ReactElement, ReactNode } from "react";
import Image from "next/image";

import type { IconProps } from "./types";

/**
 * Third-party brand marks (lucide-react deprecated its brand glyphs).
 * Everything else comes straight from lucide-react — do not add
 * general-purpose icons here. Drawn at roughly lucide's stroke weight so the
 * two sets sit together.
 */
export type BrandIconProps = IconProps;

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

/** Obsidian: the faceted crystal, outline and one fold. */
export const IconObsidian = (p: BrandIconProps) => (
    <Ic {...p}>
        <path d="M11 2.5 15.5 7 14 15l-5 2.5-3.5-4L7 5.5Z" />
        <path d="M11 2.5 9.5 9.5 9 17.5M9.5 9.5 14 15" />
    </Ic>
);

export const IconDrive = (p: BrandIconProps) => (
    <Ic {...p}>
        <path d="m7 3 6 0 5 9-3 5-6 0L4 8Z" />
        <path d="M7 3 4 8l5 9M13 3l5 9h-8" />
    </Ic>
);

/**
 * Google Drive's own full-colour mark, where a control stands for Drive
 * itself rather than sitting in a row of glyphs. A file, not an inline SVG:
 * the colours are Google's, not tokens, and stay the same in both themes.
 */
export const GoogleDriveLogo = ({ size = 16, style, className }: BrandIconProps) => (
    <Image
        src="/images/google-drive.svg"
        alt=""
        width={size}
        height={size}
        style={style}
        className={className}
    />
);

/** Google Docs: the Drive page glyph with ruled lines. */
export const IconGoogleDocs = (p: BrandIconProps) => (
    <Ic {...p}>
        <path d="M5 2.5h6l4 4v11H5Z" />
        <path d="M11 2.5v4h4" />
        <path d="M7.5 10.5h5M7.5 13h5" />
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

/** Google's "G": an open ring closed by its crossbar. */
export const IconGoogle = (p: BrandIconProps) => (
    <Ic {...p}>
        <path d="M14.95 5.05A7 7 0 1 0 17 10h-7" />
    </Ic>
);

export const IconDropbox = (p: BrandIconProps) => (
    <Ic {...p}>
        <path d="m5 4 5 3-5 3-3.5-3Zm10 0 3.5 3L15 10l-5-3Zm-10 9 5 3 5-3-5-3ZM5 10l5 3" />
    </Ic>
);

// ─── Social networks (Growth › Brand) ───────────────────────────────────────

interface GlyphProps extends BrandIconProps {
    children: ReactNode;
}

/**
 * A filled network logo on a 24-unit box, centred, in currentColor. The
 * paths are the networks' own marks (Simple Icons, CC0), drawn solid so they
 * read at 14px, where a stroked outline turns to mush.
 */
const Glyph = ({ children, size = 16, style, className }: GlyphProps) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        style={style}
        className={className}
    >
        {children}
    </svg>
);

export const LinkedInMark = (p: BrandIconProps) => (
    <Glyph {...p}>
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125zM7.119 20.452H3.555V9h3.564v11.452z" />
    </Glyph>
);

export const XMark = (p: BrandIconProps) => (
    <Glyph {...p}>
        <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
    </Glyph>
);

export const BlueskyMark = (p: BrandIconProps) => (
    <Glyph {...p}>
        <path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364.136-.02.275-.039.415-.056-.138.022-.276.04-.415.056-3.912.58-7.387 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078a8.741 8.741 0 0 1-.415-.056c.14.017.279.036.415.056 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.206-.659-.298-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8Z" />
    </Glyph>
);

export const RedditMark = (p: BrandIconProps) => (
    <Glyph {...p}>
        <path d="M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286C.775 23.225 1.097 24 1.738 24H12c6.627 0 12-5.373 12-12S18.627 0 12 0Zm4.388 3.199c1.104 0 1.999.895 1.999 1.999 0 1.105-.895 2-1.999 2-.946 0-1.739-.657-1.947-1.539v.002c-1.147.162-2.032 1.15-2.032 2.341v.007c1.776.067 3.4.567 4.686 1.363.473-.363 1.064-.58 1.707-.58 1.547 0 2.802 1.254 2.802 2.802 0 1.117-.655 2.081-1.601 2.531-.088 3.256-3.637 5.876-7.997 5.876-4.361 0-7.905-2.617-7.998-5.87-.954-.447-1.614-1.415-1.614-2.538 0-1.548 1.255-2.802 2.803-2.802.645 0 1.239.218 1.712.585 1.275-.79 2.881-1.291 4.64-1.365v-.01c0-1.663 1.263-3.034 2.88-3.207.188-.911.993-1.595 1.959-1.595Zm-8.085 8.376c-.784 0-1.459.78-1.506 1.797-.047 1.016.64 1.429 1.426 1.429.786 0 1.371-.369 1.418-1.385.047-1.017-.553-1.841-1.338-1.841Zm7.406 0c-.786 0-1.385.824-1.338 1.841.047 1.017.634 1.385 1.418 1.385.785 0 1.473-.413 1.426-1.429-.046-1.017-.721-1.797-1.506-1.797Zm-3.703 4.013c-.974 0-1.907.048-2.77.135-.147.015-.241.168-.183.305.483 1.154 1.622 1.964 2.953 1.964 1.33 0 2.47-.81 2.953-1.964.057-.137-.037-.29-.184-.305-.863-.087-1.795-.135-2.769-.135Z" />
    </Glyph>
);

/**
 * Each network's mark and how much of a square tile it should fill. The
 * glyphs carry different optical weight — X is a dense diagonal, Reddit a
 * full disc, LinkedIn's letters sit inside an implied square — so one shared
 * ratio makes them look like different sizes. Every tile that shows a
 * network (Brand's NetworkMark, the generator's platform picker) uses these.
 */
export const NETWORK_MARKS: Record<
    "linkedin" | "x" | "bluesky" | "reddit",
    { Mark: (p: BrandIconProps) => ReactElement; fill: number }
> = {
    linkedin: { Mark: LinkedInMark, fill: 0.56 },
    x: { Mark: XMark, fill: 0.5 },
    bluesky: { Mark: BlueskyMark, fill: 0.58 },
    reddit: { Mark: RedditMark, fill: 0.64 },
};
