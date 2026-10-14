/**
 * The LinkedIn stand-in's world: one signed-in member (Dana Okafor), two
 * Pages she administers, six fake members who comment, and everything an app
 * does to it over the API — OAuth codes and tokens, uploaded images, posts,
 * comments. In memory on `globalThis`; `resetLinkedInWorld()` starts over.
 *
 * Numbers (impressions, likes, followers) are functions of time so the same
 * world read twice a minute apart has grown, the way a real Page does.
 */
import type { CallLogEntry } from "../shared/http";
import { monogramSvg, randomId, randomToken } from "../shared/ids";
import { globalSlot, standInClock } from "../shared/store";
import { renderLittleText } from "./little-text";

export const LINKEDIN_BASE_PATH = "/dev/stand-ins/linkedin";

/** Versions older than this answer 426, as LinkedIn sunsets them after a year. */
export const OLDEST_ACTIVE_VERSION = "202510";

export const ACCESS_TOKEN_TTL_S = 5_184_000; // 60 days
export const REFRESH_TOKEN_TTL_S = 31_536_000; // 365 days
const CODE_TTL_MS = 30 * 60 * 1000;
const UPLOAD_URL_TTL_MS = 24 * 60 * 60 * 1000;

/** Scopes a LinkedIn app can be granted; anything else is `unauthorized_scope_error`. */
export const KNOWN_SCOPES = new Set([
    "openid",
    "profile",
    "email",
    "r_basicprofile",
    "r_liteprofile",
    "r_emailaddress",
    "w_member_social",
    "r_member_social",
    "w_member_social_feed",
    "r_member_social_feed",
    "rw_organization_admin",
    "r_organization_admin",
    "w_organization_social",
    "r_organization_social",
    "w_organization_social_feed",
    "r_organization_social_feed",
    "r_organization_followers",
    "r_1st_connections_size",
    "r_ads",
    "rw_ads",
    "r_ads_reporting",
]);

export type OrgRole = "ADMINISTRATOR" | "CONTENT_ADMINISTRATOR";

export interface LiMember {
    id: string;
    firstName: string;
    lastName: string;
    vanityName: string;
    email: string;
    hue: number;
}

export interface LiOrg {
    id: string;
    name: string;
    vanityName: string;
    logoImageId: string;
    followerBase: number;
    hue: number;
    initials: string;
}

/** The member every consent screen signs in as. */
export const DANA: LiMember = {
    id: "dN4okaF0rQ",
    firstName: "Dana",
    lastName: "Okafor",
    vanityName: "dana-okafor",
    email: "dana.okafor@launchstack.example",
    hue: 200,
};

/** People who comment on the stand-in's posts. */
export const FAKE_MEMBERS: LiMember[] = [
    ["pR7amanX2k", "Priya", "Raman", 18],
    ["mL1ndqv1sT", "Marcus", "Lindqvist", 140],
    ["aM3nsahQ9e", "Ama", "Mensah", 30],
    ["jF3ldWw4pn", "Jonah", "Feld", 280],
    ["s0rtegaK8v", "Sofia", "Ortega", 330],
    ["kW4tanabeZ", "Kenji", "Watanabe", 95],
].map(([id, firstName, lastName, hue]) => ({
    id: id as string,
    firstName: firstName as string,
    lastName: lastName as string,
    vanityName: `${String(firstName).toLowerCase()}-${String(lastName).toLowerCase()}`,
    email: `${String(firstName).toLowerCase()}@members.example`,
    hue: hue as number,
}));

export const ORGS: LiOrg[] = [
    {
        id: "104857",
        name: "LaunchStack",
        vanityName: "launchstack",
        logoImageId: "C4D0BAQHlsLogo104857",
        followerBase: 1284,
        hue: 262,
        initials: "LS",
    },
    {
        id: "209114",
        name: "LaunchStack Labs",
        vanityName: "launchstack-labs",
        logoImageId: "C4D0BAQHlsLogo209114",
        followerBase: 212,
        hue: 168,
        initials: "LL",
    },
];

export const ACLS: { orgId: string; memberId: string; role: OrgRole }[] = [
    { orgId: "104857", memberId: DANA.id, role: "ADMINISTRATOR" },
    { orgId: "209114", memberId: DANA.id, role: "CONTENT_ADMINISTRATOR" },
];

