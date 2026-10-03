import {
    BRAND_PLATFORMS,
    type BrandChannel,
    type BrandChannelCapabilities,
    type BrandChannelKind,
    type BrandConnection,
    type BrandPlatform,
} from "../api";

/**
 * Channels, in the words the screens use. Pure functions over the contract's
 * types so the rules (what Compose offers and starts with, how a token's
 * life is said) are tested on their own.
 */

/** The kind word beside a channel's name. */
export const KIND_WORD: Record<BrandChannelKind, string> = {
    organization: "Page",
    person: "Profile",
    account: "Account",
    deployment: "Deployment account",
};

/** Order inside a network: Pages first (what a company posts as), then people, then the rest. */
const KIND_ORDER: Record<BrandChannelKind, number> = {
    organization: 0,
    person: 1,
    account: 2,
    deployment: 3,
};

/** Up to two letters for an avatar fallback: "Dana Okafor" → "DO", "launchstack.bsky.social" → "L". */
export function initials(name: string): string {
    const words = name
        .replace(/^@/, "")
        .split(/\s+/)
        .map(w => w.replace(/[^\p{L}\p{N}]/gu, ""))
        .filter(Boolean);
    if (words.length === 0) return "?";
    const first = words[0]!.charAt(0);
    const last = words.length > 1 ? words[words.length - 1]!.charAt(0) : "";
    return (first + last).toUpperCase();
}

/** "Images · Analytics · Comments", minus what the channel cannot do. Publishing is assumed. */
export function capabilityWords(capabilities: BrandChannelCapabilities): string[] {
    const out: string[] = [];
    if (!capabilities.publish) out.push("Cannot publish");
    if (capabilities.images) out.push("Images");
    if (capabilities.analytics) out.push("Analytics");
    if (capabilities.comments) out.push("Comments");
    return out;
}

export interface NetworkGroup<T> {
    platform: BrandPlatform;
    items: T[];
}

/** Pages first, then profiles, accounts and deployment accounts; by name inside a kind. */
export function byKindThenName(
    a: Pick<BrandChannel, "kind" | "name">,
    b: Pick<BrandChannel, "kind" | "name">
): number {
    const k = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    return k !== 0 ? k : a.name.localeCompare(b.name);
}

/**
 * Items grouped by network in the product's network order (LinkedIn, X,
 * Bluesky, Reddit), empty networks left out, each group sorted by `order`
 * when given and otherwise kept as it came.
 */
export function groupByNetwork<T extends { platform: BrandPlatform }>(
    items: T[],
    order?: (a: T, b: T) => number
): NetworkGroup<T>[] {
    const groups: NetworkGroup<T>[] = [];
    for (const platform of BRAND_PLATFORMS) {
        const mine = items.filter(i => i.platform === platform);
        if (mine.length === 0) continue;
        if (order) mine.sort(order);
        groups.push({ platform, items: mine });
    }
    return groups;
}

/** A channel a post can go out on right now. */
export function isPostable(channel: BrandChannel): boolean {
    return channel.enabled && channel.status === "active" && channel.capabilities.publish;
}

/** What Compose lists: every channel an admin left on, postable or not (those show why not). */
export function composeChannels(channels: BrandChannel[]): BrandChannel[] {
    return channels.filter(c => c.enabled);
}

/**
 * Where a new post starts. A campaign hands over one network: its postable
 * channels. Otherwise the company's Pages when there are any — a company
 * posts as itself — else every postable channel.
 */
export function defaultChannelSelection(
    channels: BrandChannel[],
    platform?: BrandPlatform | null
): string[] {
    const ready = channels.filter(isPostable);
    if (platform) return ready.filter(c => c.platform === platform).map(c => c.id);
    const pages = ready.filter(c => c.kind === "organization");
    return (pages.length > 0 ? pages : ready).map(c => c.id);
}

/** Why a channel cannot be picked in Compose, or null when it can. */
export function unavailableReason(channel: BrandChannel): string | null {
    if (channel.status === "reconnect")
        return channel.statusReason ?? "The network refused the sign-in; reconnect it in Accounts.";
    if (!channel.capabilities.publish) return "This channel cannot publish.";
    return null;
}

export type Tone = "ok" | "warn" | "danger";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Under this many days left, a token that does not renew itself is a warning. */
export const EXPIRY_WARN_DAYS = 14;

function count(n: number, one: string): string {
    return `${n} ${n === 1 ? one : `${one}s`}`;
}

/**
 * A connection's token life in words: "Renews itself" when LinkedIn gave a
 * refresh token, "Expires in 23 days" otherwise — a warning under two weeks,
 * danger once it has run out.
 */
export function tokenExpiry(
    connection: Pick<BrandConnection, "expiresAt" | "refreshable">,
    now = Date.now()
): { word: string; tone: Tone } {
    if (connection.refreshable) return { word: "Renews itself", tone: "ok" };
    if (!connection.expiresAt) return { word: "Does not expire", tone: "ok" };
    const ms = new Date(connection.expiresAt).getTime() - now;
    if (Number.isNaN(ms)) return { word: "Does not expire", tone: "ok" };
    if (ms <= 0) {
        const days = Math.floor(-ms / DAY);
        return {
            word: days < 1 ? "Expired today" : `Expired ${count(days, "day")} ago`,
            tone: "danger",
        };
    }
    const days = Math.round(ms / DAY);
    if (days < 1) {
        const hours = Math.max(1, Math.round(ms / HOUR));
        return { word: `Expires in ${count(hours, "hour")}`, tone: "warn" };
    }
    return {
        word: `Expires in ${count(days, "day")}`,
        tone: days < EXPIRY_WARN_DAYS ? "warn" : "ok",
    };
}
