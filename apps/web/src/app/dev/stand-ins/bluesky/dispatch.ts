/**
 * HTTP surface of the Bluesky stand-in: the XRPC methods a posting client
 * needs from a PDS (sessions, blobs, records) and the AppView reads that
 * report back (profile, posts, threads), with atproto's error envelope
 * `{ error, message }`. One base URL serves both roles:
 *
 *   BLUESKY_SERVICE_URL=<origin>/dev/stand-ins/bluesky
 *   BLUESKY_APPVIEW_URL=<origin>/dev/stand-ins/bluesky
 *
 * Sign in as `launchstack.bsky.social` with any app password shaped
 * `xxxx-xxxx-xxxx-xxxx`.
 */
import {
    bearerToken,
    bytes,
    displayPath,
    isRecord,
    json,
    originOf,
    pushCall,
    readJson,
    segmentsAfter,
} from "../shared/http";
import { cidFor } from "../shared/ids";
import { standInClock } from "../shared/store";
import {
    APP_PASSWORD,
    BLUESKY_BASE_PATH,
    LAUNCHSTACK,
    MAX_BLOB_BYTES,
    MAX_POST_GRAPHEMES,
    accountByActor,
    accountByDid,
    addFakeReply,
    ageWorld,
    avatarPath,
    avatarSvg,
    blobImagePath,
    blueskySnapshot,
    blueskyWorld,
    createPostRecord,
    directReplies,
    expireAccessTokens,
    findBskyPost,
    isVisible,
    openSession,
    postCounts,
    resetBlueskyWorld,
    revokeSessions,
    storeBlob,
    type BskyAccount,
    type BskyPost,
    type BskySession,
    type BskyState,
    type StrongRef,
} from "./world";

interface Ctx {
    req: Request;
    url: URL;
    method: string;
    segs: string[];
    origin: string;
    w: BskyState;
    now: number;
}

export async function handleBlueskyRequest(req: Request): Promise<Response> {
    const segs = segmentsAfter(req, BLUESKY_BASE_PATH);
    const ctx: Ctx = {
        req,
        url: new URL(req.url),
        method: req.method.toUpperCase(),
        segs,
        origin: originOf(req),
        w: blueskyWorld(),
        now: standInClock.now(),
    };
    let res: Response;
    try {
        res = await route(ctx);
    } catch (err) {
        res = xrpcError(
            500,
            "InternalServerError",
            err instanceof Error ? err.message : String(err)
        );
    }
    if (segs[0] === "xrpc" && segs[1] !== "com.atproto.sync.getBlob") {
        pushCall(blueskyWorld().calls, {
            at: ctx.now,
            method: ctx.method,
            path: displayPath(req, BLUESKY_BASE_PATH),
            status: res.status,
        });
    }
    return res;
}

const GET_METHODS = new Set([
    "com.atproto.server.getSession",
    "com.atproto.identity.resolveHandle",
    "app.bsky.actor.getProfile",
    "app.bsky.feed.getPosts",
    "app.bsky.feed.getPostThread",
    "com.atproto.sync.getBlob",
]);

