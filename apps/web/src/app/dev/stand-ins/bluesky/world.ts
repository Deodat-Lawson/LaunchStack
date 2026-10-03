/**
 * The Bluesky stand-in's world: the LaunchStack account (signed into with
 * any app password), three fake accounts who reply, uploaded blobs, posts
 * and replies, and the sessions an app opened. In memory on `globalThis`;
 * `resetBlueskyWorld()` starts over. Like counts grow with post age.
 */
import type { CallLogEntry } from "../shared/http";
import { cidFor, monogramSvg, signJwt, tidFrom } from "../shared/ids";
import { globalSlot, standInClock } from "../shared/store";

export const BLUESKY_BASE_PATH = "/dev/stand-ins/bluesky";

export const ACCESS_TTL_MS = 2 * 60 * 60 * 1000;
export const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const MAX_BLOB_BYTES = 1_000_000;
export const MAX_POST_GRAPHEMES = 300;
const JWT_SECRET = "launchstack-dev-stand-in";

/** Four groups of four lowercase letters or digits, as bsky.app issues them. */
export const APP_PASSWORD = /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/;

export interface BskyAccount {
    did: string;
    handle: string;
    displayName: string;
    description: string;
    followersCount: number;
    followsCount: number;
    hue: number;
    initials: string;
}

export const LAUNCHSTACK: BskyAccount = {
    did: "did:plc:standinlaunchstack",
    handle: "launchstack.bsky.social",
    displayName: "LaunchStack",
    description: "Development stand-in account.",
    followersCount: 312,
    followsCount: 48,
    hue: 212,
    initials: "LS",
};

export const FAKE_ACCOUNTS: BskyAccount[] = [
    ["fernadeyemi", "fern-adeyemi.bsky.social", "Fern Adeyemi", 28, "FA"],
    ["oskarholm", "oskarholm.bsky.social", "Oskar Holm", 150, "OH"],
    ["minacastellano", "mina.bsky.social", "Mina Castellano", 320, "MC"],
].map(([slug, handle, displayName, hue, initials]) => ({
    did: `did:plc:standin${String(slug)}`,
    handle: String(handle),
    displayName: String(displayName),
    description: "",
    followersCount: 40,
    followsCount: 90,
    hue: Number(hue),
    initials: String(initials),
}));

const REPLY_LINES = [
    "This is great — congrats on shipping!",
    "Bookmarked. Does it work for small teams too?",
    "Love seeing this on here 🙌",
    "Neat. Is there a waitlist?",
    "Following along, keen to try it.",
];

export function accountByDid(did: string): BskyAccount | undefined {
    return did === LAUNCHSTACK.did ? LAUNCHSTACK : FAKE_ACCOUNTS.find(a => a.did === did);
}

export function accountByActor(actor: string): BskyAccount | undefined {
    const key = actor.trim().toLowerCase().replace(/^@/, "");
    return [LAUNCHSTACK, ...FAKE_ACCOUNTS].find(a => a.did === key || a.handle === key);
}

export interface BskySession {
    did: string;
    accessJwt: string;
    refreshJwt: string;
    createdAt: number;
    accessExpiresAt: number;
    refreshExpiresAt: number;
    revokedAt: number | null;
    /** The refresh token was spent on a refreshSession call. */
    rotatedAt: number | null;
}

export interface BskyBlob {
    cid: string;
    did: string;
    mimeType: string;
    size: number;
    data: Uint8Array<ArrayBuffer>;
    createdAt: number;
}

export interface StrongRef {
    uri: string;
    cid: string;
}

export interface BskyPost {
    uri: string;
    cid: string;
    rkey: string;
    authorDid: string;
    record: Record<string, unknown>;
    text: string;
    /** Visible from this moment (seeded replies "arrive" later). */
    createdAt: number;
    deletedAt: number | null;
    reply: { root: StrongRef; parent: StrongRef } | null;
    images: { cid: string; alt: string; mimeType: string }[];
    origin: "api" | "seeded" | "page";
}

export interface BskyState {
    schema: number;
    sessions: BskySession[];
    blobs: Record<string, BskyBlob>;
    posts: BskyPost[];
    calls: CallLogEntry[];
    seq: { fake: number; lastMicros: number; jwt: number };
}

const SCHEMA = 2;

const slot = globalSlot<BskyState>("bluesky", SCHEMA, () => ({
    schema: SCHEMA,
    sessions: [],
    blobs: {},
    posts: [],
    calls: [],
    seq: { fake: 0, lastMicros: 0, jwt: 0 },
}));

export function blueskyWorld(): BskyState {
    return slot.get();
}

export function resetBlueskyWorld(): BskyState {
    return slot.reset();
}

// ── Sessions ───────────────────────────────────────────────────────────────

