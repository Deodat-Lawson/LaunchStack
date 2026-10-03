/**
 * In-memory `/api/brand/*` for the preview harness: the accounts a small
 * roastery would have connected, a week of posts in every state, and a
 * scheduler that fires when the clock passes a post's time. Publishing to a
 * connected network succeeds with a made-up URL; to an unconnected one it
 * fails the way the real adapter would.
 */
import type {
    BrandAccount,
    BrandAccountField,
    BrandPlatform,
    BrandPost,
    BrandPostStatus,
} from "~/app/employer/tools/growth/brand/api";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const LIMITS: Record<BrandPlatform, number | null> = {
    linkedin: 3000,
    x: 280,
    bluesky: 300,
    reddit: 40000,
};

const FIELDS: Record<BrandPlatform, BrandAccountField[]> = {
    linkedin: [
        {
            key: "accessToken",
            label: "Access token",
            secret: true,
            hint: "An OAuth 2.0 member token with w_member_social. It expires after 60 days; reconnect then.",
        },
    ],
    x: [
        {
            key: "bearerToken",
            label: "User access token",
            secret: true,
            hint: "A user-context token. An app-only bearer token cannot post.",
        },
    ],
    bluesky: [
        { key: "handle", label: "Handle", secret: false, placeholder: "you.bsky.social" },
        {
            key: "appPassword",
            label: "App password",
            secret: true,
            hint: "Never your main password. Revoke it from Bluesky at any time.",
        },
    ],
    reddit: [
        { key: "clientId", label: "Client id", secret: false },
        { key: "clientSecret", label: "Client secret", secret: true },
        {
            key: "userAgent",
            label: "User agent",
            secret: false,
            placeholder: "launchstack:brand:v1 (by /u/yourname)",
        },
    ],
};

function seedAccounts(now: number): BrandAccount[] {
    return [
        {
            platform: "linkedin",
            label: "LinkedIn",
            configured: true,
            scope: "deployment",
            status: "connected",
            identity: null,
            connectedAt: null,
            lastError: null,
            limit: 3000,
            requires: [
                "A LinkedIn developer app owned by the company",
                "Community Management API access (registered entity; the page's super admin verifies the app)",
                "A member access token with the w_member_social scope",
            ],
            fields: FIELDS.linkedin,
            note: "Free to post. Access is reviewed by LinkedIn: a development tier first, the standard tier after a screencast review.",
        },
        {
            platform: "x",
            label: "X",
            configured: false,
            scope: null,
            status: "not_connected",
            identity: null,
            connectedAt: null,
            lastError: null,
            limit: 280,
            requires: [
                "An X developer account on pay-per-use",
                "An OAuth 2.0 user access token with tweet.write",
            ],
            fields: FIELDS.x,
            note: "Pay per post: about $0.015 each, $0.20 when the post carries a link. No free tier for new developers.",
        },
        {
            platform: "bluesky",
            label: "Bluesky",
            configured: true,
            scope: "workspace",
            status: "connected",
            identity: "roastery.bsky.social",
            connectedAt: new Date(now - 12 * DAY).toISOString(),
            lastError: null,
            limit: 300,
            requires: ["The account's handle", "An app password from Settings › App passwords"],
            fields: FIELDS.bluesky,
            note: "Free, no review. Reading back is free too.",
        },
        {
            platform: "reddit",
            label: "Reddit",
            configured: false,
            scope: "workspace",
            status: "revoked",
            identity: "u/roastery",
            connectedAt: new Date(now - 40 * DAY).toISOString(),
            lastError: "Reddit 401: the app secret was rotated",
            limit: 40000,
            requires: [
                "A Reddit script app (client id and secret)",
                "A user agent naming the app and the account, as Reddit's API rules ask",
            ],
            fields: FIELDS.reddit,
            note: "Free for this volume. Posts go to the account's own profile; each subreddit has its own rules.",
        },
    ];
}

let ACCOUNTS: BrandAccount[] = seedAccounts(Date.now());

type SimPost = BrandPost;

function at(now: number, offsetMs: number, hour: number, minute = 0): string {
    const d = new Date(now + offsetMs);
    d.setHours(hour, minute, 0, 0);
    return d.toISOString();
}