const COMMENT_LINES = [
    "Congrats to the whole team — this is a big step.",
    "Really useful write-up. Is there a public roadmap?",
    "We've been looking for exactly this. Following along.",
    "Great to see this shipped! How does it handle larger teams?",
    "Saving this for our Monday stand-up.",
    "Clear and to the point. Would love a deeper dive on the setup.",
    "This resonates. We hit the same wall last quarter.",
    "Nice! Any plans for an integration with our CRM?",
];

export interface LiCode {
    code: string;
    clientId: string;
    redirectUri: string;
    scopes: string[];
    memberId: string;
    expiresAt: number;
}

export interface LiToken {
    value: string;
    kind: "access" | "refresh";
    clientId: string;
    scopes: string[];
    memberId: string;
    issuedAt: number;
    expiresAt: number;
    revokedAt: number | null;
    /** Access tokens: the refresh token issued with (or used to mint) this one. */
    refreshToken: string | null;
}

export interface LiImage {
    id: string;
    ownerUrn: string;
    status: "WAITING_UPLOAD" | "AVAILABLE";
    data: Uint8Array<ArrayBuffer> | null;
    contentType: string | null;
    createdAt: number;
    uploadUrlExpiresAt: number;
}

export interface LiPost {
    urn: string;
    activityUrn: string;
    authorUrn: string;
    /** As sent (little text). */
    commentary: string;
    /** As a reader sees it. */
    text: string;
    issues: string[];
    visibility: string;
    distribution: unknown;
    lifecycleState: string;
    isReshareDisabledByAuthor: boolean;
    content: unknown;
    media: { imageId: string; altText: string | null }[];
    createdAt: number;
    deletedAt: number | null;
    createdBy: string;
}

export interface LiComment {
    id: string;
    postUrn: string;
    activityUrn: string;
    /** Top-level comment id this replies to. */
    parentId: string | null;
    actorUrn: string;
    /** The member who acted for an organization actor. */
    agentUrn: string | null;
    text: string;
    /** Visible from this moment (seeded comments "arrive" later). */
    createdAt: number;
    origin: "seeded" | "api" | "page";
    deletedAt: number | null;
}

export interface LiState {
    schema: number;
    /** client_id → the secret first presented for it (stand-in "app registration"). */
    clients: Record<string, string>;
    codes: Record<string, LiCode>;
    tokens: LiToken[];
    images: Record<string, LiImage>;
    posts: LiPost[];
    comments: LiComment[];
    calls: CallLogEntry[];
    seq: { post: number; comment: number; fake: number };
}

const SCHEMA = 3;

function seed(): LiState {
    const now = standInClock.now();
    const images: Record<string, LiImage> = {};
    for (const org of ORGS) {
        images[org.logoImageId] = {
            id: org.logoImageId,
            ownerUrn: orgUrn(org.id),
            status: "AVAILABLE",
            data: new TextEncoder().encode(monogramSvg(org.initials, org.hue, false)),
            contentType: "image/svg+xml",
            createdAt: now,
            uploadUrlExpiresAt: now,
        };
    }
    return {
        schema: SCHEMA,
        clients: {},
        codes: {},
        tokens: [],
        images,
        posts: [],
        comments: [],
        calls: [],
        seq: { post: 0, comment: 0, fake: 0 },
    };
}

const slot = globalSlot<LiState>("linkedin", SCHEMA, seed);

export function linkedInWorld(): LiState {
    return slot.get();
}

export function resetLinkedInWorld(): LiState {
    return slot.reset();
}

// ── URNs and lookups ───────────────────────────────────────────────────────

export const personUrn = (id: string) => `urn:li:person:${id}`;
export const orgUrn = (id: string) => `urn:li:organization:${id}`;
export const imageUrn = (id: string) => `urn:li:image:${id}`;
export const commentUrn = (activityUrn: string, id: string) =>
    `urn:li:comment:(${activityUrn},${id})`;

export function memberById(id: string): LiMember | undefined {
    return id === DANA.id ? DANA : FAKE_MEMBERS.find(m => m.id === id);
}

export function orgById(id: string): LiOrg | undefined {
    return ORGS.find(o => o.id === id);
}

export function parseOrgUrn(urn: string): string | null {
    const m = /^urn:li:(?:organization|company):(\d+)$/.exec(urn);
    return m ? m[1]! : null;
}

export function parsePersonUrn(urn: string): string | null {
    const m = /^urn:li:person:([A-Za-z0-9_-]+)$/.exec(urn);
    return m ? m[1]! : null;
}