async function route(ctx: Ctx): Promise<Response> {
    const [a, b] = ctx.segs;
    if (a === "_standin") return control(ctx, b);
    if (a === "img" && ctx.method === "GET") return image(ctx);
    if (a !== "xrpc" || !b) return xrpcError(404, "NotFound", "Not Found");

    const expected = GET_METHODS.has(b) ? "GET" : "POST";
    switch (b) {
        case "com.atproto.server.createSession":
        case "com.atproto.server.refreshSession":
        case "com.atproto.server.deleteSession":
        case "com.atproto.server.getSession":
        case "com.atproto.identity.resolveHandle":
        case "app.bsky.actor.getProfile":
        case "com.atproto.repo.uploadBlob":
        case "com.atproto.repo.createRecord":
        case "com.atproto.repo.deleteRecord":
        case "app.bsky.feed.getPosts":
        case "app.bsky.feed.getPostThread":
        case "com.atproto.sync.getBlob":
            if (ctx.method !== expected) {
                return xrpcError(400, "InvalidRequest", "Incorrect HTTP method");
            }
            break;
        default:
            return xrpcError(501, "MethodNotImplemented", "Method Not Implemented");
    }

    switch (b) {
        case "com.atproto.server.createSession":
            return createSession(ctx);
        case "com.atproto.server.refreshSession":
            return refreshSession(ctx);
        case "com.atproto.server.deleteSession":
            return deleteSession(ctx);
        case "com.atproto.server.getSession":
            return getSession(ctx);
        case "com.atproto.identity.resolveHandle":
            return resolveHandle(ctx);
        case "app.bsky.actor.getProfile":
            return getProfile(ctx);
        case "com.atproto.repo.uploadBlob":
            return uploadBlob(ctx);
        case "com.atproto.repo.createRecord":
            return createRecord(ctx);
        case "com.atproto.repo.deleteRecord":
            return deleteRecord(ctx);
        case "app.bsky.feed.getPosts":
            return getPosts(ctx);
        case "app.bsky.feed.getPostThread":
            return getPostThread(ctx);
        default:
            return getBlob(ctx);
    }
}

function xrpcError(status: number, error: string, message: string): Response {
    return json({ error, message }, status);
}

function invalidRecord(message: string): Response {
    return xrpcError(400, "InvalidRequest", `Invalid app.bsky.feed.post record: ${message}`);
}

// ── Sessions ───────────────────────────────────────────────────────────────

/** The session behind the Authorization header, or the XRPC auth error. */
function authed(ctx: Ctx, kind: "access" | "refresh"): BskySession | Response {
    const token = bearerToken(ctx.req);
    if (!token) return xrpcError(401, "AuthMissing", "Authentication Required");
    const session = ctx.w.sessions.find(s =>
        kind === "access" ? s.accessJwt === token : s.refreshJwt === token
    );
    if (!session) {
        const wrongKind = ctx.w.sessions.some(s =>
            kind === "access" ? s.refreshJwt === token : s.accessJwt === token
        );
        return xrpcError(
            401,
            "InvalidToken",
            wrongKind ? "Bad token scope" : "Token could not be verified"
        );
    }
    if (session.revokedAt !== null) {
        return xrpcError(401, "InvalidToken", "Token has been revoked");
    }
    if (kind === "access" && session.accessExpiresAt <= ctx.now) {
        return xrpcError(400, "ExpiredToken", "Token has expired");
    }
    if (kind === "refresh" && (session.rotatedAt !== null || session.refreshExpiresAt <= ctx.now)) {
        return xrpcError(400, "ExpiredToken", "Token has been revoked");
    }
    return session;
}

function sessionBody(ctx: Ctx, session: BskySession): Record<string, unknown> {
    const account = accountByDid(session.did) ?? LAUNCHSTACK;
    return {
        accessJwt: session.accessJwt,
        refreshJwt: session.refreshJwt,
        handle: account.handle,
        did: account.did,
        didDoc: {
            "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/multikey/v1"],
            id: account.did,
            alsoKnownAs: [`at://${account.handle}`],
            service: [
                {
                    id: "#atproto_pds",
                    type: "AtprotoPersonalDataServer",
                    serviceEndpoint: `${ctx.origin}${BLUESKY_BASE_PATH}`,
                },
            ],
        },
        email: "brand@launchstack.example",
        emailConfirmed: true,
        emailAuthFactor: false,
        active: true,
    };
}

