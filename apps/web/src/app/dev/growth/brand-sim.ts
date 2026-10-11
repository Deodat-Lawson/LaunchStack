/**
 * In-memory `/api/brand/*` for the preview harness, answering every call in
 * `brandApi` with the contract's shapes: a workspace that signed in to
 * LinkedIn as Dana Okafor (two Pages and her profile) and to Bluesky with an
 * app password; a week of posts in every state, some with images and
 * numbers; comments to answer; insights computed from the posts. Publishing
 * to an active channel succeeds with a made-up URL; to one that needs
 * reconnecting it fails the way the real adapter would.
 *
 * Options come from the harness URL (see GrowthPreview): `?member=1` reads
 * as a non-admin, `?reconnect=1` has Bluesky refuse its app password,
 * `?empty=1` starts with nothing connected, `?nosync=1` with no numbers.
 */
import type {
    BrandAccounts,
    BrandChannel,
    BrandComment,
    BrandConnection,
    BrandInsights,
    BrandMedia,
    BrandNetwork,
    BrandPlatform,
    BrandPost,
    BrandPostMetrics,
    BrandPostSource,
    BrandPostStatus,
    InsightsChannel,
    SyncResult,
} from "~/app/employer/tools/growth/brand/api";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface BrandSimOptions {
    canManage: boolean;
    canPublish: boolean;
    reconnect: boolean;
    empty: boolean;
    nosync: boolean;
}

const DEFAULT_OPTIONS: BrandSimOptions = {
    canManage: true,
    canPublish: true,
    reconnect: false,
    empty: false,
    nosync: false,
};

// ── Pictures ──────────────────────────────────────────────────────────────
// Made-up images as SVG data URLs: logos, a portrait, and "photos" for
// posts. Shapes only — no text, so no font is named anywhere.