function seedPosts(now: number): SimPost[] {
    const base = (
        id: string,
        platform: BrandPlatform,
        body: string,
        status: BrandPostStatus
    ): SimPost => ({
        id,
        platform,
        body,
        title: null,
        status,
        scheduledAt: null,
        publishedAt: null,
        postId: null,
        postUrl: null,
        error: null,
        source: { kind: "compose" },
        createdAt: new Date(now - 3 * DAY).toISOString(),
        attempts: 0,
        nextAttemptAt: null,
    });
    return [
        {
            ...base(
                "post-1",
                "linkedin",
                "Why we roast light: a lighter roast keeps the origin's character. Three things it changes in the cup, and one thing it asks of the barista.",
                "published"
            ),
            scheduledAt: at(now, -2 * DAY, 8, 30),
            publishedAt: at(now, -2 * DAY, 8, 30),
            postId: "urn:li:share:7121",
            postUrl: "https://www.linkedin.com/feed/update/urn:li:share:7121",
        },
        {
            ...base(
                "post-2",
                "x",
                "New on the bar this week: a washed Sidamo with a jasmine nose. Come and try it.",
                "failed"
            ),
            scheduledAt: at(now, -1 * DAY, 10, 0),
            error: "This network is not connected for this workspace.",
            attempts: 1,
        },
        {
            ...base(
                "post-3",
                "bluesky",
                "Origin story, Sidamo: the cooperative we buy from, the altitude, and what the washing station changed in 2024.",
                "scheduled"
            ),
            scheduledAt: at(now, DAY, 9, 0),
        },
        {
            ...base(
                "post-4",
                "linkedin",
                "Origin story, Sidamo: the cooperative we buy from, the altitude, and what the washing station changed in 2024. A longer read for the people who buy for cafés.",
                "scheduled"
            ),
            scheduledAt: at(now, DAY, 9, 0),
            source: { kind: "campaign", historyId: 12 },
        },
        {
            ...base(
                "post-5",
                "bluesky",
                "Café partner spotlight next week: three places pouring our espresso, and what each does differently.",
                "draft"
            ),
            createdAt: new Date(now).toISOString(),
        },
    ];
}

let posts: SimPost[] = seedPosts(Date.now());
let seq = 10;

export function resetBrandSim(now = Date.now()): void {
    posts = seedPosts(now);
    ACCOUNTS = seedAccounts(now);
    seq = 10;
}

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function err(status: number, error: string, extra: Record<string, unknown> = {}): Response {
    return json({ error, ...extra }, status);
}