async function createSession(ctx: Ctx): Promise<Response> {
    const body = await readJson(ctx.req);
    if (!isRecord(body)) return xrpcError(400, "InvalidRequest", "Request body must be JSON");
    if (typeof body.identifier !== "string") {
        return xrpcError(400, "InvalidRequest", 'Input must have the property "identifier"');
    }
    if (typeof body.password !== "string") {
        return xrpcError(400, "InvalidRequest", 'Input must have the property "password"');
    }
    const identifier = body.identifier.trim().toLowerCase();
    const account =
        identifier === "brand@launchstack.example" ? LAUNCHSTACK : accountByActor(identifier);
    if (account?.did !== LAUNCHSTACK.did || !APP_PASSWORD.test(body.password)) {
        return xrpcError(401, "AuthenticationRequired", "Invalid identifier or password");
    }
    return json(sessionBody(ctx, openSession(ctx.w, account.did)));
}

function refreshSession(ctx: Ctx): Response {
    const session = authed(ctx, "refresh");
    if (session instanceof Response) return session;
    session.rotatedAt = ctx.now;
    return json(sessionBody(ctx, openSession(ctx.w, session.did)));
}

function deleteSession(ctx: Ctx): Response {
    const session = authed(ctx, "refresh");
    if (session instanceof Response) return session;
    session.revokedAt = ctx.now;
    return new Response(null, { status: 200 });
}

function getSession(ctx: Ctx): Response {
    const session = authed(ctx, "access");
    if (session instanceof Response) return session;
    const account = accountByDid(session.did) ?? LAUNCHSTACK;
    return json({
        handle: account.handle,
        did: account.did,
        email: "brand@launchstack.example",
        emailConfirmed: true,
        active: true,
    });
}

function resolveHandle(ctx: Ctx): Response {
    const handle = ctx.url.searchParams.get("handle");
    if (!handle) {
        return xrpcError(400, "InvalidRequest", 'Error: Params must have the property "handle"');
    }
    const account = accountByActor(handle);
    return account
        ? json({ did: account.did })
        : xrpcError(400, "InvalidRequest", "Unable to resolve handle");
}

// ── Profiles and posts (AppView) ───────────────────────────────────────────

function avatarUrl(ctx: Ctx, did: string): string {
    return `${ctx.origin}${avatarPath(did)}`;
}

function profileBasic(ctx: Ctx, account: BskyAccount): Record<string, unknown> {
    return {
        did: account.did,
        handle: account.handle,
        displayName: account.displayName,
        avatar: avatarUrl(ctx, account.did),
        labels: [],
        createdAt: "2024-03-01T00:00:00.000Z",
    };
}

function getProfile(ctx: Ctx): Response {
    // A PDS proxies this with the caller's session; the public AppView takes
    // it anonymously. Both live at this URL, so a header is checked when sent.
    if (ctx.req.headers.has("authorization")) {
        const session = authed(ctx, "access");
        if (session instanceof Response) return session;
    }
    const actor = ctx.url.searchParams.get("actor");
    if (!actor) {
        return xrpcError(400, "InvalidRequest", 'Error: Params must have the property "actor"');
    }
    const account = accountByActor(actor);
    if (!account) return xrpcError(400, "InvalidRequest", "Profile not found");
    const postsCount = ctx.w.posts.filter(
        p => p.authorDid === account.did && isVisible(p, ctx.now)
    ).length;
    return json({
        ...profileBasic(ctx, account),
        description: account.description,
        followersCount: account.followersCount,
        followsCount: account.followsCount,
        postsCount,
        indexedAt: "2024-03-01T00:00:00.000Z",
        associated: { lists: 0, feedgens: 0, starterPacks: 0, labeler: false },
        viewer: { muted: false, blockedBy: false },
    });
}