/** `urn:li:image:X` or the legacy `urn:li:digitalmediaAsset:X` → X. */
export function parseImageUrn(urn: string): string | null {
    const m = /^urn:li:(?:image|digitalmediaAsset):([A-Za-z0-9_-]+)$/.exec(urn);
    return m ? m[1]! : null;
}

/** `urn:li:comment:(urn:li:activity:1,2)` → { objectUrn, id }. */
export function parseCommentUrn(urn: string): { objectUrn: string; id: string } | null {
    const m = /^urn:li:comment:\((urn:li:[A-Za-z]+:[^,]+),(\d+)\)$/.exec(urn);
    return m ? { objectUrn: m[1]!, id: m[2]! } : null;
}

export function roleOf(memberId: string, orgId: string): OrgRole | null {
    return ACLS.find(a => a.memberId === memberId && a.orgId === orgId)?.role ?? null;
}

/** A post by its share, ugcPost or activity URN. */
export function findPost(w: LiState, urn: string): LiPost | undefined {
    return w.posts.find(p => p.urn === urn || p.activityUrn === urn);
}

export function actorName(urn: string): string | null {
    const orgId = parseOrgUrn(urn);
    if (orgId) return orgById(orgId)?.name ?? null;
    const personId = parsePersonUrn(urn);
    const member = personId ? memberById(personId) : undefined;
    return member ? `${member.firstName} ${member.lastName}` : null;
}

export function assetPath(id: string): string {
    return `${LINKEDIN_BASE_PATH}/assets/${id}`;
}

export function actorPicturePath(urn: string): string | null {
    const orgId = parseOrgUrn(urn);
    if (orgId) {
        const org = orgById(orgId);
        return org ? assetPath(org.logoImageId) : null;
    }
    const personId = parsePersonUrn(urn);
    return personId && memberById(personId) ? assetPath(`member-${personId}`) : null;
}

export function memberPictureSvg(id: string): string | null {
    const member = memberById(id);
    if (!member) return null;
    return monogramSvg(`${member.firstName[0]}${member.lastName[0]}`, member.hue, true);
}

// ── OAuth ──────────────────────────────────────────────────────────────────

export function parseScopes(raw: string | null): string[] {
    return [
        ...new Set(
            (raw ?? "")
                .split(/[\s,]+/)
                .map(s => s.trim())
                .filter(Boolean)
        ),
    ];
}

export type AuthorizationCheck =
    | {
          ok: true;
          clientId: string;
          redirectUri: string;
          state: string | null;
          scopes: string[];
      }
    /** Shown on the stand-in's own page; LinkedIn does not redirect these. */
    | { ok: false; kind: "page"; message: string }
    /** Sent back to the app's redirect_uri. */
    | { ok: false; kind: "redirect"; location: string };

export function errorRedirect(
    redirectUri: string,
    error: string,
    description: string,
    state: string | null
): string {
    const url = new URL(redirectUri);
    url.searchParams.set("error", error);
    url.searchParams.set("error_description", description);
    if (state !== null) url.searchParams.set("state", state);
    return url.toString();
}

export function checkAuthorizationRequest(params: URLSearchParams): AuthorizationCheck {
    const responseType = params.get("response_type");
    const clientId = params.get("client_id")?.trim() ?? "";
    const redirectUri = params.get("redirect_uri") ?? "";
    const state = params.get("state");
    if (!clientId) {
        return { ok: false, kind: "page", message: "The client_id parameter is missing." };
    }
    let parsed: URL | null = null;
    try {
        parsed = new URL(redirectUri);
    } catch {
        parsed = null;
    }
    if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
        return {
            ok: false,
            kind: "page",
            message: "The redirect_uri must be an absolute http(s) URL.",
        };
    }
    if (responseType !== "code") {
        return {
            ok: false,
            kind: "redirect",
            location: errorRedirect(
                redirectUri,
                "unsupported_response_type",
                'response_type must be "code"',
                state
            ),
        };
    }
    const scopes = parseScopes(params.get("scope"));
    if (scopes.length === 0) {
        return {
            ok: false,
            kind: "redirect",
            location: errorRedirect(
                redirectUri,
                "invalid_request",
                'A required parameter "scope" is missing',
                state
            ),
        };
    }
    const unknown = scopes.filter(s => !KNOWN_SCOPES.has(s));
    if (unknown.length > 0) {
        return {
            ok: false,
            kind: "redirect",
            location: errorRedirect(
                redirectUri,
                "unauthorized_scope_error",
                `Scope "${unknown[0]}" is not authorized for your application`,
                state
            ),
        };
    }
    return { ok: true, clientId, redirectUri, state, scopes };
}

