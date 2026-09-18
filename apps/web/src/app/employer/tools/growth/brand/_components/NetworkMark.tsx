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

const MONOGRAM: Record<BrandPlatform, string> = {
    linkedin: "in",
    x: "X",
    bluesky: "bs",
    reddit: "r/",
};

/**
 * A network as a two-letter monogram on a rounded square, in the ink ladder
 * rather than each brand's colour: the calendar has to read as one system,
 * and the word beside it carries the identification.
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
    return (
        <span
            aria-label={NETWORK_LABEL[platform]}
            title={NETWORK_LABEL[platform]}
            className={cn(
                "inline-flex shrink-0 select-none items-center justify-center rounded-[27%] font-mono font-medium leading-none",
                muted ? "bg-panel-2 text-ink-3" : "bg-ink text-surface",
                className
            )}
            style={{ width: size, height: size, fontSize: Math.round(size * 0.46) }}
        >
            {MONOGRAM[platform]}
        </span>
    );
}
