import { NETWORK_MARKS } from "~/components/icons/brand";
import { cn } from "~/lib/utils";
import styles from "~/styles/Employer/MarketingPipeline.module.css";

import type { MarketingPlatform } from "./shared";

const TILE: Record<MarketingPlatform, string | undefined> = {
    reddit: styles.platformLogoReddit,
    x: styles.platformLogoX,
    linkedin: styles.platformLogoLinkedin,
    bluesky: styles.platformLogoBluesky,
};

/**
 * A network's logo on its brand-coloured tile: the same SVG mark at the same
 * optical size for all four. It replaces a mix of a PNG (Reddit's Snoo, which
 * disappeared on the dark theme), an emoji (Bluesky's 🦋) and text glyphs
 * ("𝕏", "in"), whose different sizes made the picker look misaligned.
 */
export function PlatformLogo({
    platform,
    size = 44,
    className,
}: {
    platform: MarketingPlatform;
    size?: number;
    className?: string;
}) {
    const { Mark, fill } = NETWORK_MARKS[platform];
    return (
        <span
            aria-hidden="true"
            className={cn(styles.platformLogo, TILE[platform], className)}
            style={{ width: size, height: size }}
        >
            <Mark size={Math.round(size * fill)} />
        </span>
    );
}