/** Allow → a fresh one-use code on the redirect_uri. */
export function approveAuthorization(
    w: LiState,
    req: { clientId: string; redirectUri: string; state: string | null; scopes: string[] }
): string {
    const code = randomToken("AQT", 48);
    w.codes[code] = {
        code,
        clientId: req.clientId,
        redirectUri: req.redirectUri,
        scopes: req.scopes,
        memberId: DANA.id,
        expiresAt: standInClock.now() + CODE_TTL_MS,
    };
    const url = new URL(req.redirectUri);
    url.searchParams.set("code", code);
    if (req.state !== null) url.searchParams.set("state", req.state);
    return url.toString();
}

export function cancelAuthorization(redirectUri: string, state: string | null): string {
    return errorRedirect(
        redirectUri,
        "user_cancelled_authorize",
        "The user cancelled the authorization",
        state
    );
}

export function issueTokens(
    w: LiState,
    grant: { clientId: string; scopes: string[]; memberId: string },
    refreshToken: LiToken | null
): { access: LiToken; refresh: LiToken | null } {
    const now = standInClock.now();
    let refresh = refreshToken;
    if (!refresh && grant.scopes.includes("rw_organization_admin")) {
        refresh = {
            value: randomToken("AQW", 72),
            kind: "refresh",
            clientId: grant.clientId,
            scopes: grant.scopes,
            memberId: grant.memberId,
            issuedAt: now,
            expiresAt: now + REFRESH_TOKEN_TTL_S * 1000,
            revokedAt: null,
            refreshToken: null,
        };
        w.tokens.push(refresh);
    }
    const access: LiToken = {
        value: randomToken("AQV", 96),
        kind: "access",
        clientId: grant.clientId,
        scopes: grant.scopes,
        memberId: grant.memberId,
        issuedAt: now,
        expiresAt: now + ACCESS_TOKEN_TTL_S * 1000,
        revokedAt: null,
        refreshToken: refresh?.value ?? null,
    };
    w.tokens.push(access);
    return { access, refresh };
}

export function tokenStatus(t: LiToken, now: number): "active" | "revoked" | "expired" {
    if (t.revokedAt !== null) return "revoked";
    if (t.expiresAt <= now) return "expired";
    return "active";
}

// ── Images, posts, comments ────────────────────────────────────────────────

export function newImage(w: LiState, ownerUrn: string): LiImage {
    const now = standInClock.now();
    const image: LiImage = {
        id: `D4E10AQ${randomId(12)}`,
        ownerUrn,
        status: "WAITING_UPLOAD",
        data: null,
        contentType: null,
        createdAt: now,
        uploadUrlExpiresAt: now + UPLOAD_URL_TTL_MS,
    };
    w.images[image.id] = image;
    return image;
}

const SHARE_BASE = 7_384_210_000_000_000_000n;
const ACTIVITY_BASE = 7_384_210_500_000_000_000n;
const COMMENT_BASE = 7_384_300_000_000_000_000n;

export function createPost(
    w: LiState,
    fields: Omit<LiPost, "urn" | "activityUrn" | "text" | "issues" | "createdAt" | "deletedAt">
): LiPost {
    const n = ++w.seq.post;
    const now = standInClock.now();
    const rendered = renderLittleText(fields.commentary);
    const post: LiPost = {
        ...fields,
        urn: `urn:li:share:${(SHARE_BASE + BigInt(n * 7919)).toString()}`,
        activityUrn: `urn:li:activity:${(ACTIVITY_BASE + BigInt(n * 7919)).toString()}`,
        text: rendered.text,
        issues: rendered.issues,
        createdAt: now,
        deletedAt: null,
    };
    w.posts.push(post);
    if (post.lifecycleState === "PUBLISHED") {
        // Two people react to every published post: one after 20s, one after 90s.
        addFakeComment(w, post, { delayMs: 20_000, origin: "seeded" });
        addFakeComment(w, post, { delayMs: 90_000, origin: "seeded" });
    }
    return post;
}

