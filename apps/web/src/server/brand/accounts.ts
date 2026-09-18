/**
 * The Accounts screen's view of each network: whether this deployment can
 * publish there, under which identity when the credential says, the hard
 * limit Compose enforces, and what connecting takes. Presence only; the
 * credential itself never leaves the publish tool's config module.
 */
import {
    MarketingPlatformEnum,
    PLATFORM_PROFILES,
    type MarketingPlatform,
} from "@launchstack/tools/platform-profiles";
import { describePublishConfig } from "@launchstack/tools/social-publish";

export interface BrandAccount {
    platform: MarketingPlatform;
    label: string;
    configured: boolean;
    identity: string | null;
    /** Hard character limit Compose enforces; null when the network has none that matters. */
    limit: number | null;
    /** What connecting takes, in order. */
    requires: string[];
    /** One line on cost and access. */
    note: string;
}

const META: Record<MarketingPlatform, Pick<BrandAccount, "label" | "requires" | "note">> = {
    linkedin: {
        label: "LinkedIn",
        requires: [
            "A LinkedIn developer app owned by the company",
            "Community Management API access (registered entity; the page's super admin verifies the app)",
            "An access token in LINKEDIN_ACCESS_TOKEN",
        ],
        note: "Free to post. Access is reviewed by LinkedIn: a development tier first, the standard tier after a screencast review.",
    },
    x: {
        label: "X",
        requires: ["An X developer account on pay-per-use", "A bearer token in TWITTER_BEARER_TOKEN"],
        note: "Pay per post: about $0.015 each, $0.20 when the post carries a link. No free tier for new developers.",
    },
    bluesky: {
        label: "Bluesky",
        requires: ["The account's handle in BLUESKY_HANDLE", "An app password in BLUESKY_APP_PASSWORD"],
        note: "Free, no review. Reading back is free too.",
    },
    reddit: {
        label: "Reddit",
        requires: [
            "A Reddit script app (client id and secret)",
            "REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET and REDDIT_USER_AGENT",
        ],
        note: "Free for this volume. Posts go to the account's own profile; each subreddit has its own rules.",
    },
};

export function listBrandAccounts(): BrandAccount[] {
    const config = describePublishConfig();
    return MarketingPlatformEnum.options.map(platform => ({
        platform,
        label: META[platform].label,
        configured: config[platform].configured,
        identity: config[platform].identity,
        limit: PLATFORM_PROFILES[platform].hardCharLimit,
        requires: META[platform].requires,
        note: META[platform].note,
    }));
}