function postView(ctx: Ctx, post: BskyPost): Record<string, unknown> {
    const author = accountByDid(post.authorDid);
    const counts = postCounts(ctx.w, post, ctx.now);
    return {
        uri: post.uri,
        cid: post.cid,
        author: author ? profileBasic(ctx, author) : { did: post.authorDid, handle: "unknown" },
        record: post.record,
        ...(post.images.length > 0
            ? {
                  embed: {
                      $type: "app.bsky.embed.images#view",
                      images: post.images.map(img => ({
                          thumb: `${ctx.origin}${blobImagePath("feed_thumbnail", post.authorDid, img.cid)}`,
                          fullsize: `${ctx.origin}${blobImagePath("feed_fullsize", post.authorDid, img.cid)}`,
                          alt: img.alt,
                      })),
                  },
              }
            : {}),
        ...counts,
        indexedAt: new Date(post.createdAt).toISOString(),
        labels: [],
        viewer: { threadMuted: false, embeddingDisabled: false },
    };
}

function getPosts(ctx: Ctx): Response {
    const uris = ctx.url.searchParams.getAll("uris");
    if (uris.length === 0) {
        return xrpcError(400, "InvalidRequest", 'Error: Params must have the property "uris"');
    }
    if (uris.length > 25) {
        return xrpcError(400, "InvalidRequest", "Error: uris must not have more than 25 elements");
    }
    const posts = uris
        .map(uri => findBskyPost(ctx.w, uri))
        .filter((p): p is BskyPost => p !== undefined && isVisible(p, ctx.now))
        .map(p => postView(ctx, p));
    return json({ posts });
}

const THREAD_VIEW = "app.bsky.feed.defs#threadViewPost";

function threadReplies(ctx: Ctx, post: BskyPost, depth: number): Record<string, unknown> {
    return {
        $type: THREAD_VIEW,
        post: postView(ctx, post),
        ...(depth > 0
            ? {
                  replies: directReplies(ctx.w, post, ctx.now).map(r =>
                      threadReplies(ctx, r, depth - 1)
                  ),
              }
            : {}),
    };
}

function threadParent(ctx: Ctx, ref: StrongRef, height: number): Record<string, unknown> {
    const parent = findBskyPost(ctx.w, ref.uri);
    if (!parent || !isVisible(parent, ctx.now)) {
        return { $type: "app.bsky.feed.defs#notFoundPost", uri: ref.uri, notFound: true };
    }
    return {
        $type: THREAD_VIEW,
        post: postView(ctx, parent),
        ...(parent.reply && height > 1
            ? { parent: threadParent(ctx, parent.reply.parent, height - 1) }
            : {}),
    };
}

function getPostThread(ctx: Ctx): Response {
    const uri = ctx.url.searchParams.get("uri");
    if (!uri) {
        return xrpcError(400, "InvalidRequest", 'Error: Params must have the property "uri"');
    }
    const depth = Math.min(1000, Number(ctx.url.searchParams.get("depth") ?? 6) || 0);
    const parentHeight = Math.min(
        1000,
        Number(ctx.url.searchParams.get("parentHeight") ?? 80) || 0
    );
    const post = findBskyPost(ctx.w, uri);
    if (!post || !isVisible(post, ctx.now)) {
        return xrpcError(400, "NotFound", `Post not found: ${uri}`);
    }
    const thread = threadReplies(ctx, post, depth);
    if (post.reply && parentHeight > 0) {
        thread.parent = threadParent(ctx, post.reply.parent, parentHeight);
    }
    return json({ thread });
}

// ── Repo writes (PDS) ──────────────────────────────────────────────────────

function sniffMime(data: Uint8Array): string | null {
    const starts = (...sig: number[]) => sig.every((b, i) => data[i] === b);
    if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
    if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
    if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
    if (starts(0x52, 0x49, 0x46, 0x46) && data[8] === 0x57 && data[9] === 0x45) {
        return "image/webp";
    }
    return null;
}