export function addComment(
    w: LiState,
    post: LiPost,
    c: {
        actorUrn: string;
        agentUrn: string | null;
        text: string;
        parentId: string | null;
        createdAt: number;
        origin: LiComment["origin"];
    }
): LiComment {
    const n = ++w.seq.comment;
    const comment: LiComment = {
        id: (COMMENT_BASE + BigInt(n * 104_729)).toString(),
        postUrn: post.urn,
        activityUrn: post.activityUrn,
        parentId: c.parentId,
        actorUrn: c.actorUrn,
        agentUrn: c.agentUrn,
        text: c.text,
        createdAt: c.createdAt,
        origin: c.origin,
        deletedAt: null,
    };
    w.comments.push(comment);
    return comment;
}

export function addFakeComment(
    w: LiState,
    post: LiPost,
    opts: {
        delayMs?: number;
        origin: LiComment["origin"];
        text?: string;
        parentId?: string | null;
    }
): LiComment {
    const i = w.seq.fake++;
    // A stride coprime with both list lengths walks every member and line.
    const member = FAKE_MEMBERS[(i * 5) % FAKE_MEMBERS.length]!;
    const custom = opts.text?.trim();
    const text =
        custom !== undefined && custom.length > 0
            ? custom
            : COMMENT_LINES[(i * 3) % COMMENT_LINES.length]!;
    return addComment(w, post, {
        actorUrn: personUrn(member.id),
        agentUrn: null,
        text,
        parentId: opts.parentId ?? null,
        createdAt: standInClock.now() + (opts.delayMs ?? 0),
        origin: opts.origin,
    });
}

export function isVisible(c: LiComment, now: number): boolean {
    return c.deletedAt === null && c.createdAt <= now;
}

export function visibleComments(w: LiState, post: LiPost, now: number): LiComment[] {
    return w.comments.filter(c => c.postUrn === post.urn && isVisible(c, now));
}

export interface ShareStatistics {
    impressionCount: number;
    uniqueImpressionsCount: number;
    clickCount: number;
    likeCount: number;
    commentCount: number;
    shareCount: number;
    engagement: number;
}

/**
 * Deterministic growth: quiet for the first minute, then ~40 + 7/min
 * impressions (capped at 5000) with fixed reaction ratios.
 */
export function postStats(w: LiState, post: LiPost, now: number): ShareStatistics {
    const ageMs = Math.max(0, now - post.createdAt);
    const minutes = ageMs / 60_000;
    const impressionCount = ageMs < 60_000 ? 0 : Math.min(5000, Math.floor(40 + minutes * 7));
    const likeCount = Math.floor(impressionCount * 0.04);
    const clickCount = Math.floor(impressionCount * 0.02);
    const shareCount = Math.floor(impressionCount * 0.005);
    const commentCount = visibleComments(w, post, now).length;
    const engagement =
        impressionCount > 0
            ? (clickCount + likeCount + commentCount + shareCount) / impressionCount
            : 0;
    return {
        impressionCount,
        uniqueImpressionsCount: Math.floor(impressionCount * 0.82),
        clickCount,
        likeCount,
        commentCount,
        shareCount,
        engagement: Math.round(engagement * 10_000) / 10_000,
    };
}

export function hasActivity(s: ShareStatistics): boolean {
    return s.impressionCount > 0 || s.commentCount > 0;
}

export function livePosts(w: LiState): LiPost[] {
    return w.posts.filter(p => p.deletedAt === null && p.lifecycleState === "PUBLISHED");
}

export function followerCount(w: LiState, orgId: string): number {
    const org = orgById(orgId);
    if (!org) return 0;
    return org.followerBase + livePosts(w).filter(p => p.authorUrn === orgUrn(orgId)).length;
}

// ── Page controls ──────────────────────────────────────────────────────────

export function revokeAllTokens(w: LiState): number {
    const now = standInClock.now();
    let n = 0;
    for (const t of w.tokens) {
        if (t.revokedAt === null) {
            t.revokedAt = now;
            n++;
        }
    }
    return n;
}

/** Access tokens only, so the app's refresh path gets exercised. */
export function expireAccessTokens(w: LiState): number {
    const now = standInClock.now();
    let n = 0;
    for (const t of w.tokens) {
        if (t.kind === "access" && t.revokedAt === null && t.expiresAt > now) {
            t.expiresAt = now - 1;
            n++;
        }
    }
    return n;
}

/** Move every post and comment `minutes` into the past. */
export function ageWorld(w: LiState, minutes: number): void {
    const ms = minutes * 60_000;
    for (const p of w.posts) p.createdAt -= ms;
    for (const c of w.comments) c.createdAt -= ms;
}