async function readBody(init?: RequestInit): Promise<Record<string, unknown>> {
    if (!init?.body || typeof init.body !== "string") return {};
    try {
        const parsed: unknown = JSON.parse(init.body);
        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

function strip(post: SimPost): BrandPost {
    return { ...post };
}

function configured(platform: BrandPlatform): boolean {
    return ACCOUNTS.find(a => a.platform === platform)?.configured ?? false;
}

function label(platform: BrandPlatform): string {
    return ACCOUNTS.find(a => a.platform === platform)?.label ?? platform;
}

function moment(post: SimPost): number {
    return new Date(post.scheduledAt ?? post.publishedAt ?? post.createdAt).getTime();
}

function bodyProblem(platform: BrandPlatform, body: string): string | null {
    const text = body.trim();
    if (!text) return "Write something first.";
    const limit = LIMITS[platform];
    if (limit !== null && text.length > limit)
        return `${text.length} characters is over ${label(platform)}'s limit of ${limit}.`;
    return null;
}

/** The claim and the network call, as the real module does them. */
function publish(post: SimPost, now: number): SimPost {
    if (!["draft", "scheduled", "failed"].includes(post.status)) return post;
    post.attempts += 1;
    if (configured(post.platform)) {
        post.status = "published";
        post.publishedAt = new Date(now).toISOString();
        post.postId = `${post.platform}-${seq++}`;
        post.postUrl = `https://example.invalid/${post.platform}/${post.postId}`;
        post.error = null;
        post.nextAttemptAt = null;
    } else {
        const account = ACCOUNTS.find(a => a.platform === post.platform);
        post.status = "failed";
        post.nextAttemptAt = null;
        post.error =
            account?.status === "revoked"
                ? `${account.lastError ?? "The network refused the credential"}. Reconnect the account under Accounts.`
                : "This network is not connected for this workspace.";
    }
    return post;
}

function publishDue(now: number): { published: SimPost[]; failed: SimPost[] } {
    const out = { published: [] as SimPost[], failed: [] as SimPost[] };
    for (const post of posts) {
        if (post.status !== "scheduled" || !post.scheduledAt) continue;
        if (new Date(post.scheduledAt).getTime() > now) continue;
        const outcome = publish(post, now);
        (outcome.status === "published" ? out.published : out.failed).push(outcome);
    }
    return out;
}

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

    if (parts[0] === "accounts") {
        if (parts.length === 1) return json({ accounts: ACCOUNTS });
        const account = ACCOUNTS.find(a => a.platform === parts[1]);
        if (!account) return err(404, "Unknown network");
        if (method === "POST") {
            const body = await readBody(init);
            const values = (body.values ?? {}) as Record<string, string>;
            for (const field of account.fields) {
                if (!values[field.key]?.trim()) return err(400, `${field.label} is required`);
            }
            // The harness has no network: anything ending in "-bad" is refused, the rest is accepted.
            const secret = account.fields.find(f => f.secret);
            if (secret && values[secret.key]?.trim().endsWith("-bad"))
                return err(401, `${account.label} refused the credential`, {
                    code: "credentials_rejected",
                });
            account.configured = true;
            account.scope = "workspace";
            account.status = "connected";
            account.identity =
                account.platform === "bluesky"
                    ? (values.handle ?? null)
                    : account.platform === "reddit"
                      ? "u/roastery"
                      : account.platform === "x"
                        ? "@roastery"
                        : "Roastery";
            account.connectedAt = new Date(now).toISOString();
            account.lastError = null;
            return json({ account }, 201);
        }
        if (method === "DELETE") {
            account.configured = account.platform === "linkedin";
            account.scope = account.platform === "linkedin" ? "deployment" : null;
            account.status = account.platform === "linkedin" ? "connected" : "not_connected";
            account.identity = null;
            account.connectedAt = null;
            account.lastError = null;
            return json({ account });
        }
        return err(405, "Method not allowed");
    }

    if (parts[0] !== "posts") return err(404, "Not found");

    if (parts.length === 1 && method === "GET") {
        publishDue(now);
        const from = u.searchParams.get("from");
        const to = u.searchParams.get("to");
        const fromMs = from ? new Date(from).getTime() : now - 14 * DAY;
        const toMs = to ? new Date(to).getTime() : now + 42 * DAY;
        const list = posts
            .filter(p => moment(p) >= fromMs && moment(p) < toMs)
            .sort((a, b) => moment(a) - moment(b))
            .map(strip);
        return json({ posts: list, now: new Date(now).toISOString() });
    }

    if (parts.length === 1 && method === "POST") {
        const body = await readBody(init);
        const platforms = Array.isArray(body.platforms)
            ? (body.platforms as BrandPlatform[]).filter(p => p in LIMITS)
            : [];
        const text = typeof body.body === "string" ? body.body : "";
        if (platforms.length === 0) return err(400, "Pick at least one network.");
        for (const platform of platforms) {
            const problem = bodyProblem(platform, text);
            if (problem) return err(400, problem);
        }
        const scheduledAt =
            typeof body.scheduledAt === "string" && !body.publishNow ? body.scheduledAt : null;
        if (scheduledAt && new Date(scheduledAt).getTime() < now - 60_000)
            return err(400, "Pick a time that is still ahead.");
        const created: SimPost[] = platforms.map(platform => ({
            id: `post-${seq++}`,
            platform,
            body: text.trim(),
            title:
                platform === "reddit" && typeof body.title === "string" && body.title.trim()
                    ? body.title.trim()
                    : null,
            status: scheduledAt ? "scheduled" : "draft",
            scheduledAt,
            publishedAt: null,
            postId: null,
            postUrl: null,
            error: null,
            source:
                body.source && typeof body.source === "object"
                    ? (body.source as BrandPost["source"])
                    : { kind: "compose" },
            createdAt: new Date(now).toISOString(),
            attempts: 0,
            nextAttemptAt: null,
        }));
        posts.push(...created);
        if (body.publishNow) for (const post of created) publish(post, now);
        return json({ posts: created.map(strip) }, 201);
    }

    if (parts[0] === "posts" && parts[1] === "publish-due" && method === "POST") {
        const result = publishDue(now);
        return json({
            published: result.published.map(strip),
            failed: result.failed.map(strip),
            retrying: [],
            skipped: 0,
        });
    }

    const post = posts.find(p => p.id === parts[1]);
    if (!post) return err(404, "Post not found");

    if (parts[2] === "publish" && method === "POST") {
        if (!["draft", "scheduled", "failed"].includes(post.status))
            return err(
                409,
                post.status === "published"
                    ? "This post is already out."
                    : "A cancelled post has to be rescheduled before it can go out."
            );
        publish(post, now);
        return json({ post: strip(post) }, post.status === "published" ? 200 : 502);
    }

    if (method === "PATCH") {
        if (post.status === "published" || post.status === "publishing")
            return err(409, "This post is already out. Publish a new one instead.");
        const body = await readBody(init);
        if (typeof body.body === "string") {
            const problem = bodyProblem(post.platform, body.body);
            if (problem) return err(400, problem);
            post.body = body.body.trim();
        }
        if (body.title !== undefined)
            post.title = typeof body.title === "string" ? body.title : null;
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
        post.error = post.status === "failed" ? post.error : null;
        post.attempts = 0;
        post.nextAttemptAt = null;
        return json({ post: strip(post) });
    }

    if (method === "DELETE") {
        if (post.status === "published" || post.status === "publishing")
            return err(409, "A published post stays on the calendar.");
        posts = posts.filter(p => p.id !== post.id);
        return json({ ok: true });
    }

    return err(405, "Method not allowed");
}