export function openSession(w: BskyState, did: string): BskySession {
    const now = standInClock.now();
    const iat = Math.floor(now / 1000);
    const jti = ++w.seq.jwt;
    const session: BskySession = {
        did,
        accessJwt: signJwt(
            { typ: "at+jwt" },
            {
                scope: "com.atproto.appPass",
                sub: did,
                aud: "did:web:bsky.stand-in.example",
                iat,
                exp: Math.floor((now + ACCESS_TTL_MS) / 1000),
                jti: `a${jti}`,
            },
            JWT_SECRET
        ),
        refreshJwt: signJwt(
            { typ: "refresh+jwt" },
            {
                scope: "com.atproto.refresh",
                sub: did,
                aud: "did:web:bsky.stand-in.example",
                iat,
                exp: Math.floor((now + REFRESH_TTL_MS) / 1000),
                jti: `r${jti}`,
            },
            JWT_SECRET
        ),
        createdAt: now,
        accessExpiresAt: now + ACCESS_TTL_MS,
        refreshExpiresAt: now + REFRESH_TTL_MS,
        revokedAt: null,
        rotatedAt: null,
    };
    w.sessions.push(session);
    return session;
}

export function revokeSessions(w: BskyState): number {
    const now = standInClock.now();
    let n = 0;
    for (const s of w.sessions) {
        if (s.revokedAt === null) {
            s.revokedAt = now;
            n++;
        }
    }
    return n;
}

/** Access tokens only, so the app's refreshSession path gets exercised. */
export function expireAccessTokens(w: BskyState): number {
    const now = standInClock.now();
    let n = 0;
    for (const s of w.sessions) {
        if (s.revokedAt === null && s.accessExpiresAt > now) {
            s.accessExpiresAt = now - 1;
            n++;
        }
    }
    return n;
}

// ── Records ────────────────────────────────────────────────────────────────

function nextTid(w: BskyState): string {
    let micros = standInClock.now() * 1000;
    if (micros <= w.seq.lastMicros) micros = w.seq.lastMicros + 1;
    w.seq.lastMicros = micros;
    return tidFrom(BigInt(micros));
}

export function storeBlob(
    w: BskyState,
    did: string,
    data: Uint8Array<ArrayBuffer>,
    mimeType: string
): BskyBlob {
    const blob: BskyBlob = {
        cid: cidFor(data, "raw"),
        did,
        mimeType,
        size: data.byteLength,
        data,
        createdAt: standInClock.now(),
    };
    w.blobs[blob.cid] = blob;
    return blob;
}

export function createPostRecord(
    w: BskyState,
    authorDid: string,
    record: Record<string, unknown>,
    opts: {
        text: string;
        reply: { root: StrongRef; parent: StrongRef } | null;
        images: BskyPost["images"];
        origin: BskyPost["origin"];
        delayMs?: number;
    }
): BskyPost {
    const rkey = nextTid(w);
    const uri = `at://${authorDid}/app.bsky.feed.post/${rkey}`;
    const post: BskyPost = {
        uri,
        cid: cidFor(JSON.stringify({ uri, record }), "dag-cbor"),
        rkey,
        authorDid,
        record,
        text: opts.text,
        createdAt: standInClock.now() + (opts.delayMs ?? 0),
        deletedAt: null,
        reply: opts.reply,
        images: opts.images,
        origin: opts.origin,
    };
    w.posts.push(post);
    // Someone answers every top-level post the account makes, half a minute later.
    if (authorDid === LAUNCHSTACK.did && !opts.reply && opts.origin === "api") {
        addFakeReply(w, post, { delayMs: 30_000, origin: "seeded" });
    }
    return post;
}

export function addFakeReply(
    w: BskyState,
    parent: BskyPost,
    opts: { delayMs?: number; origin: BskyPost["origin"]; text?: string }
): BskyPost {
    const i = w.seq.fake++;
    const account = FAKE_ACCOUNTS[i % FAKE_ACCOUNTS.length]!;
    const custom = opts.text?.trim();
    const text =
        custom !== undefined && custom.length > 0
            ? custom
            : REPLY_LINES[(i * 2) % REPLY_LINES.length]!;
    const root = parent.reply?.root ?? { uri: parent.uri, cid: parent.cid };
    const reply = { root, parent: { uri: parent.uri, cid: parent.cid } };
    const createdAt = new Date(standInClock.now() + (opts.delayMs ?? 0)).toISOString();
    return createPostRecord(
        w,
        account.did,
        { $type: "app.bsky.feed.post", text, createdAt, langs: ["en"], reply },
        { text, reply, images: [], origin: opts.origin, delayMs: opts.delayMs }
    );
}

export function findBskyPost(w: BskyState, uri: string): BskyPost | undefined {
    return w.posts.find(p => p.uri === uri);
}

export function isVisible(p: BskyPost, now: number): boolean {
    return p.deletedAt === null && p.createdAt <= now;
}