// ── Snapshot for the page ──────────────────────────────────────────────────

export interface LinkedInSnapshotComment {
    id: string;
    urn: string;
    actorUrn: string;
    actorName: string;
    actorPicture: string | null;
    text: string;
    createdAt: number;
    pending: boolean;
    origin: LiComment["origin"];
    replies: LinkedInSnapshotComment[];
}

export interface LinkedInSnapshotPost {
    urn: string;
    activityUrn: string;
    authorUrn: string;
    authorName: string;
    authorPicture: string | null;
    text: string;
    commentary: string;
    issues: string[];
    visibility: string;
    lifecycleState: string;
    createdAt: number;
    deletedAt: number | null;
    images: { url: string; alt: string | null }[];
    stats: ShareStatistics | null;
    comments: LinkedInSnapshotComment[];
}

export interface LinkedInSnapshot {
    now: number;
    member: { urn: string; name: string; email: string; vanityName: string; picture: string };
    orgs: {
        urn: string;
        name: string;
        vanityName: string;
        role: OrgRole;
        logo: string;
        followers: number;
    }[];
    posts: LinkedInSnapshotPost[];
    tokens: {
        id: string;
        preview: string;
        kind: LiToken["kind"];
        clientId: string;
        scopes: string[];
        issuedAt: number;
        expiresAt: number;
        status: "active" | "revoked" | "expired";
    }[];
    calls: CallLogEntry[];
}

function snapshotComment(c: LiComment, now: number, all: LiComment[]): LinkedInSnapshotComment {
    return {
        id: c.id,
        urn: commentUrn(c.activityUrn, c.id),
        actorUrn: c.actorUrn,
        actorName: actorName(c.actorUrn) ?? c.actorUrn,
        actorPicture: actorPicturePath(c.actorUrn),
        text: c.text,
        createdAt: c.createdAt,
        pending: c.createdAt > now,
        origin: c.origin,
        replies: all.filter(r => r.parentId === c.id).map(r => snapshotComment(r, now, all)),
    };
}

export function linkedInSnapshot(w: LiState = linkedInWorld()): LinkedInSnapshot {
    const now = standInClock.now();
    const posts = [...w.posts].sort((a, b) => b.createdAt - a.createdAt);
    return {
        now,
        member: {
            urn: personUrn(DANA.id),
            name: `${DANA.firstName} ${DANA.lastName}`,
            email: DANA.email,
            vanityName: DANA.vanityName,
            picture: assetPath(`member-${DANA.id}`),
        },
        orgs: ACLS.map(acl => {
            const org = orgById(acl.orgId)!;
            return {
                urn: orgUrn(org.id),
                name: org.name,
                vanityName: org.vanityName,
                role: acl.role,
                logo: assetPath(org.logoImageId),
                followers: followerCount(w, org.id),
            };
        }),
        posts: posts.map(p => {
            const comments = w.comments
                .filter(c => c.postUrn === p.urn && c.deletedAt === null)
                .sort((a, b) => a.createdAt - b.createdAt);
            const stats = postStats(w, p, now);
            return {
                urn: p.urn,
                activityUrn: p.activityUrn,
                authorUrn: p.authorUrn,
                authorName: actorName(p.authorUrn) ?? p.authorUrn,
                authorPicture: actorPicturePath(p.authorUrn),
                text: p.text,
                commentary: p.commentary,
                issues: p.issues,
                visibility: p.visibility,
                lifecycleState: p.lifecycleState,
                createdAt: p.createdAt,
                deletedAt: p.deletedAt,
                images: p.media.map(m => ({ url: assetPath(m.imageId), alt: m.altText })),
                stats: hasActivity(stats) ? stats : null,
                comments: comments
                    .filter(c => c.parentId === null)
                    .map(c => snapshotComment(c, now, comments)),
            };
        }),
        tokens: [...w.tokens]
            .sort((a, b) => b.issuedAt - a.issuedAt)
            .map(t => ({
                id: t.value.slice(-12),
                preview: `${t.value.slice(0, 6)}…${t.value.slice(-6)}`,
                kind: t.kind,
                clientId: t.clientId,
                scopes: t.scopes,
                issuedAt: t.issuedAt,
                expiresAt: t.expiresAt,
                status: tokenStatus(t, now),
            })),
        calls: w.calls,
    };
}