async function uploadBlob(ctx: Ctx): Promise<Response> {
    const session = authed(ctx, "access");
    if (session instanceof Response) return session;
    const data = new Uint8Array(await ctx.req.arrayBuffer());
    if (data.byteLength === 0) return xrpcError(400, "InvalidRequest", "Request body is empty");
    if (data.byteLength > MAX_BLOB_BYTES) {
        return xrpcError(
            400,
            "BlobTooLarge",
            `This file is too large. It is ${(data.byteLength / 1024).toFixed(2)}KB but the maximum size is ${(MAX_BLOB_BYTES / 1024).toFixed(2)}KB.`
        );
    }
    const declared = ctx.req.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    const mimeType =
        declared && declared !== "*/*" && declared !== "application/octet-stream"
            ? declared
            : (sniffMime(data) ?? "application/octet-stream");
    const blob = storeBlob(ctx.w, session.did, data, mimeType);
    return json({
        blob: { $type: "blob", ref: { $link: blob.cid }, mimeType: blob.mimeType, size: blob.size },
    });
}

function graphemes(text: string): number {
    const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
    return [...segmenter.segment(text)].length;
}

function blobCid(ref: unknown): { cid: string; mimeType: string | null } | null {
    if (!isRecord(ref)) return null;
    // Typed blob ref, or the legacy untyped { cid, mimeType }.
    if (ref.$type === "blob" && isRecord(ref.ref) && typeof ref.ref.$link === "string") {
        return {
            cid: ref.ref.$link,
            mimeType: typeof ref.mimeType === "string" ? ref.mimeType : null,
        };
    }
    if (typeof ref.cid === "string") {
        return { cid: ref.cid, mimeType: typeof ref.mimeType === "string" ? ref.mimeType : null };
    }
    return null;
}

function strongRef(value: unknown, path: string): StrongRef | string {
    if (!isRecord(value)) return `${path} must be an object`;
    if (typeof value.uri !== "string") return `${path} must have the property "uri"`;
    if (typeof value.cid !== "string") return `${path} must have the property "cid"`;
    if (!value.uri.startsWith("at://")) return `${path}/uri must be a valid at-uri`;
    return { uri: value.uri, cid: value.cid };
}

interface CheckedPost {
    text: string;
    reply: { root: StrongRef; parent: StrongRef } | null;
    images: BskyPost["images"];
}