export function directReplies(w: BskyState, post: BskyPost, now: number): BskyPost[] {
    return w.posts
        .filter(p => p.reply?.parent.uri === post.uri && isVisible(p, now))
        .sort((a, b) => a.createdAt - b.createdAt);
}

export interface BskyCounts {
    likeCount: number;
    repostCount: number;
    replyCount: number;
    quoteCount: number;
}

/** Quiet for the first minute, then ~0.8 likes a minute (capped at 400). */
export function postCounts(w: BskyState, post: BskyPost, now: number): BskyCounts {
    const ageMs = Math.max(0, now - post.createdAt);
    const likeCount = ageMs < 60_000 ? 0 : Math.min(400, Math.floor((ageMs / 60_000) * 0.8));
    return {
        likeCount,
        repostCount: Math.floor(likeCount / 6),
        replyCount: directReplies(w, post, now).length,
        quoteCount: Math.floor(likeCount / 25),
    };
}

/** Move every post `minutes` into the past. */
export function ageWorld(w: BskyState, minutes: number): void {
    for (const p of w.posts) p.createdAt -= minutes * 60_000;
}

// ── Media paths ────────────────────────────────────────────────────────────

/** Mirrors the CDN shape: /img/<preset>/plain/<did>/<cid>@<format>. */
export function blobImagePath(preset: string, did: string, cid: string): string {
    return `${BLUESKY_BASE_PATH}/img/${preset}/plain/${did}/${cid}@jpeg`;
}

export function avatarPath(did: string): string {
    return `${BLUESKY_BASE_PATH}/img/avatar/plain/${did}/avatar@jpeg`;
}

export function avatarSvg(did: string): string | null {
    const account = accountByDid(did);
    return account ? monogramSvg(account.initials, account.hue, true) : null;
}

// ── Snapshot for the page ──────────────────────────────────────────────────

export interface BlueskySnapshotPost {
    uri: string;
    rkey: string;
    authorHandle: string;
    authorName: string;
    authorAvatar: string;
    text: string;
    createdAt: number;
    deletedAt: number | null;
    pending: boolean;
    origin: BskyPost["origin"];
    images: { url: string; alt: string }[];
    counts: BskyCounts;
    replies: BlueskySnapshotPost[];
}

export interface BlueskySnapshot {
    now: number;
    account: {
        did: string;
        handle: string;
        displayName: string;
        avatar: string;
        followers: number;
    };
    posts: BlueskySnapshotPost[];
    sessions: {
        id: string;
        createdAt: number;
        accessExpiresAt: number;
        status: "active" | "revoked" | "expired";
    }[];
    calls: CallLogEntry[];
}

function snapshotPost(w: BskyState, p: BskyPost, now: number): BlueskySnapshotPost {
    const author = accountByDid(p.authorDid);
    return {
        uri: p.uri,
        rkey: p.rkey,
        authorHandle: author?.handle ?? p.authorDid,
        authorName: author?.displayName ?? p.authorDid,
        authorAvatar: avatarPath(p.authorDid),
        text: p.text,
        createdAt: p.createdAt,
        deletedAt: p.deletedAt,
        pending: p.createdAt > now,
        origin: p.origin,
        images: p.images.map(img => ({
            url: blobImagePath("feed_thumbnail", p.authorDid, img.cid),
            alt: img.alt,
        })),
        counts: postCounts(w, p, now),
        replies: w.posts
            .filter(r => r.reply?.parent.uri === p.uri && r.deletedAt === null)
            .sort((a, b) => a.createdAt - b.createdAt)
            .map(r => snapshotPost(w, r, now)),
    };
}

export function sessionStatus(s: BskySession, now: number): "active" | "revoked" | "expired" {
    if (s.revokedAt !== null) return "revoked";
    return s.accessExpiresAt <= now ? "expired" : "active";
}

export function blueskySnapshot(w: BskyState = blueskyWorld()): BlueskySnapshot {
    const now = standInClock.now();
    return {
        now,
        account: {
            did: LAUNCHSTACK.did,
            handle: LAUNCHSTACK.handle,
            displayName: LAUNCHSTACK.displayName,
            avatar: avatarPath(LAUNCHSTACK.did),
            followers: LAUNCHSTACK.followersCount,
        },
        posts: w.posts
            .filter(p => !p.reply)
            .sort((a, b) => b.createdAt - a.createdAt)
            .map(p => snapshotPost(w, p, now)),
        sessions: [...w.sessions]
            .sort((a, b) => b.createdAt - a.createdAt)
            .map(s => ({
                id: s.accessJwt.slice(-10),
                createdAt: s.createdAt,
                accessExpiresAt: s.accessExpiresAt,
                status: sessionStatus(s, now),
            })),
        calls: w.calls,
    };
}