function svg(width: number, height: number, body: string): string {
    const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

/** The LaunchStack logo: three stacked bars on a deep square. */
const LOGO = svg(
    96,
    96,
    `<rect width="96" height="96" fill="oklch(0.32 0.09 285)"/>` +
        `<rect x="22" y="58" width="52" height="10" rx="5" fill="oklch(0.86 0.08 285)"/>` +
        `<rect x="28" y="43" width="40" height="10" rx="5" fill="oklch(0.74 0.14 285)"/>` +
        `<rect x="34" y="28" width="28" height="10" rx="5" fill="oklch(0.95 0.03 285)"/>`
);

/** Dana's photo: a head and shoulders on a warm ground. */
const PORTRAIT = svg(
    96,
    96,
    `<rect width="96" height="96" fill="oklch(0.83 0.06 60)"/>` +
        `<circle cx="48" cy="38" r="17" fill="oklch(0.42 0.06 45)"/>` +
        `<path d="M14 96c4-22 18-32 34-32s30 10 34 32z" fill="oklch(0.36 0.05 250)"/>`
);

/** The Bluesky account's avatar: the same mark, lighter. */
const LOGO_LIGHT = svg(
    96,
    96,
    `<rect width="96" height="96" fill="oklch(0.94 0.03 285)"/>` +
        `<rect x="22" y="58" width="52" height="10" rx="5" fill="oklch(0.38 0.1 285)"/>` +
        `<rect x="28" y="43" width="40" height="10" rx="5" fill="oklch(0.55 0.15 285)"/>` +
        `<rect x="34" y="28" width="28" height="10" rx="5" fill="oklch(0.3 0.08 285)"/>`
);

/** A landscape-ish "photo" for a post, varied by hue. */
function photo(hue: number, variant = 0): string {
    const sun =
        variant % 2 === 0
            ? `<circle cx="420" cy="110" r="46" fill="oklch(0.93 0.09 ${hue + 60})"/>`
            : "";
    return svg(
        640,
        400,
        `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
            `<stop offset="0" stop-color="oklch(0.78 0.08 ${hue})"/>` +
            `<stop offset="1" stop-color="oklch(0.52 0.1 ${hue + 20})"/></linearGradient></defs>` +
            `<rect width="640" height="400" fill="url(#g)"/>${sun}` +
            `<path d="M0 300 L160 190 L280 270 L420 160 L640 300 L640 400 L0 400z" fill="oklch(0.38 0.07 ${hue + 40})"/>` +
            `<path d="M0 340 L200 260 L360 330 L520 250 L640 320 L640 400 L0 400z" fill="oklch(0.28 0.05 ${hue + 50})"/>`
    );
}

/** A product "screenshot": panels and lines. */
function screenshot(hue: number): string {
    return svg(
        640,
        400,
        `<rect width="640" height="400" fill="oklch(0.97 0.01 ${hue})"/>` +
            `<rect x="0" y="0" width="150" height="400" fill="oklch(0.92 0.02 ${hue})"/>` +
            `<rect x="20" y="28" width="96" height="12" rx="6" fill="oklch(0.55 0.15 ${hue})"/>` +
            [70, 100, 130, 160]
                .map(
                    y =>
                        `<rect x="20" y="${y}" width="${80 + (y % 3) * 10}" height="9" rx="4.5" fill="oklch(0.8 0.02 ${hue})"/>`
                )
                .join("") +
            `<rect x="182" y="32" width="260" height="18" rx="9" fill="oklch(0.3 0.03 ${hue})"/>` +
            `<rect x="182" y="78" width="420" height="120" rx="12" fill="oklch(1 0 0)" stroke="oklch(0.88 0.02 ${hue})"/>` +
            `<rect x="182" y="220" width="200" height="140" rx="12" fill="oklch(1 0 0)" stroke="oklch(0.88 0.02 ${hue})"/>` +
            `<rect x="402" y="220" width="200" height="140" rx="12" fill="oklch(0.55 0.15 ${hue})"/>`
    );
}

// ── Seed ──────────────────────────────────────────────────────────────────

const LINKEDIN_SCOPES = [
    "openid",
    "profile",
    "email",
    "w_member_social",
    "r_organization_social",
    "w_organization_social",
    "rw_organization_admin",
];

function networks(): BrandNetwork[] {
    return [
        {
            platform: "linkedin",
            label: "LinkedIn",
            connect: "oauth",
            available: true,
            pages: true,
            setup: [],
            note: "Free to post. Pages come through LinkedIn's Community Management API, which LinkedIn reviews once per app.",
            limit: 3000,
        },
        {
            platform: "x",
            label: "X",
            connect: "deployment",
            available: false,
            pages: false,
            setup: [
                "An X developer account on pay-per-use",
                "A token in TWITTER_BEARER_TOKEN, shared by every workspace",
            ],
            note: "Pay per post: about $0.015 each, $0.20 when the post carries a link. No free tier for new developers.",
            limit: 280,
        },
        {
            platform: "bluesky",
            label: "Bluesky",
            connect: "app-password",
            available: true,
            pages: false,
            setup: [],
            note: "Free, no review. Each workspace signs in with its own app password.",
            limit: 300,
        },
        {
            platform: "reddit",
            label: "Reddit",
            connect: "deployment",
            available: false,
            pages: false,
            setup: [
                "A Reddit script app (client id and secret)",
                "REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET and REDDIT_USER_AGENT, shared by every workspace",
            ],
            note: "Free at this volume. Posts go to the account's own profile; each subreddit has its own rules.",
            limit: 40000,
        },
    ];
}

const ALL_CAPS = { publish: true, images: true, analytics: true, comments: true };

function linkedInConnection(now: number): BrandConnection {
    return {
        id: 1,
        platform: "linkedin",
        accountName: "Dana Okafor",
        status: "active",
        error: null,
        connectedAt: new Date(now - 24 * DAY).toISOString(),
        connectedBy: "Dana Okafor",
        expiresAt: new Date(now + 41 * DAY + 2 * HOUR).toISOString(),
        refreshable: true,
        scopes: LINKEDIN_SCOPES,
    };
}

function linkedInChannels(): BrandChannel[] {
    return [
        {
            id: "ch-li-launchstack",
            platform: "linkedin",
            kind: "organization",
            name: "LaunchStack",
            handle: "launchstack",
            avatarUrl: LOGO,
            profileUrl: "https://www.linkedin.com/company/launchstack",
            enabled: true,
            status: "active",
            statusReason: null,
            connectionId: 1,
            capabilities: { ...ALL_CAPS },
            followers: 1284,
            limit: 3000,
        },
        {
            id: "ch-li-labs",
            platform: "linkedin",
            kind: "organization",
            name: "LaunchStack Labs",
            handle: "launchstack-labs",
            avatarUrl: null,
            profileUrl: "https://www.linkedin.com/company/launchstack-labs",
            enabled: false,
            status: "active",
            statusReason: null,
            connectionId: 1,
            // Dana is a content administrator here: she can post, not read numbers.
            capabilities: { publish: true, images: true, analytics: false, comments: true },
            followers: 312,
            limit: 3000,
        },
        {
            id: "ch-li-dana",
            platform: "linkedin",
            kind: "person",
            name: "Dana Okafor",
            handle: "dana-okafor",
            avatarUrl: PORTRAIT,
            profileUrl: "https://www.linkedin.com/in/dana-okafor",
            enabled: true,
            status: "active",
            statusReason: null,
            connectionId: 1,
            capabilities: { publish: true, images: true, analytics: false, comments: false },
            followers: null,
            limit: 3000,
        },
    ];
}

function blueskyConnection(now: number, handle = "launchstack.bsky.social"): BrandConnection {
    return {
        id: 2,
        platform: "bluesky",
        accountName: handle,
        status: "active",
        error: null,
        connectedAt: new Date(now - 9 * DAY).toISOString(),
        connectedBy: "Rui Tanaka",
        expiresAt: null,
        refreshable: false,
        scopes: [],
    };
}

function blueskyChannel(handle = "launchstack.bsky.social", connectionId = 2): BrandChannel {
    return {
        id: `ch-bsky-${handle}`,
        platform: "bluesky",
        kind: "account",
        name: handle,
        handle,
        avatarUrl: handle === "launchstack.bsky.social" ? LOGO_LIGHT : null,
        profileUrl: `https://bsky.app/profile/${handle}`,
        enabled: true,
        status: "active",
        statusReason: null,
        connectionId,
        capabilities: { ...ALL_CAPS },
        followers: handle === "launchstack.bsky.social" ? 418 : 0,
        limit: 300,
    };
}

function at(now: number, days: number, hour: number, minute = 0): string {
    const d = new Date(now + days * DAY);
    d.setHours(hour, minute, 0, 0);
    return d.toISOString();
}

function metrics(
    impressions: number | null,
    reactions: number,
    comments: number,
    shares: number,
    clicks: number | null
): BrandPostMetrics {
    const engagement =
        impressions && impressions > 0
            ? (reactions + comments + shares + (clicks ?? 0)) / impressions
            : null;
    return { impressions, reactions, comments, shares, clicks, engagement };
}

interface Store {
    options: BrandSimOptions;
    networks: BrandNetwork[];
    connections: BrandConnection[];
    channels: BrandChannel[];
    posts: BrandPost[];
    comments: BrandComment[];
    media: Map<string, BrandMedia>;
    syncedAt: string | null;
    syncs: number;
    refreshes: number;
    seq: number;
    startedAt: number;
}

function snapshot(channel: BrandChannel): BrandPost["channel"] {
    return {
        id: channel.id,
        name: channel.name,
        kind: channel.kind,
        avatarUrl: channel.avatarUrl,
    };
}

function mediaItem(id: string, url: string, name: string, alt: string | null): BrandMedia {
    return { id, url, mimeType: "image/svg+xml", name, size: 48_000, alt };
}

function seedPosts(now: number, channels: BrandChannel[], nosync: boolean): BrandPost[] {
    const byId = new Map(channels.map(c => [c.id, c]));
    const post = (
        id: string,
        channelId: string | null,
        platform: BrandPlatform,
        body: string,
        status: BrandPostStatus,
        extra: Partial<BrandPost> = {}
    ): BrandPost => {
        const channel = channelId ? byId.get(channelId) : undefined;
        const out: BrandPost = {
            id,
            platform,
            channelId: channel ? channel.id : null,
            channel: channel ? snapshot(channel) : null,
            body,
            title: null,
            status,
            scheduledAt: null,
            publishedAt: null,
            postId: null,
            postUrl: null,
            error: null,
            source: { kind: "compose" },
            media: [],
            metrics: null,
            metricsAt: null,
            createdAt: new Date(now - 6 * DAY).toISOString(),
            ...extra,
        };
        if (status === "published") {
            out.publishedAt = out.publishedAt ?? out.scheduledAt;
            out.postId = `urn:li:share:${7_200_000 + Number(id.replace(/\D/g, "") || 0)}`;
            out.postUrl =
                platform === "bluesky"
                    ? `https://bsky.app/profile/launchstack.bsky.social/post/3k${id}`
                    : `https://www.linkedin.com/feed/update/${out.postId}`;
            if (nosync) {
                out.metrics = null;
                out.metricsAt = null;
            } else if (out.metrics) {
                out.metricsAt = new Date(now - 5 * MINUTE).toISOString();
            }
        }
        return out;
    };
    const page = "ch-li-launchstack";
    const dana = "ch-li-dana";
    const bsky = "ch-bsky-launchstack.bsky.social";
    if (channels.length === 0) return [];
    return [
        // Older posts: what the 30- and 90-day windows read.
        post(
            "p-71",
            page,
            "linkedin",
            "We open-sourced the chunker behind LaunchStack's search. It keeps a document's headings with every passage, so an answer can cite the section it came from.",
            "published",
            {
                scheduledAt: at(now, -71, 9),
                metrics: metrics(3410, 118, 14, 21, 162),
            }
        ),
        post(
            "p-44",
            page,
            "linkedin",
            "Three things we learned putting a company's documents behind one search box: permissions are the product, freshness beats recall, and every answer needs a source.",
            "published",
            {
                scheduledAt: at(now, -44, 10, 30),
                media: [
                    mediaItem(
                        "m-44",
                        screenshot(285),
                        "search.svg",
                        "The search box answering with three cited sources"
                    ),
                ],
                metrics: metrics(2875, 97, 11, 9, 140),
            }
        ),
        post(
            "p-19",
            bsky,
            "bluesky",
            "Shipped: Google Drive folders now sync into LaunchStack with their sharing intact.",
            "published",
            {
                scheduledAt: at(now, -19, 16),
                metrics: metrics(null, 41, 6, 12, null),
            }
        ),
        post(
            "p-12",
            page,
            "linkedin",
            "Meet the team: Rui runs our infrastructure from Lisbon and has opinions about Postgres indexes. Ask him about partial indexes at your own risk.",
            "published",
            {
                scheduledAt: at(now, -12, 12),
                media: [
                    mediaItem("m-12", photo(40, 0), "lisbon.svg", "Rooftops in Lisbon at dusk"),
                ],
                metrics: metrics(1960, 88, 12, 4, 37),
            }
        ),
        // This week.
        post(
            "p-1",
            page,
            "linkedin",
            "Your company already wrote down how it works. It is just spread across Drive, Notion and a hundred Slack threads.\n\nLaunchStack reads all of it, keeps who-can-see-what intact, and answers with the paragraph it came from. This week we opened it to every team on the waitlist — here is what the first forty companies asked it first, and what surprised us about the answers.",
            "published",
            {
                scheduledAt: at(now, -4, 9),
                media: [
                    mediaItem(
                        "m-1",
                        screenshot(285),
                        "answer.svg",
                        "An answer with its sources listed under it"
                    ),
                ],
                metrics: metrics(2140, 64, 9, 7, 88),
            }
        ),
        post(
            "p-2",
            dana,
            "linkedin",
            "A year ago I wanted one place to ask how our company does things. Today we opened LaunchStack to everyone on the waitlist. Thank you to the forty teams who told us what was wrong with it, kindly and often.",
            "published",
            { scheduledAt: at(now, -3, 8, 30) }
        ),
        post(
            "p-3",
            bsky,
            "bluesky",
            "LaunchStack is open to everyone on the waitlist. Ask your company's documents a question; get the paragraph that answers it.",
            "published",
            {
                scheduledAt: at(now, -2, 17),
                metrics: metrics(null, 23, 4, 5, null),
            }
        ),
        post("p-x", null, "x", "LaunchStack is open to everyone on the waitlist.", "failed", {
            scheduledAt: at(now, -2, 17, 5),
            error: "X is not set up on this deployment. Ask the operator to add its keys.",
        }),
        post(
            "p-4",
            page,
            "linkedin",
            "Behind the scenes: the week we launched, in two pictures. The whiteboard on Monday, and the same whiteboard on Friday.",
            "published",
            {
                scheduledAt: at(now, -1, 12),
                media: [
                    mediaItem(
                        "m-4a",
                        photo(200, 0),
                        "monday.svg",
                        "The whiteboard on Monday, mostly empty"
                    ),
                    mediaItem(
                        "m-4b",
                        photo(150, 1),
                        "friday.svg",
                        "The whiteboard on Friday, covered"
                    ),
                ],
                metrics: metrics(980, 31, 3, 2, 41),
            }
        ),
        post(
            "p-5",
            page,
            "linkedin",
            "Webinar on Thursday: how a 40-person company replaced its wiki with search over the documents it already had.",
            "failed",
            {
                scheduledAt: at(now, -1, 15),
                media: [
                    {
                        ...mediaItem("m-5", photo(320, 0), "webinar.webp", null),
                        mimeType: "image/webp",
                    },
                ],
                error: "LinkedIn refused the image: WebP is not supported. Attach a JPEG, PNG or GIF and publish again.",
            }
        ),
        post(
            "p-6",
            page,
            "linkedin",
            "Customer story: how Northwind's support team answers policy questions in seconds instead of searching three wikis.",
            "publishing",
            { scheduledAt: new Date(now - 2 * MINUTE).toISOString() }
        ),
        post(
            "p-7",
            page,
            "linkedin",
            "Origin story: why we built LaunchStack on top of the documents a company already has, instead of asking it to write a new wiki. A longer read for the people who buy software for their teams.",
            "scheduled",
            {
                scheduledAt: at(now, 1, 9),
                source: { kind: "campaign", historyId: 12 },
                media: [
                    mediaItem("m-7", photo(260, 0), "origin.svg", "The first LaunchStack office"),
                ],
            }
        ),
        post(
            "p-8",
            bsky,
            "bluesky",
            "Origin story: why LaunchStack reads the documents you have instead of asking for a new wiki.",
            "scheduled",
            { scheduledAt: at(now, 1, 9) }
        ),
        post(
            "p-9",
            dana,
            "linkedin",
            "Hiring: a founding designer who likes dense, quiet product screens. Remote in Europe.",
            "draft",
            { createdAt: new Date(now - 3 * HOUR).toISOString() }
        ),
        post(
            "p-10",
            bsky,
            "bluesky",
            "Office hours on Friday: bring a question your documents should answer and we will try it live.",
            "cancelled",
            { scheduledAt: at(now, 2, 10) }
        ),
    ];
}

function seedComments(now: number, posts: BrandPost[]): BrandComment[] {
    const byId = new Map(posts.map(p => [p.id, p]));
    const on = (
        id: string,
        postId: string,
        authorName: string,
        authorHandle: string | null,
        text: string,
        agoMs: number,
        extra: Partial<BrandComment> = {}
    ): BrandComment | null => {
        const post = byId.get(postId);
        if (!post?.channelId) return null;
        return {
            id,
            channelId: post.channelId,
            platform: post.platform,
            postId,
            postExcerpt: excerpt(post.body),
            postUrl: post.postUrl,
            parentId: null,
            authorName,
            authorHandle,
            text,
            createdAt: new Date(now - agoMs).toISOString(),
            isOwn: false,
            handledAt: null,
            ...extra,
        };
    };
    return [
        on(
            "c-1",
            "p-1",
            "Priya Raman",
            "priya-raman",
            "This is exactly the problem we hit last quarter. Does the import keep folder permissions, or does everyone see everything?",
            3 * DAY + 5 * HOUR,
            { handledAt: new Date(now - 3 * DAY).toISOString() }
        ),
        on(
            "c-2",
            "p-1",
            "LaunchStack",
            "launchstack",
            "It keeps them: folders come over with their access lists, and an answer only cites what the asker could already open. Happy to show you.",
            3 * DAY + 2 * HOUR,
            { parentId: "c-1", isOwn: true }
        ),
        on(
            "c-3",
            "p-1",
            "Marcus Lee",
            "marcuslee",
            "Congrats on the launch! Is there a self-hosted option for teams that cannot send documents to a cloud?",
            2 * DAY + 3 * HOUR
        ),
        on(
            "c-4",
            "p-1",
            "Jordan Kim",
            "jordan-kim-ops",
            "+1 to self-hosting. We are in healthcare.",
            1 * DAY + 20 * HOUR,
            { parentId: "c-3" }
        ),
        on(
            "c-5",
            "p-4",
            "Elena Petrova",
            "elenapetrova",
            "Would love a deeper write-up on how the retrieval works. Do you re-rank, or is it straight vector search?",
            20 * HOUR
        ),
        on(
            "c-6",
            "p-4",
            "Tom Becker",
            "tbecker",
            "The pricing link on your site gives me a 404 right now.",
            5 * HOUR
        ),
        on(
            "c-7",
            "p-3",
            "Sam Ortiz",
            "samortiz.bsky.social",
            "Bookmarked. Does it work with shared drives, or only My Drive?",
            26 * HOUR
        ),
    ].filter((c): c is BrandComment => c !== null);
}

function seed(options: BrandSimOptions, now = Date.now()): Store {
    const connections: BrandConnection[] = options.empty
        ? []
        : [linkedInConnection(now), blueskyConnection(now)];
    const channels: BrandChannel[] = options.empty ? [] : [...linkedInChannels(), blueskyChannel()];
    if (options.reconnect) {
        const bsky = channels.find(c => c.platform === "bluesky");
        if (bsky) {
            bsky.status = "reconnect";
            bsky.statusReason =
                "Bluesky refused the app password. It may have been revoked in Bluesky's settings.";
        }
        const conn = connections.find(c => c.platform === "bluesky");
        if (conn) conn.error = "Bluesky refused the app password (401).";
    }
    const posts = seedPosts(now, channels, options.nosync);
    const comments = options.nosync ? [] : seedComments(now, posts);
    const media = new Map<string, BrandMedia>();
    for (const p of posts) for (const m of p.media) media.set(m.id, m);
    return {
        options,
        networks: networks(),
        connections,
        channels,
        posts,
        comments,
        media,
        syncedAt: options.nosync || options.empty ? null : new Date(now - 5 * MINUTE).toISOString(),
        syncs: 0,
        refreshes: 0,
        seq: 100,
        startedAt: now,
    };
}

let store: Store = seed(DEFAULT_OPTIONS);

/** Start over, with the harness URL's options. */
export function resetBrandSim(options: Partial<BrandSimOptions> = {}, now = Date.now()): void {
    store = seed({ ...DEFAULT_OPTIONS, ...options }, now);
}

/**
 * Apply the harness URL's options. Only a change of data shape (empty,
 * reconnect, nosync) reseeds; `member` just flips the admin bit.
 */
export function configureBrandSim(options: Partial<BrandSimOptions>): void {
    const next = { ...store.options, ...options };
    const reseed =
        next.empty !== store.options.empty ||
        next.reconnect !== store.options.reconnect ||
        next.nosync !== store.options.nosync;
    if (reseed) store = seed(next);
    else store.options = next;
}

/**
 * What the LinkedIn OAuth round trip does when it comes back: the member's
 * connection and the channels it brings, added if missing (and a revoked
 * one made good again). Returns who signed in.
 */
export function simulateLinkedInConnect(now = Date.now()): { accountName: string } {
    const existing = store.connections.find(c => c.platform === "linkedin");
    const fresh = linkedInConnection(now);
    if (existing) {
        Object.assign(existing, { ...fresh, id: existing.id, connectedAt: fresh.connectedAt });
    } else {
        store.connections.unshift({ ...fresh, connectedAt: new Date(now).toISOString() });
    }
    for (const channel of linkedInChannels()) {
        const have = store.channels.find(c => c.id === channel.id);
        if (have) Object.assign(have, { status: "active", statusReason: null });
        else store.channels.push(channel);
    }
    return { accountName: fresh.accountName ?? "LinkedIn" };
}

// ── HTTP helpers ──────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function err(status: number, error: string): Response {
    return json({ error }, status);
}