/** The app.bsky.feed.post lexicon, as far as a posting client can trip it. */
function checkPostRecord(
    ctx: Ctx,
    did: string,
    record: Record<string, unknown>
): CheckedPost | Response {
    if (record.$type !== undefined && record.$type !== "app.bsky.feed.post") {
        return invalidRecord("Record/$type must be app.bsky.feed.post");
    }
    if (typeof record.text !== "string") {
        return invalidRecord('Record must have the property "text"');
    }
    if (graphemes(record.text) > MAX_POST_GRAPHEMES) {
        return invalidRecord(`Record/text must not be longer than ${MAX_POST_GRAPHEMES} graphemes`);
    }
    if (new TextEncoder().encode(record.text).byteLength > 3000) {
        return invalidRecord("Record/text must not be longer than 3000 characters");
    }
    if (typeof record.createdAt !== "string") {
        return invalidRecord('Record must have the property "createdAt"');
    }
    if (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(
            record.createdAt
        ) ||
        Number.isNaN(Date.parse(record.createdAt))
    ) {
        return invalidRecord(
            "Record/createdAt must be an valid atproto datetime (both RFC-3339 and ISO-8601)"
        );
    }
    if (record.langs !== undefined) {
        if (!Array.isArray(record.langs) || record.langs.some(l => typeof l !== "string")) {
            return invalidRecord("Record/langs must be an array of language codes");
        }
        if (record.langs.length > 3) {
            return invalidRecord("Record/langs must not have more than 3 elements");
        }
    }
    if (record.facets !== undefined) {
        if (!Array.isArray(record.facets)) return invalidRecord("Record/facets must be an array");
        const textBytes = new TextEncoder().encode(record.text).byteLength;
        for (const [i, facet] of record.facets.entries()) {
            const index = isRecord(facet) ? facet.index : undefined;
            if (
                !isRecord(index) ||
                typeof index.byteStart !== "number" ||
                typeof index.byteEnd !== "number"
            ) {
                return invalidRecord(`Record/facets/${i}/index must have byteStart and byteEnd`);
            }
            if (index.byteEnd > textBytes || index.byteStart > index.byteEnd) {
                return invalidRecord(`Record/facets/${i}/index is outside the text`);
            }
            if (!isRecord(facet) || !Array.isArray(facet.features)) {
                return invalidRecord(`Record/facets/${i} must have the property "features"`);
            }
        }
    }

    let reply: CheckedPost["reply"] = null;
    if (record.reply !== undefined) {
        if (!isRecord(record.reply)) return invalidRecord("Record/reply must be an object");
        const root = strongRef(record.reply.root, "Record/reply/root");
        if (typeof root === "string") return invalidRecord(root);
        const parent = strongRef(record.reply.parent, "Record/reply/parent");
        if (typeof parent === "string") return invalidRecord(parent);
        reply = { root, parent };
    }

    const images: BskyPost["images"] = [];
    if (record.embed !== undefined) {
        const embed = record.embed;
        if (!isRecord(embed)) return invalidRecord("Record/embed must be an object");
        if (embed.$type === "app.bsky.embed.images") {
            if (!Array.isArray(embed.images)) {
                return invalidRecord('Record/embed must have the property "images"');
            }
            if (embed.images.length > 4) {
                return invalidRecord("Record/embed/images must not have more than 4 elements");
            }
            for (const [i, item] of embed.images.entries()) {
                const path = `Record/embed/images/${i}`;
                if (!isRecord(item)) return invalidRecord(`${path} must be an object`);
                if (typeof item.alt !== "string") {
                    return invalidRecord(`${path} must have the property "alt"`);
                }
                const ref = blobCid(item.image);
                if (!ref) return invalidRecord(`${path}/image should be a blob ref`);
                const blob = ctx.w.blobs[ref.cid];
                if (blob?.did !== did) {
                    return xrpcError(400, "InvalidRequest", `Could not find blob: ${ref.cid}`);
                }
                if (ref.mimeType && ref.mimeType !== blob.mimeType) {
                    return xrpcError(
                        400,
                        "InvalidRequest",
                        `Referenced Mimetype does not match stored blob. Expected: ${blob.mimeType}, Got: ${ref.mimeType}`
                    );
                }
                if (!blob.mimeType.startsWith("image/")) {
                    return invalidRecord(`${path}/image mimeType ${blob.mimeType} is not an image`);
                }
                images.push({ cid: blob.cid, alt: item.alt, mimeType: blob.mimeType });
            }
        } else if (embed.$type === "app.bsky.embed.external") {
            const external = embed.external;
            if (
                !isRecord(external) ||
                typeof external.uri !== "string" ||
                typeof external.title !== "string" ||
                typeof external.description !== "string"
            ) {
                return invalidRecord("Record/embed/external must have uri, title and description");
            }
        } else if (
            embed.$type !== "app.bsky.embed.record" &&
            embed.$type !== "app.bsky.embed.recordWithMedia"
        ) {
            return invalidRecord(
                "Record/embed $type must be one of lex:app.bsky.embed.images, lex:app.bsky.embed.external, lex:app.bsky.embed.record, lex:app.bsky.embed.recordWithMedia"
            );
        }
    }
    return { text: record.text, reply, images };
}

