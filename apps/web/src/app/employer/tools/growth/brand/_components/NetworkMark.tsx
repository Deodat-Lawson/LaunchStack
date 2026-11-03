import { NETWORK_MARKS } from "~/components/icons/brand";
import { cn } from "~/lib/utils";

import type { BrandPlatform } from "../api";

export const NETWORK_LABEL: Record<BrandPlatform, string> = {
    linkedin: "LinkedIn",
    x: "X",
    bluesky: "Bluesky",
    reddit: "Reddit",
};

/** Hard limits the networks enforce; the Accounts endpoint is the source of truth, these cover the first paint. */
export const NETWORK_LIMIT: Record<BrandPlatform, number | null> = {
    linkedin: 3000,
    x: 280,
    bluesky: 300,
    reddit: 40000,
};

/**
 * A network's mark on a rounded square, in the ink ladder rather than each
 * brand's colour: the calendar has to read as one system, and the word
 * beside it carries the identification. Glyphs replace the old text
 * monograms ("in", "X", "bs", "r/"), whose one- and two-letter widths made
 * the tiles look misaligned and differently sized.
 */
export function NetworkMark({
    platform,
    size = 20,
    muted = false,
    className,
}: {
    platform: BrandPlatform;
    size?: number;
    muted?: boolean;
    className?: string;
}) {
    const { Mark, fill } = NETWORK_MARKS[platform];
    return (
        <span
            role="img"
            aria-label={NETWORK_LABEL[platform]}
            title={NETWORK_LABEL[platform]}
            className={cn(
                "inline-flex shrink-0 items-center justify-center rounded-[27%] select-none",
                // Muted tiles get a hairline so a "not set up" network still reads as a tile.
                muted ? "border-line bg-panel-2 text-ink-3 border" : "bg-ink text-surface",
                className
            )}
            style={{ width: size, height: size }}
        >
            <Mark size={Math.round(size * fill)} />
        </span>
    );
}