function readBody(init?: RequestInit): Record<string, unknown> {
    if (!init?.body || typeof init.body !== "string") return {};
    try {
        const parsed: unknown = JSON.parse(init.body);
        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

/** A JSON field as a string; anything else is empty. */
const str = (value: unknown): string => (typeof value === "string" ? value : "");

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function excerpt(body: string): string {
    const line = body.replace(/\s+/g, " ").trim();
    return line.length > 90 ? `${line.slice(0, 88).trimEnd()}…` : line;
}

function moment(post: BrandPost): number {
    return new Date(post.scheduledAt ?? post.publishedAt ?? post.createdAt).getTime();
}

function forbidden(): Response | null {
    return store.options.canManage
        ? null
        : err(403, "Only workspace admins can change connected accounts.");
}

function networkLabel(platform: BrandPlatform): string {
    return store.networks.find(n => n.platform === platform)?.label ?? platform;
}

function channelOf(post: BrandPost): BrandChannel | undefined {
    return post.channelId ? store.channels.find(c => c.id === post.channelId) : undefined;
}

// ── Posts ─────────────────────────────────────────────────────────────────

/** The network call, as the real adapter makes it. */
function publish(post: BrandPost, now: number): BrandPost {
    if (!["draft", "scheduled", "failed", "publishing"].includes(post.status)) return post;
    const channel = channelOf(post);
    const fail = (error: string) => {
        post.status = "failed";
        post.error = error;
        return post;
    };
    if (!post.channelId)
        return fail(`${networkLabel(post.platform)} is not set up on this deployment.`);
    if (!channel)
        return fail("This channel was disconnected. Pick another channel and publish again.");
    if (channel.status === "reconnect")
        return fail(
            `${channel.name} needs reconnecting: ${channel.statusReason ?? "the network refused the sign-in"}.`
        );
    if (channel.platform === "linkedin" && post.media.some(m => m.mimeType === "image/webp"))
        return fail(
            "LinkedIn refused the image: WebP is not supported. Attach a JPEG, PNG or GIF and publish again."
        );
    post.status = "published";
    post.publishedAt = new Date(now).toISOString();
    post.postId = `${post.platform}-${store.seq++}`;
    post.postUrl =
        post.platform === "bluesky"
            ? `https://bsky.app/profile/${channel.handle}/post/${post.postId}`
            : `https://www.linkedin.com/feed/update/urn:li:share:${post.postId}`;
    post.error = null;
    post.metrics = channel.capabilities.analytics
        ? metrics(
              post.platform === "bluesky" ? null : 0,
              0,
              0,
              0,
              post.platform === "bluesky" ? null : 0
          )
        : null;
    post.metricsAt = post.metrics ? new Date(now).toISOString() : null;
    return post;
}

function publishDue(now: number): { published: BrandPost[]; failed: BrandPost[] } {
    const out = { published: [] as BrandPost[], failed: [] as BrandPost[] };
    for (const post of store.posts) {
        const scheduledDue =
            post.status === "scheduled" &&
            post.scheduledAt !== null &&
            new Date(post.scheduledAt).getTime() <= now;
        // A post caught mid-publish when the harness loaded lands a little later.
        const landing = post.status === "publishing" && now - store.startedAt > 20_000;
        const due = scheduledDue || landing;
        if (!due) continue;
        const outcome = publish(post, now);
        (outcome.status === "published" ? out.published : out.failed).push(outcome);
    }
    return out;
}

function bodyProblem(channel: BrandChannel, body: string): string | null {
    const text = body.trim();
    if (!text) return "Write something first.";
    if (channel.limit !== null && text.length > channel.limit)
        return `${text.length} characters is over ${channel.name}'s limit of ${channel.limit}.`;
    return null;
}

function createPosts(body: Record<string, unknown>, now: number): Response {
    const ids = Array.isArray(body.channels) ? (body.channels as unknown[]).map(String) : [];
    const channels = ids
        .map(id => store.channels.find(c => c.id === id))
        .filter((c): c is BrandChannel => Boolean(c));
    if (channels.length === 0) return err(400, "Pick at least one channel.");
    if (channels.length !== ids.length)
        return err(400, "One of those channels is gone. Reload and pick again.");
    const text = typeof body.body === "string" ? body.body : "";
    for (const channel of channels) {
        const problem = bodyProblem(channel, text);
        if (problem) return err(400, problem);
    }
    const wanted = Array.isArray(body.media)
        ? (body.media as Array<{ id?: unknown; alt?: unknown }>)
        : [];
    const media: BrandMedia[] = [];
    for (const item of wanted) {
        const found = store.media.get(String(item.id));
        if (!found) return err(400, "An image is missing. Attach it again.");
        media.push({
            ...found,
            alt: typeof item.alt === "string" && item.alt.trim() ? item.alt.trim() : null,
        });
    }
    const scheduledAt =
        typeof body.scheduledAt === "string" && !body.publishNow ? body.scheduledAt : null;
    if (scheduledAt && new Date(scheduledAt).getTime() < now - MINUTE)
        return err(400, "Pick a time that is still ahead.");
    const source: BrandPostSource =
        body.source && typeof body.source === "object"
            ? (body.source as BrandPostSource)
            : { kind: "compose" };
    const created: BrandPost[] = channels.map(channel => ({
        id: `p-${store.seq++}`,
        platform: channel.platform,
        channelId: channel.id,
        channel: snapshot(channel),
        body: text.trim(),
        title:
            channel.platform === "reddit" && typeof body.title === "string" && body.title.trim()
                ? body.title.trim()
                : null,
        status: scheduledAt ? "scheduled" : "draft",
        scheduledAt,
        publishedAt: null,
        postId: null,
        postUrl: null,
        error: null,
        source,
        // A channel that cannot take images posts the text only.
        media: channel.capabilities.images ? media.map(m => ({ ...m })) : [],
        metrics: null,
        metricsAt: null,
        createdAt: new Date(now).toISOString(),
    }));
    store.posts.push(...created);
    if (body.publishNow) for (const post of created) publish(post, now);
    return json({ posts: created }, 201);
}

function patchPost(post: BrandPost, body: Record<string, unknown>): Response {
    if (post.status === "published" || post.status === "publishing")
        return err(409, "This post is already out. Publish a new one instead.");
    if (typeof body.body === "string") {
        const channel = channelOf(post);
        if (channel) {
            const problem = bodyProblem(channel, body.body);
            if (problem) return err(400, problem);
        }
        post.body = body.body.trim();
    }
    if (body.title !== undefined) post.title = typeof body.title === "string" ? body.title : null;
    if (body.scheduledAt === null) {
        post.scheduledAt = null;
        post.status = "draft";
    } else if (typeof body.scheduledAt === "string") {
        post.scheduledAt = body.scheduledAt;
        post.status = "scheduled";
    }
    if (body.status === "cancelled" || body.status === "draft" || body.status === "scheduled") {
        if (body.status === "scheduled" && !post.scheduledAt)
            return err(400, "Pick a time to schedule this post.");
        post.status = body.status;
    }
    if (post.status !== "failed") post.error = null;
    return json({ post });
}

// ── Insights and comments ─────────────────────────────────────────────────

function insights(days: number, now: number): BrandInsights {
    const from = now - days * DAY;
    const published = store.posts
        .filter(p => p.status === "published" && p.publishedAt)
        .filter(p => new Date(p.publishedAt!).getTime() >= from)
        .sort((a, b) => new Date(b.publishedAt!).getTime() - new Date(a.publishedAt!).getTime());
    const channels: InsightsChannel[] = store.channels
        .filter(c => c.capabilities.analytics)
        .map(c => {
            const mine = published.filter(p => p.channelId === c.id);
            const sum = (pick: (m: BrandPostMetrics) => number | null) =>
                mine.reduce((n, p) => n + (p.metrics ? (pick(p.metrics) ?? 0) : 0), 0);
            return {
                channelId: c.id,
                platform: c.platform,
                kind: c.kind,
                name: c.name,
                avatarUrl: c.avatarUrl,
                followers: c.followers,
                posts: mine.length,
                impressions: sum(m => m.impressions),
                reactions: sum(m => m.reactions),
                comments: sum(m => m.comments),
                shares: sum(m => m.shares),
                clicks: sum(m => m.clicks),
            };
        });
    const rates = published
        .map(p => p.metrics?.engagement ?? null)
        .filter((r): r is number => r !== null);
    const total = (pick: (c: InsightsChannel) => number) =>
        channels.reduce((n, c) => n + pick(c), 0);
    return {
        from: new Date(from).toISOString(),
        to: new Date(now).toISOString(),
        totals: {
            posts: published.length,
            impressions: total(c => c.impressions),
            reactions: total(c => c.reactions),
            comments: total(c => c.comments),
            shares: total(c => c.shares),
            clicks: total(c => c.clicks),
            engagement: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null,
        },
        channels,
        posts: published,
        syncedAt: store.syncedAt,
    };
}

/** Deterministic growth per sync, so numbers move without looking random every reload. */
function bump(post: BrandPost, round: number): void {
    const m = post.metrics;
    if (!m) return;
    const k = (post.id.length + round * 7) % 5;
    const imp = m.impressions === null ? null : m.impressions + 18 + k * 9;
    const reactions = m.reactions + 1 + (k % 3);
    const comments = m.comments + (k === 2 ? 1 : 0);
    const shares = m.shares + (k === 4 ? 1 : 0);
    const clicks = m.clicks === null ? null : m.clicks + 2 + k;
    post.metrics = metrics(imp, reactions, comments, shares, clicks);
}

function sync(now: number): SyncResult {
    store.syncs++;
    const errors: string[] = [];
    let posts = 0;
    for (const post of store.posts) {
        if (post.status !== "published") continue;
        const channel = channelOf(post);
        if (!channel?.capabilities.analytics) continue;
        if (channel.status === "reconnect") continue;
        bump(post, store.syncs);
        post.metricsAt = new Date(now).toISOString();
        posts++;
    }
    for (const channel of store.channels) {
        if (channel.status === "reconnect")
            errors.push(
                `${channel.name}: ${channel.statusReason ?? "the network refused the sign-in"}`
            );
        else if (channel.followers !== null && channel.capabilities.analytics)
            channel.followers += 2 + (store.syncs % 3);
    }
    let comments = 0;
    // The first sync finds one new comment, so the inbox has something fresh.
    if (store.syncs === 1) {
        const post = store.posts.find(p => p.id === "p-4");
        if (post?.channelId) {
            store.comments.push({
                id: `c-${store.seq++}`,
                channelId: post.channelId,
                platform: post.platform,
                postId: post.id,
                postExcerpt: excerpt(post.body),
                postUrl: post.postUrl,
                parentId: null,
                authorName: "Aisha Mensah",
                authorHandle: "aisha-mensah",
                text: "Friday's whiteboard is a work of art. Is the roadmap on it public?",
                createdAt: new Date(now - 4 * MINUTE).toISOString(),
                isOwn: false,
                handledAt: null,
            });
            comments++;
        }
    }
    store.syncedAt = new Date(now).toISOString();
    return { syncedAt: store.syncedAt, posts, comments: comments + store.comments.length, errors };
}

/**
 * `open` returns every thread that still has a comment waiting, whole, so a
 * reply is read with what it answers; `all` returns everything.
 */
function listComments(status: string | null): BrandComment[] {
    const all = [...store.comments].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    if (status !== "open") return all;
    const byId = new Map(all.map(c => [c.id, c]));
    const rootId = (c: BrandComment) => {
        let cur = c;
        while (cur.parentId && byId.has(cur.parentId)) cur = byId.get(cur.parentId)!;
        return cur.id;
    };
    const openRoots = new Set(all.filter(c => !c.isOwn && c.handledAt === null).map(rootId));
    return all.filter(c => openRoots.has(rootId(c)));
}

// ── Router ────────────────────────────────────────────────────────────────

function accounts(): BrandAccounts {
    return {
        networks: store.networks,
        connections: store.connections,
        channels: store.channels,
        canManage: store.options.canManage,
        canPublish: store.options.canPublish,
    };
}

const APP_PASSWORD = /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i;

export async function simulateBrand(
    u: URL,
    init: RequestInit | undefined,
    now: number
): Promise<Response | null> {
    const method = (init?.method ?? "GET").toUpperCase();
    const parts = u.pathname
        .replace(/^\/api\/brand\/?/, "")
        .split("/")
        .filter(Boolean);
    const [head, id, action] = parts;

    if (head === "accounts" && method === "GET") return json(accounts());

    // A Viewer reads everything and changes nothing that speaks as the company.
    const speaks =
        method !== "GET" &&
        (head === "posts" || head === "media" || head === "comments" || head === "insights");
    if (speaks && !store.options.canPublish)
        return err(403, "Your role can read Brand but not post or reply as the company.");

    if (head === "channels" && id && method === "PATCH") {
        const no = forbidden();
        if (no) return no;
        const channel = store.channels.find(c => c.id === decodeURIComponent(id));
        if (!channel) return err(404, "Channel not found");
        const body = readBody(init);
        if (typeof body.enabled === "boolean") channel.enabled = body.enabled;
        return json({ channel });
    }

    if (head === "connections") {
        const no = forbidden();
        if (no) return no;
        if (id === "bluesky" && method === "POST") {
            await wait(700);
            const body = readBody(init);
            const identifier = str(body.identifier).trim().replace(/^@/, "").toLowerCase();
            const password = str(body.appPassword).trim();
            if (!identifier) return err(400, "Enter the account's handle, like name.bsky.social.");
            if (!identifier.includes("."))
                return err(400, "A Bluesky handle has a dot in it, like name.bsky.social.");
            if (!APP_PASSWORD.test(password))
                return err(
                    400,
                    "That is not an app password. App passwords look like xxxx-xxxx-xxxx-xxxx."
                );
            let connection = store.connections.find(
                c => c.platform === "bluesky" && c.accountName === identifier
            );
            if (connection) {
                connection.status = "active";
                connection.error = null;
            } else {
                connection = {
                    ...blueskyConnection(now, identifier),
                    id: store.seq++,
                    connectedAt: new Date(now).toISOString(),
                    connectedBy: "You",
                };
                store.connections.push(connection);
            }
            let channel = store.channels.find(
                c => c.platform === "bluesky" && c.handle === identifier
            );
            if (channel) {
                channel.status = "active";
                channel.statusReason = null;
                channel.connectionId = connection.id;
            } else {
                channel = blueskyChannel(identifier, connection.id);
                store.channels.push(channel);
            }
            return json({ connection, channels: [channel] }, 201);
        }
        const connection = store.connections.find(c => String(c.id) === id);
        if (!connection) return err(404, "Connection not found");
        if (action === "refresh" && method === "POST") {
            await wait(600);
            store.refreshes++;
            if (connection.platform === "linkedin" && store.refreshes === 1) {
                // LinkedIn reports a Page Dana was made an admin of since she connected.
                store.channels.push({
                    ...linkedInChannels()[0]!,
                    id: "ch-li-careers",
                    name: "LaunchStack Careers",
                    handle: "launchstack-careers",
                    avatarUrl: null,
                    profileUrl: "https://www.linkedin.com/showcase/launchstack-careers",
                    followers: 96,
                    connectionId: connection.id,
                });
            }
            return json({ channels: store.channels.filter(c => c.connectionId === connection.id) });
        }
        if (!action && method === "DELETE") {
            store.connections = store.connections.filter(c => c.id !== connection.id);
            store.channels = store.channels.filter(c => c.connectionId !== connection.id);
            return json({ ok: true });
        }
        return err(405, "Method not allowed");
    }

    if (head === "media" && method === "POST") {
        const form = init?.body instanceof FormData ? init.body : null;
        const file = form?.get("file");
        if (!(file instanceof File)) return err(400, "No file was sent.");
        await wait(500 + Math.min(1500, file.size / 4000));
        if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(file.type))
            return err(415, "Attach a JPEG, PNG, GIF or WebP image.");
        if (file.size > 5 * 1024 * 1024) return err(413, "Images can be 5 MB at most.");
        const media: BrandMedia = {
            id: `m-${store.seq++}`,
            url: URL.createObjectURL(file),
            mimeType: file.type,
            name: file.name,
            size: file.size,
            alt: null,
        };
        store.media.set(media.id, media);
        return json({ media }, 201);
    }

    if (head === "insights") {
        if (id === "sync" && method === "POST") {
            await wait(900);
            return json(sync(now));
        }
        if (!id && method === "GET") {
            const days = Math.max(1, Math.min(365, Number(u.searchParams.get("days")) || 30));
            return json(insights(days, now));
        }
        return err(405, "Method not allowed");
    }

    if (head === "comments") {
        if (!id && method === "GET")
            return json({
                comments: listComments(u.searchParams.get("status")),
                syncedAt: store.syncedAt,
            });
        const comment = store.comments.find(c => c.id === id);
        if (!comment) return err(404, "Comment not found");
        if (action === "reply" && method === "POST") {
            await wait(500);
            const text = str(readBody(init).text).trim();
            if (!text) return err(400, "Write a reply first.");
            const channel = store.channels.find(c => c.id === comment.channelId);
            if (!channel) return err(409, "This channel was disconnected; reconnect it to reply.");
            if (!channel.capabilities.comments)
                return err(409, `${channel.name} cannot reply to comments from here.`);
            if (channel.status === "reconnect")
                return err(409, `${channel.name} needs reconnecting before it can reply.`);
            const reply: BrandComment = {
                ...comment,
                id: `c-${store.seq++}`,
                parentId: comment.id,
                authorName: channel.name,
                authorHandle: channel.handle,
                text,
                createdAt: new Date(now).toISOString(),
                isOwn: true,
                handledAt: null,
            };
            store.comments.push(reply);
            return json({ comment: reply }, 201);
        }
        if (!action && method === "PATCH") {
            const handled = readBody(init).handled;
            comment.handledAt = handled ? new Date(now).toISOString() : null;
            return json({ comment });
        }
        return err(405, "Method not allowed");
    }

    if (head !== "posts") return err(404, "Not found");

    if (!id && method === "GET") {
        publishDue(now);
        const from = u.searchParams.get("from");
        const to = u.searchParams.get("to");
        const status = u.searchParams.get("status");
        const fromMs = from ? new Date(from).getTime() : now - 14 * DAY;
        const toMs = to ? new Date(to).getTime() : now + 42 * DAY;
        const list = store.posts
            .filter(p => moment(p) >= fromMs && moment(p) < toMs)
            .filter(p => !status || p.status === status)
            .sort((a, b) => moment(a) - moment(b));
        return json({ posts: list, now: new Date(now).toISOString() });
    }

    if (!id && method === "POST") return createPosts(readBody(init), now);

    if (id === "publish-due" && method === "POST") {
        const result = publishDue(now);
        return json({ ...result, skipped: 0 });
    }

    const post = store.posts.find(p => p.id === id);
    if (!post) return err(404, "Post not found");

    if (action === "publish" && method === "POST") {
        if (!["draft", "scheduled", "failed"].includes(post.status))
            return err(
                409,
                post.status === "published"
                    ? "This post is already out."
                    : "A cancelled post has to be rescheduled before it can go out."
            );
        publish(post, now);
        return post.status === "published"
            ? json({ post })
            : json({ post, error: post.error ?? "The network did not accept it." }, 502);
    }

    if (!action && method === "PATCH") return patchPost(post, readBody(init));

    if (!action && method === "DELETE") {
        if (post.status === "published" || post.status === "publishing")
            return err(409, "A published post stays on the calendar.");
        store.posts = store.posts.filter(p => p.id !== post.id);
        return json({ ok: true });
    }

    return err(405, "Method not allowed");
}