async function createRecord(ctx: Ctx): Promise<Response> {
    const session = authed(ctx, "access");
    if (session instanceof Response) return session;
    const body = await readJson(ctx.req);
    if (!isRecord(body)) return xrpcError(400, "InvalidRequest", "Request body must be JSON");
    if (typeof body.repo !== "string") {
        return xrpcError(400, "InvalidRequest", 'Input must have the property "repo"');
    }
    const repo = accountByActor(body.repo);
    if (repo?.did !== session.did) {
        return xrpcError(400, "InvalidRequest", "Repo does not match the authenticated account");
    }
    if (typeof body.collection !== "string") {
        return xrpcError(400, "InvalidRequest", 'Input must have the property "collection"');
    }
    if (body.collection !== "app.bsky.feed.post") {
        return xrpcError(
            400,
            "InvalidRequest",
            `The stand-in accepts app.bsky.feed.post records only, not ${body.collection}`
        );
    }
    if (!isRecord(body.record)) {
        return xrpcError(400, "InvalidRequest", 'Input must have the property "record"');
    }
    const checked = checkPostRecord(ctx, session.did, body.record);
    if (checked instanceof Response) return checked;
    const post = createPostRecord(ctx.w, session.did, body.record, {
        ...checked,
        origin: "api",
    });
    return json({
        uri: post.uri,
        cid: post.cid,
        commit: { cid: cidFor(`commit:${post.uri}`, "dag-cbor"), rev: post.rkey },
        validationStatus: "valid",
    });
}

async function deleteRecord(ctx: Ctx): Promise<Response> {
    const session = authed(ctx, "access");
    if (session instanceof Response) return session;
    const body = await readJson(ctx.req);
    if (!isRecord(body) || typeof body.rkey !== "string" || typeof body.collection !== "string") {
        return xrpcError(400, "InvalidRequest", "Input must have repo, collection and rkey");
    }
    const post = ctx.w.posts.find(p => p.authorDid === session.did && p.rkey === body.rkey);
    if (post) post.deletedAt ??= ctx.now;
    return json({
        commit: { cid: cidFor(`delete:${String(body.rkey)}`, "dag-cbor"), rev: String(body.rkey) },
    });
}

// ── Media ──────────────────────────────────────────────────────────────────

function getBlob(ctx: Ctx): Response {
    const cid = ctx.url.searchParams.get("cid") ?? "";
    const blob = ctx.w.blobs[cid];
    if (!blob) return xrpcError(400, "BlobNotFound", "Blob not found");
    return bytes(blob.data, blob.mimeType);
}

/** /img/<preset>/plain/<did>/<cid>@<format> — the CDN path shape. */
function image(ctx: Ctx): Response {
    const [, preset, , did, file] = ctx.segs;
    if (!preset || !did || !file) return xrpcError(404, "NotFound", "Not Found");
    if (preset === "avatar") {
        const svg = avatarSvg(did);
        return svg
            ? bytes(new TextEncoder().encode(svg), "image/svg+xml")
            : xrpcError(404, "NotFound", "Not Found");
    }
    const blob = ctx.w.blobs[file.split("@")[0] ?? ""];
    return blob ? bytes(blob.data, blob.mimeType) : xrpcError(404, "NotFound", "Not Found");
}

// ── Page controls ──────────────────────────────────────────────────────────

async function control(ctx: Ctx, action: string | undefined): Promise<Response> {
    if (action === "state" && ctx.method === "GET") return json(blueskySnapshot(ctx.w));
    if (action !== "action" || ctx.method !== "POST") {
        return xrpcError(404, "NotFound", "Not Found");
    }
    const body = await readJson(ctx.req);
    if (!isRecord(body)) return json({ error: "Expected a JSON body" }, 400);
    let w = ctx.w;
    switch (body.action) {
        case "reset":
            w = resetBlueskyWorld();
            break;
        case "revoke-sessions":
            revokeSessions(w);
            break;
        case "expire-access":
            expireAccessTokens(w);
            break;
        case "age":
            ageWorld(w, typeof body.minutes === "number" ? body.minutes : 60);
            break;
        case "reply": {
            const post = typeof body.uri === "string" ? findBskyPost(w, body.uri) : undefined;
            if (!post) return json({ error: "Unknown post" }, 404);
            addFakeReply(w, post, {
                origin: "page",
                text: typeof body.text === "string" ? body.text : undefined,
            });
            break;
        }
        default:
            return json({ error: `Unknown action ${String(body.action)}` }, 400);
    }
    return json(blueskySnapshot(w));
}
