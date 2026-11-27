import { NETWORK_MARKS } from "~/components/icons/brand";
import { cn } from "~/lib/utils";
import styles from "~/styles/Employer/MarketingPipeline.module.css";

import type { MarketingPlatform, PublishPlatform } from "./shared";

/** The copy-only networks' tile colours, shared with the preview's badge. */
export const COPY_ONLY_TILE: Record<
    Exclude<MarketingPlatform, PublishPlatform>,
    string | undefined
> = {
    instagram: styles.networkTileInstagram,
    threads: styles.networkTileThreads,
    facebook: styles.networkTileFacebook,
    tiktok: styles.networkTileTiktok,
    youtube: styles.networkTileYoutube,
    mastodon: styles.networkTileMastodon,
    hackernews: styles.networkTileHackernews,
    producthunt: styles.networkTileProducthunt,
    discord: styles.networkTileDiscord,
};

const TILE: Record<MarketingPlatform, string | undefined> = {
    reddit: styles.platformLogoReddit,
    x: styles.platformLogoX,
    linkedin: styles.platformLogoLinkedin,
    bluesky: styles.platformLogoBluesky,
    ...COPY_ONLY_TILE,
};

/**
 * A network's logo on its brand-coloured tile: the same SVG mark at the same
 * optical size for every network. It replaces a mix of a PNG (Reddit's Snoo,
 * which disappeared on the dark theme), an emoji (Bluesky's 🦋) and text
 * glyphs ("𝕏", "in"), whose different sizes made the picker look misaligned.
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
