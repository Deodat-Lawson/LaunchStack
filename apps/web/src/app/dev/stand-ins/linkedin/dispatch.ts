/**
 * HTTP surface of the LinkedIn stand-in. `handleLinkedInRequest` takes a
 * standard Request whose path sits under `/dev/stand-ins/linkedin` and
 * answers the way LinkedIn's OAuth host (`www.linkedin.com/oauth/v2`) and
 * API host (`api.linkedin.com` — `/v2/*` and versioned `/rest/*`) do, per
 * the shapes on learn.microsoft.com/linkedin.
 *
 * Point an app at it with
 *   LINKEDIN_OAUTH_BASE_URL=<origin>/dev/stand-ins/linkedin/oauth/v2
 *   LINKEDIN_API_BASE_URL=<origin>/dev/stand-ins/linkedin
 *
 * The consent screen itself (GET …/oauth/v2/authorization) is a page —
 * ../oauth/v2/authorization/page.tsx — that posts its decision to
 * …/oauth/v2/consent here.
 */
import {
    bearerToken,
    bytes,
    displayPath,
    empty,
    isRecord,
    json,
    originOf,
    pushCall,
    rawQueryParam,
    readForm,
    readJson,
    redirect,
    segmentsAfter,
} from "../shared/http";
import { signJwt } from "../shared/ids";
import { standInClock } from "../shared/store";
import {
    ACCESS_TOKEN_TTL_S,
    ACLS,
    DANA,
    LINKEDIN_BASE_PATH,
    OLDEST_ACTIVE_VERSION,
    addComment,
    addFakeComment,
    ageWorld,
    approveAuthorization,
    cancelAuthorization,
    checkAuthorizationRequest,
    commentUrn,
    createPost,
    expireAccessTokens,
    findPost,
    followerCount,
    hasActivity,
    imageUrn,
    isVisible,
    issueTokens,
    linkedInSnapshot,
    linkedInWorld,
    livePosts,
    memberById,
    memberPictureSvg,
    newImage,
    orgById,
    orgUrn,
    parseCommentUrn,
    parseImageUrn,
    parseOrgUrn,
    parsePersonUrn,
    personUrn,
    postStats,
    resetLinkedInWorld,
    revokeAllTokens,
    roleOf,
    tokenStatus,
    type LiComment,
    type LiImage,
    type LiOrg,
    type LiPost,
    type LiState,
    type LiToken,
    type ShareStatistics,
} from "./world";

interface Ctx {
    req: Request;
    url: URL;
    method: string;
    segs: string[];
    origin: string;
    w: LiState;
    now: number;
}

type Api = Ctx & { token: LiToken; version: string };

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export async function handleLinkedInRequest(req: Request): Promise<Response> {
    const segs = segmentsAfter(req, LINKEDIN_BASE_PATH);
    const ctx: Ctx = {
        req,
        url: new URL(req.url),
        method: req.method.toUpperCase(),
        segs,
        origin: originOf(req),
        w: linkedInWorld(),
        now: standInClock.now(),
    };
    let res: Response;
    try {
        res = await route(ctx);
    } catch (err) {
        res = json({ status: 500, message: err instanceof Error ? err.message : String(err) }, 500);
    }
    // The page's own polling and image loads would drown the log.
    if (segs[0] !== "_standin" && segs[0] !== "assets") {
        pushCall(linkedInWorld().calls, {
            at: ctx.now,
            method: ctx.method,
            path: displayPath(req, LINKEDIN_BASE_PATH),
            status: res.status,
        });
    }
    return res;
}

async function route(ctx: Ctx): Promise<Response> {
    const [a, b, c, d, e] = ctx.segs;
    const { method } = ctx;

    if (a === "oauth" && b === "v2") {
        if (c === "accessToken" && method === "POST") return accessToken(ctx);
        if (c === "revoke" && method === "POST") return revoke(ctx);
        if (c === "introspectToken" && method === "POST") return introspect(ctx);
        if (c === "consent" && method === "POST") return consent(ctx);
        return notFound();
    }

    if (a === "_standin") return control(ctx, b);
    if (a === "assets" && b && method === "GET") return asset(ctx, b);
    if (a === "upload" && b && (method === "PUT" || method === "POST")) return upload(ctx, b);

    if (a === "v2") {
        const token = authenticate(ctx);
        if (token instanceof Response) return token;
        if (b === "userinfo" && method === "GET") return userinfo(ctx, token);
        if (b === "me" && method === "GET") return me(token);
        return notFound();
    }

    if (a === "rest") {
        const token = authenticate(ctx);
        if (token instanceof Response) return token;
        const version = checkVersion(ctx);
        if (version instanceof Response) return version;
        const api: Api = { ...ctx, token, version };
        switch (b) {
            case "organizationAcls":
                if (!c && method === "GET") return organizationAcls(api);
                break;
            case "organizations":
                if (method === "GET") return c ? organization(api, c) : organizationsQuery(api);
                break;
            case "images":
                if (method === "GET") return c ? image(api, c) : imagesBatch(api);
                if (!c && method === "POST") return initializeUpload(api);
                break;
            case "posts":
                if (!c && method === "POST") return createPostRoute(api);
                if (c && method === "GET") return getPost(api, c);
                if (c && method === "DELETE") return deletePost(api, c);
                break;
            case "organizationalEntityShareStatistics":
                if (!c && method === "GET") return shareStatistics(api);
                break;
            case "networkSizes":
                if (c && method === "GET") return networkSize(api, c);
                break;
            case "socialActions":
                if (c && d === "comments") {
                    if (!e && method === "GET") return listComments(api, c);
                    if (!e && method === "POST") return createComment(api, c);
                    if (e && method === "DELETE") return deleteComment(api, c, e);
                }
                break;
        }
        return notFound();
    }

    return notFound();
}

// ── Errors ─────────────────────────────────────────────────────────────────

function notFound(): Response {
    return json({ status: 404, message: "No virtual resource found" }, 404);
}

function oauthError(status: number, error: string, description: string): Response {
    return json({ error, error_description: description }, status);
}

function forbidden(message: string): Response {
    return json({ status: 403, serviceErrorCode: 100, code: "ACCESS_DENIED", message }, 403);
}

/** Missing scope, in LinkedIn's wording: `Not enough permissions to access: posts.CREATE.20251001`. */
function missingScope(resource: string, op: string, version: string | null): Response {
    return forbidden(
        `Not enough permissions to access: ${resource}.${op}.${version ? `${version}01` : "NO_VERSION"}`
    );
}

type FieldErrorCode =
    | "MISSING_FIELD"
    | "INVALID_VALUE_FOR_FIELD"
    | "FIELD_LENGTH_TOO_LONG"
    | "INVALID_URN_TYPE";

function fieldError(code: FieldErrorCode, fieldPath: string, description: string): Response {
    return json(
        {
            status: 400,
            code,
            message: `${fieldPath} :: ${description}`,
            errorDetailType: "com.linkedin.common.error.BadRequest",
            errorDetails: {
                inputErrors: [{ code, description, input: { inputPath: { fieldPath } } }],
            },
        },
        400
    );
}

function hasAny(token: LiToken, scopes: string[]): boolean {
    return scopes.some(s => token.scopes.includes(s));
}

// ── Auth and versioning ────────────────────────────────────────────────────

function unauthorized(serviceErrorCode: number, code: string, message: string): Response {
    return json({ status: 401, serviceErrorCode, code, message }, 401);
}

function authenticate(ctx: Ctx): LiToken | Response {
    const value = bearerToken(ctx.req);
    if (!value) return unauthorized(401, "EMPTY_ACCESS_TOKEN", "Empty oauth2_access_token");
    const token = ctx.w.tokens.find(t => t.value === value && t.kind === "access");
    if (!token) return unauthorized(65600, "INVALID_ACCESS_TOKEN", "Invalid access token");
    const status = tokenStatus(token, ctx.now);
    if (status === "revoked") {
        return unauthorized(
            65600,
            "REVOKED_ACCESS_TOKEN",
            "The token used in the request has been revoked by the user"
        );
    }
    if (status === "expired") {
        return unauthorized(
            65601,
            "EXPIRED_ACCESS_TOKEN",
            "The token used in the request has expired"
        );
    }
    return token;
}

function currentVersion(now: number): string {
    const d = new Date(now);
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function checkVersion(ctx: Ctx): string | Response {
    const raw = ctx.req.headers.get("linkedin-version")?.trim();
    if (!raw) {
        return json(
            {
                status: 400,
                code: "VERSION_MISSING",
                message:
                    "A version must be present. Please specify a version by adding the LinkedIn-Version header.",
            },
            400
        );
    }
    if (!/^\d{6}(\.\d{2})?$/.test(raw)) {
        return json(
            {
                status: 400,
                code: "INVALID_VERSION",
                message: `Invalid version header value ${raw}; expected YYYYMM`,
            },
            400
        );
    }
    const month = raw.slice(0, 6);
    if (month < OLDEST_ACTIVE_VERSION || month > currentVersion(ctx.now)) {
        return json(
            {
                status: 426,
                code: "NONEXISTENT_VERSION",
                message: `Requested version ${raw} is not active`,
            },
            426
        );
    }
    return month;
}

// ── OAuth host ─────────────────────────────────────────────────────────────

const CODE_MISMATCH =
    "Unable to retrieve access token: appid/redirect uri/code verifier does not match authorization code. Or authorization code expired. Or external member binding exists";
const BAD_REFRESH =
    "The provided authorization grant or refresh token is invalid, expired or revoked";

function basicCredentials(req: Request): { id: string; secret: string } | null {
    const header = req.headers.get("authorization");
    const m = header ? /^Basic\s+(.+)$/i.exec(header.trim()) : null;
    if (!m) return null;
    const decoded = Buffer.from(m[1]!, "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    if (colon === -1) return null;
    return { id: decoded.slice(0, colon), secret: decoded.slice(colon + 1) };
}

/** client_id / client_secret from the form (LinkedIn's way) or HTTP Basic. */
function requireClient(
    req: Request,
    form: URLSearchParams
): { clientId: string; clientSecret: string } | Response {
    const basic = basicCredentials(req);
    const clientId = form.get("client_id") ?? basic?.id ?? "";
    const clientSecret = form.get("client_secret") ?? basic?.secret ?? "";
    if (!clientId) {
        return oauthError(400, "invalid_request", 'A required parameter "client_id" is missing');
    }
    if (!clientSecret) {
        return oauthError(
            400,
            "invalid_request",
            'A required parameter "client_secret" is missing'
        );
    }
    return { clientId, clientSecret };
}

/**
 * The stand-in has no app registry: the first secret presented for a
 * client_id becomes that app's secret, and a different one later is
 * `invalid_client` — which is what a mistyped env var looks like on LinkedIn.
 */
function authenticateClient(
    w: LiState,
    client: { clientId: string; clientSecret: string }
): Response | null {
    const registered = w.clients[client.clientId];
    if (registered === undefined) {
        w.clients[client.clientId] = client.clientSecret;
        return null;
    }
    return registered === client.clientSecret
        ? null
        : oauthError(401, "invalid_client", "Client authentication failed");
}

function requireParams(form: URLSearchParams, names: string[]): Response | null {
    for (const name of names) {
        if (!form.get(name)) {
            return oauthError(400, "invalid_request", `A required parameter "${name}" is missing`);
        }
    }
    return null;
}

async function accessToken(ctx: Ctx): Promise<Response> {
    const form = await readForm(ctx.req);
    const grantType = form.get("grant_type");
    if (!grantType) {
        return oauthError(400, "invalid_request", 'A required parameter "grant_type" is missing');
    }

    if (grantType === "authorization_code") {
        const missing = requireParams(form, ["code", "redirect_uri"]);
        if (missing) return missing;
        const client = requireClient(ctx.req, form);
        if (client instanceof Response) return client;
        const clientError = authenticateClient(ctx.w, client);
        if (clientError) return clientError;
        const code = ctx.w.codes[form.get("code")!];
        if (!code) {
            return oauthError(
                401,
                "invalid_request",
                "Unable to retrieve access token: authorization code not found"
            );
        }
        if (
            code.expiresAt <= ctx.now ||
            code.redirectUri !== form.get("redirect_uri") ||
            code.clientId !== client.clientId
        ) {
            return oauthError(400, "invalid_redirect_uri", CODE_MISMATCH);
        }
        delete ctx.w.codes[code.code];
        const { access, refresh } = issueTokens(ctx.w, code, null);
        const body: Record<string, unknown> = {
            access_token: access.value,
            expires_in: ACCESS_TOKEN_TTL_S,
            scope: access.scopes.join(","),
            token_type: "Bearer",
        };
        if (refresh) {
            body.refresh_token = refresh.value;
            body.refresh_token_expires_in = Math.floor((refresh.expiresAt - ctx.now) / 1000);
        }
        if (access.scopes.includes("openid")) {
            body.id_token = idToken(ctx, access, client.clientSecret);
        }
        return json(body);
    }

    if (grantType === "refresh_token") {
        const missing = requireParams(form, ["refresh_token"]);
        if (missing) return missing;
        const client = requireClient(ctx.req, form);
        if (client instanceof Response) return client;
        const clientError = authenticateClient(ctx.w, client);
        if (clientError) return clientError;
        const refresh = ctx.w.tokens.find(
            t => t.kind === "refresh" && t.value === form.get("refresh_token")
        );
        if (
            !refresh ||
            tokenStatus(refresh, ctx.now) !== "active" ||
            refresh.clientId !== client.clientId
        ) {
            return oauthError(400, "invalid_request", BAD_REFRESH);
        }
        const { access } = issueTokens(ctx.w, refresh, refresh);
        return json({
            access_token: access.value,
            expires_in: ACCESS_TOKEN_TTL_S,
            refresh_token: refresh.value,
            refresh_token_expires_in: Math.floor((refresh.expiresAt - ctx.now) / 1000),
            scope: access.scopes.join(","),
            token_type: "Bearer",
        });
    }

    return oauthError(400, "unsupported_grant_type", `grant_type "${grantType}" is not supported`);
}

function memberPictureUrl(ctx: Ctx, memberId: string): string {
    return `${ctx.origin}${LINKEDIN_BASE_PATH}/assets/member-${memberId}`;
}

function idToken(ctx: Ctx, access: LiToken, secret: string): string {
    const member = memberById(access.memberId) ?? DANA;
    const iat = Math.floor(ctx.now / 1000);
    return signJwt(
        { typ: "JWT", kid: "stand-in" },
        {
            iss: "https://www.linkedin.com/oauth",
            aud: access.clientId,
            iat,
            exp: iat + 3600,
            sub: member.id,
            name: `${member.firstName} ${member.lastName}`,
            given_name: member.firstName,
            family_name: member.lastName,
            picture: memberPictureUrl(ctx, member.id),
            email: member.email,
            email_verified: true,
            locale: "en-US",
        },
        secret
    );
}

async function revoke(ctx: Ctx): Promise<Response> {
    const form = await readForm(ctx.req);
    const missing = requireParams(form, ["token"]);
    if (missing) return missing;
    const client = requireClient(ctx.req, form);
    if (client instanceof Response) return client;
    const clientError = authenticateClient(ctx.w, client);
    if (clientError) return clientError;
    const token = ctx.w.tokens.find(t => t.value === form.get("token"));
    if (token?.clientId === client.clientId) {
        token.revokedAt ??= ctx.now;
        if (token.kind === "refresh") {
            for (const t of ctx.w.tokens) {
                if (t.refreshToken === token.value) t.revokedAt ??= ctx.now;
            }
        }
    }
    return empty(200);
}

async function introspect(ctx: Ctx): Promise<Response> {
    const form = await readForm(ctx.req);
    const missing = requireParams(form, ["token"]);
    if (missing) return missing;
    const client = requireClient(ctx.req, form);
    if (client instanceof Response) return client;
    const clientError = authenticateClient(ctx.w, client);
    if (clientError) return clientError;
    const token = ctx.w.tokens.find(t => t.value === form.get("token"));
    if (token?.clientId !== client.clientId) return json({ active: false });
    const status = tokenStatus(token, ctx.now);
    return json({
        active: status === "active",
        client_id: token.clientId,
        authorized_at: Math.floor(token.issuedAt / 1000),
        created_at: Math.floor(token.issuedAt / 1000),
        status,
        expires_at: Math.floor(token.expiresAt / 1000),
        scope: token.scopes.join(","),
        auth_type: "3L",
    });
}

/** The consent page's Allow / Cancel. */
async function consent(ctx: Ctx): Promise<Response> {
    const form = await readForm(ctx.req);
    const params = new URLSearchParams({
        response_type: "code",
        client_id: form.get("client_id") ?? "",
        redirect_uri: form.get("redirect_uri") ?? "",
        scope: form.get("scope") ?? "",
    });
    const state = form.get("state");
    if (state !== null) params.set("state", state);
    const check = checkAuthorizationRequest(params);
    if (!check.ok) {
        return check.kind === "redirect"
            ? redirect(check.location)
            : new Response(check.message, { status: 400 });
    }
    if (form.get("decision") === "allow") return redirect(approveAuthorization(ctx.w, check));
    return redirect(cancelAuthorization(check.redirectUri, check.state));
}

// ── /v2 (member identity) ──────────────────────────────────────────────────

function userinfo(ctx: Ctx, token: LiToken): Response {
    if (!token.scopes.includes("openid")) return missingScope("userinfo", "GET", null);
    const member = memberById(token.memberId) ?? DANA;
    const body: Record<string, unknown> = { sub: member.id };
    if (token.scopes.includes("profile")) {
        Object.assign(body, {
            name: `${member.firstName} ${member.lastName}`,
            given_name: member.firstName,
            family_name: member.lastName,
            picture: memberPictureUrl(ctx, member.id),
            // The docs show "en-US"; the live endpoint answers with this object.
            locale: { country: "US", language: "en" },
        });
    }
    if (token.scopes.includes("email")) {
        Object.assign(body, { email: member.email, email_verified: true });
    }
    return json(body);
}

function me(token: LiToken): Response {
    if (!hasAny(token, ["r_basicprofile", "r_liteprofile", "profile"])) {
        return missingScope("me", "GET", null);
    }
    const member = memberById(token.memberId) ?? DANA;
    const localized = (value: string) => ({
        localized: { en_US: value },
        preferredLocale: { country: "US", language: "en" },
    });
    return json({
        id: member.id,
        localizedFirstName: member.firstName,
        localizedLastName: member.lastName,
        firstName: localized(member.firstName),
        lastName: localized(member.lastName),
        ...(token.scopes.includes("r_basicprofile") ? { vanityName: member.vanityName } : {}),
    });
}

// ── Organizations ──────────────────────────────────────────────────────────

function wantsDecoration(ctx: Ctx, field: string): boolean {
    return (ctx.url.searchParams.get("projection") ?? "").includes(`${field}~`);
}

function downloadUrl(ctx: Ctx, imageId: string): string {
    return `${ctx.origin}${LINKEDIN_BASE_PATH}/assets/${imageId}`;
}

function organizationJson(ctx: Ctx, org: LiOrg): Record<string, unknown> {
    // Organization lookup names the logo as a digitalmediaAsset; the Images
    // API resolves the same id as urn:li:image.
    const assetUrn = `urn:li:digitalmediaAsset:${org.logoImageId}`;
    const logoV2: Record<string, unknown> = {
        original: assetUrn,
        cropped: assetUrn,
        cropInfo: { x: 0, y: 0, width: 0, height: 0 },
    };
    if (wantsDecoration(ctx, "original")) {
        logoV2["original~"] = {
            elements: [
                {
                    identifiers: [
                        {
                            identifier: downloadUrl(ctx, org.logoImageId),
                            identifierType: "EXTERNAL_URL",
                            mediaType: "image/svg+xml",
                        },
                    ],
                },
            ],
        };
    }
    return {
        $URN: orgUrn(org.id),
        id: Number(org.id),
        localizedName: org.name,
        name: {
            localized: { en_US: org.name },
            preferredLocale: { country: "US", language: "en" },
        },
        vanityName: org.vanityName,
        localizedWebsite: `https://${org.vanityName}.example`,
        organizationType: "PRIVATELY_HELD",
        primaryOrganizationType: "NONE",
        logoV2,
    };
}

function organizationAcls(api: Api): Response {
    if (!hasAny(api.token, ["rw_organization_admin", "r_organization_admin"])) {
        return missingScope("organizationAcls", "FINDER-roleAssignee", api.version);
    }
    const q = api.url.searchParams.get("q");
    if (q !== "roleAssignee") {
        return json(
            {
                status: 400,
                message: `Invalid finder "${q ?? ""}"; this stand-in supports q=roleAssignee`,
            },
            400
        );
    }
    const role = api.url.searchParams.get("role");
    const state = api.url.searchParams.get("state");
    const start = Number(api.url.searchParams.get("start") ?? 0) || 0;
    const count = Number(api.url.searchParams.get("count") ?? 10) || 10;
    const decorate =
        wantsDecoration(api, "organization") || wantsDecoration(api, "organizationTarget");
    const all = ACLS.filter(
        a =>
            a.memberId === api.token.memberId &&
            (!role || a.role === role) &&
            (!state || state === "APPROVED")
    );
    const elements = all.slice(start, start + count).map(a => {
        const org = orgById(a.orgId)!;
        return {
            organization: orgUrn(org.id),
            organizationTarget: orgUrn(org.id),
            ...(decorate ? { "organization~": organizationJson(api, org) } : {}),
            role: a.role,
            roleAssignee: personUrn(a.memberId),
            state: "APPROVED",
        };
    });
    return json({ paging: { start, count, links: [], total: all.length }, elements });
}

function organization(api: Api, id: string): Response {
    const org = orgById(parseOrgUrn(id) ?? id);
    if (!org) return json({ status: 404, message: `Organization ${id} not found` }, 404);
    return json(organizationJson(api, org));
}

/** `?ids=List(1,2)` batch get, or `?q=vanityName&vanityName=x`. */
function organizationsQuery(api: Api): Response {
    const ids = parseRestliList(rawQueryParam(api.req, "ids"));
    if (ids) {
        const results: Record<string, unknown> = {};
        const statuses: Record<string, number> = {};
        const errors: Record<string, unknown> = {};
        for (const raw of ids) {
            const org = orgById(parseOrgUrn(raw) ?? raw);
            if (org) {
                results[raw] = organizationJson(api, org);
                statuses[raw] = 200;
            } else {
                statuses[raw] = 404;
                errors[raw] = { status: 404, message: "Not Found" };
            }
        }
        return json({ results, statuses, errors });
    }
    if (api.url.searchParams.get("q") === "vanityName") {
        const vanity = api.url.searchParams.get("vanityName");
        const elements = [...new Set(ACLS.map(a => a.orgId))]
            .map(id => orgById(id)!)
            .filter(o => o.vanityName === vanity)
            .map(o => organizationJson(api, o));
        return json({ paging: { start: 0, count: 10, links: [] }, elements });
    }
    return json({ status: 400, message: "Expected ids=List(...) or q=vanityName" }, 400);
}

function networkSize(api: Api, urn: string): Response {
    const edgeType = api.url.searchParams.get("edgeType");
    if (edgeType !== "COMPANY_FOLLOWED_BY_MEMBER") {
        return json(
            {
                status: 400,
                message: `Invalid edgeType "${edgeType ?? ""}"; expected COMPANY_FOLLOWED_BY_MEMBER`,
            },
            400
        );
    }
    const orgId = parseOrgUrn(urn);
    if (!orgId) return json({ status: 400, message: `${urn} is not an organization URN` }, 400);
    if (!orgById(orgId)) return json({ status: 404, message: "Not Found" }, 404);
    return json({ firstDegreeSize: followerCount(api.w, orgId) });
}

// ── Images ─────────────────────────────────────────────────────────────────

function imageJson(ctx: Ctx, img: LiImage): Record<string, unknown> {
    return {
        owner: img.ownerUrn,
        status: img.status,
        id: imageUrn(img.id),
        ...(img.status === "AVAILABLE"
            ? {
                  downloadUrl: downloadUrl(ctx, img.id),
                  downloadUrlExpiresAt: ctx.now + 60 * 60 * 1000,
              }
            : {}),
    };
}

function image(api: Api, urn: string): Response {
    const id = parseImageUrn(urn);
    const img = id ? api.w.images[id] : undefined;
    if (!img) return json({ status: 404, message: `Image ${urn} not found` }, 404);
    return json(imageJson(api, img));
}

function imagesBatch(api: Api): Response {
    const ids = parseRestliList(rawQueryParam(api.req, "ids"));
    if (!ids) return json({ status: 400, message: "Expected ids=List(...)" }, 400);
    const results: Record<string, unknown> = {};
    const errors: Record<string, unknown> = {};
    for (const urn of ids) {
        const id = parseImageUrn(urn);
        const img = id ? api.w.images[id] : undefined;
        if (img) results[urn] = imageJson(api, img);
        else errors[urn] = { status: 404, message: "Not Found" };
    }
    return json({ results, errors });
}

const WRITE_SCOPES = {
    org: ["w_organization_social", "w_organization_social_feed"],
    person: ["w_member_social", "w_member_social_feed"],
};

/** May this token act as `actorUrn`? null when allowed, else the 403/400. */
function checkActor(
    api: Api,
    actorUrn: string,
    resource: string,
    op: string,
    fieldPath: string
): Response | null {
    const orgId = parseOrgUrn(actorUrn);
    if (orgId) {
        if (!hasAny(api.token, WRITE_SCOPES.org)) return missingScope(resource, op, api.version);
        if (!orgById(orgId) || !roleOf(api.token.memberId, orgId)) {
            return forbidden(
                `Member ${personUrn(api.token.memberId)} has no role that permits ${resource}.${op} for ${actorUrn}`
            );
        }
        return null;
    }
    const personId = parsePersonUrn(actorUrn);
    if (personId) {
        if (!hasAny(api.token, WRITE_SCOPES.person)) {
            return missingScope(resource, op, api.version);
        }
        if (personId !== api.token.memberId) {
            return forbidden(`${actorUrn} is not the authenticated member`);
        }
        return null;
    }
    return fieldError(
        "INVALID_URN_TYPE",
        fieldPath,
        `${actorUrn} must be an urn:li:person or urn:li:organization`
    );
}

async function initializeUpload(api: Api): Promise<Response> {
    if (api.url.searchParams.get("action") !== "initializeUpload") {
        return json({ status: 400, message: "Expected ?action=initializeUpload" }, 400);
    }
    const body = await readJson(api.req);
    const request = isRecord(body) ? body.initializeUploadRequest : undefined;
    const owner = isRecord(request) ? request.owner : undefined;
    if (typeof owner !== "string" || !owner) {
        return fieldError(
            "MISSING_FIELD",
            "/initializeUploadRequest/owner",
            "owner is a required field"
        );
    }
    const denied = checkActor(
        api,
        owner,
        "images",
        "ACTION-initializeUpload",
        "/initializeUploadRequest/owner"
    );
    if (denied) return denied;
    const img = newImage(api.w, owner);
    return json({
        value: {
            uploadUrlExpiresAt: img.uploadUrlExpiresAt,
            uploadUrl: `${api.origin}${LINKEDIN_BASE_PATH}/upload/${img.id}`,
            image: imageUrn(img.id),
        },
    });
}

function sniffImageType(data: Uint8Array): string | null {
    const starts = (...sig: number[]) => sig.every((b, i) => data[i] === b);
    if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
    if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
    if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
    if (starts(0x52, 0x49, 0x46, 0x46) && data[8] === 0x57 && data[9] === 0x45) {
        return "image/webp";
    }
    return null;
}

async function upload(ctx: Ctx, imageId: string): Promise<Response> {
    // LinkedIn's image upload URL wants the bearer token too (videos do not).
    const token = authenticate(ctx);
    if (token instanceof Response) return token;
    const img = ctx.w.images[imageId];
    if (!img) return notFound();
    const data = new Uint8Array(await ctx.req.arrayBuffer());
    if (data.byteLength === 0) return json({ status: 400, message: "Empty upload body" }, 400);
    if (data.byteLength > MAX_UPLOAD_BYTES) {
        return json({ status: 413, message: "Upload exceeds 20 MB" }, 413);
    }
    const declared = ctx.req.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    img.data = data;
    img.contentType =
        declared && declared !== "application/octet-stream"
            ? declared
            : (sniffImageType(data) ?? "application/octet-stream");
    img.status = "AVAILABLE";
    return empty(201);
}

function asset(ctx: Ctx, id: string): Response {
    if (id.startsWith("member-")) {
        const svg = memberPictureSvg(id.slice("member-".length));
        return svg ? bytes(new TextEncoder().encode(svg), "image/svg+xml") : notFound();
    }
    const img = ctx.w.images[id];
    if (!img?.data || img.status !== "AVAILABLE") return notFound();
    return bytes(img.data, img.contentType ?? "application/octet-stream");
}

// ── Posts ──────────────────────────────────────────────────────────────────

const VISIBILITIES = ["PUBLIC", "CONNECTIONS", "LOGGED_IN", "CONTAINER"];

interface MediaRef {
    imageId: string;
    altText: string | null;
}

function checkMediaRef(
    api: Api,
    authorUrn: string,
    ref: unknown,
    fieldPath: string
): MediaRef | Response {
    if (!isRecord(ref) || typeof ref.id !== "string") {
        return fieldError("MISSING_FIELD", `${fieldPath}/id`, "id is a required field");
    }
    const imageId = parseImageUrn(ref.id);
    const img = imageId ? api.w.images[imageId] : undefined;
    if (!imageId || !img) {
        return fieldError("INVALID_VALUE_FOR_FIELD", `${fieldPath}/id`, `${ref.id} does not exist`);
    }
    if (img.status !== "AVAILABLE") {
        return json(
            {
                status: 422,
                code: "UNPROCESSABLE_ENTITY",
                message: `${ref.id} is not ready to be used (status ${img.status}); upload its bytes first`,
            },
            422
        );
    }
    if (img.ownerUrn !== authorUrn) {
        return fieldError(
            "INVALID_VALUE_FOR_FIELD",
            `${fieldPath}/id`,
            `${ref.id} is owned by ${img.ownerUrn}, not the post author ${authorUrn}`
        );
    }
    if (ref.altText !== undefined && typeof ref.altText !== "string") {
        return fieldError("INVALID_VALUE_FOR_FIELD", `${fieldPath}/altText`, "must be a string");
    }
    if (typeof ref.altText === "string" && ref.altText.length > 4086) {
        return fieldError(
            "FIELD_LENGTH_TOO_LONG",
            `${fieldPath}/altText`,
            "exceeds 4086 characters"
        );
    }
    return { imageId, altText: typeof ref.altText === "string" ? ref.altText : null };
}

/** Validates `content`; returns the images it references. */
function checkContent(api: Api, author: string, content: unknown): MediaRef[] | Response {
    if (content === undefined) return [];
    if (!isRecord(content)) {
        return fieldError("INVALID_VALUE_FOR_FIELD", "/content", "must be an object");
    }
    const kinds = Object.keys(content);
    if (kinds.length !== 1) {
        return fieldError(
            "INVALID_VALUE_FOR_FIELD",
            "/content",
            "exactly one of media, multiImage, article, poll, reference"
        );
    }
    if (content.media !== undefined) {
        const ref = checkMediaRef(api, author, content.media, "/content/media");
        return ref instanceof Response ? ref : [ref];
    }
    if (content.multiImage !== undefined) {
        const images = isRecord(content.multiImage) ? content.multiImage.images : undefined;
        if (!Array.isArray(images)) {
            return fieldError("MISSING_FIELD", "/content/multiImage/images", "images is required");
        }
        if (images.length < 2 || images.length > 20) {
            return fieldError(
                "INVALID_VALUE_FOR_FIELD",
                "/content/multiImage/images",
                "a multi-image post takes 2 to 20 images"
            );
        }
        const refs: MediaRef[] = [];
        for (const [i, item] of images.entries()) {
            const ref = checkMediaRef(api, author, item, `/content/multiImage/images/${i}`);
            if (ref instanceof Response) return ref;
            refs.push(ref);
        }
        return refs;
    }
    if (content.article !== undefined) {
        if (!isRecord(content.article) || typeof content.article.source !== "string") {
            return fieldError("MISSING_FIELD", "/content/article/source", "source is required");
        }
        return [];
    }
    return fieldError(
        "INVALID_VALUE_FOR_FIELD",
        "/content",
        `content type "${kinds[0]}" is not supported by the stand-in`
    );
}

async function createPostRoute(api: Api): Promise<Response> {
    const body = await readJson(api.req);
    if (!isRecord(body)) {
        return json({ status: 400, message: "Unable to parse request body as a JSON object" }, 400);
    }
    const author = body.author;
    if (typeof author !== "string" || !author) {
        return fieldError("MISSING_FIELD", "/author", "author is a required field");
    }
    const denied = checkActor(api, author, "posts", "CREATE", "/author");
    if (denied) return denied;

    if (typeof body.commentary !== "string") {
        return fieldError("MISSING_FIELD", "/commentary", "commentary is a required field");
    }
    if (body.commentary.length > 3000) {
        return fieldError("FIELD_LENGTH_TOO_LONG", "/commentary", "exceeds 3000 characters");
    }
    if (typeof body.visibility !== "string") {
        return fieldError("MISSING_FIELD", "/visibility", "visibility is a required field");
    }
    if (!VISIBILITIES.includes(body.visibility)) {
        return fieldError(
            "INVALID_VALUE_FOR_FIELD",
            "/visibility",
            `must be one of ${VISIBILITIES.join(", ")}`
        );
    }
    if (!isRecord(body.distribution)) {
        return fieldError("MISSING_FIELD", "/distribution", "distribution is a required field");
    }
    const feed = body.distribution.feedDistribution;
    if (feed !== "MAIN_FEED" && feed !== "NONE") {
        return fieldError(
            feed === undefined ? "MISSING_FIELD" : "INVALID_VALUE_FOR_FIELD",
            "/distribution/feedDistribution",
            "must be MAIN_FEED or NONE"
        );
    }
    for (const key of ["targetEntities", "thirdPartyDistributionChannels"] as const) {
        const value = body.distribution[key];
        if (value !== undefined && !Array.isArray(value)) {
            return fieldError(
                "INVALID_VALUE_FOR_FIELD",
                `/distribution/${key}`,
                "must be an array"
            );
        }
    }
    if (typeof body.lifecycleState !== "string") {
        return fieldError("MISSING_FIELD", "/lifecycleState", "lifecycleState is a required field");
    }
    if (body.lifecycleState !== "PUBLISHED" && body.lifecycleState !== "DRAFT") {
        return fieldError(
            "INVALID_VALUE_FOR_FIELD",
            "/lifecycleState",
            "must be PUBLISHED or DRAFT"
        );
    }
    if (
        body.isReshareDisabledByAuthor !== undefined &&
        typeof body.isReshareDisabledByAuthor !== "boolean"
    ) {
        return fieldError(
            "INVALID_VALUE_FOR_FIELD",
            "/isReshareDisabledByAuthor",
            "must be a boolean"
        );
    }
    const media = checkContent(api, author, body.content);
    if (media instanceof Response) return media;

    const post = createPost(api.w, {
        authorUrn: author,
        commentary: body.commentary,
        visibility: body.visibility,
        distribution: body.distribution,
        lifecycleState: body.lifecycleState,
        isReshareDisabledByAuthor: body.isReshareDisabledByAuthor === true,
        content: body.content ?? null,
        media,
        createdBy: api.token.memberId,
    });
    return empty(201, { "x-restli-id": post.urn, "x-linkedin-id": post.urn });
}

function postJson(p: LiPost): Record<string, unknown> {
    return {
        id: p.urn,
        author: p.authorUrn,
        commentary: p.commentary,
        visibility: p.visibility,
        distribution: p.distribution,
        lifecycleState: p.lifecycleState,
        isReshareDisabledByAuthor: p.isReshareDisabledByAuthor,
        ...(p.content ? { content: p.content } : {}),
        createdAt: p.createdAt,
        publishedAt: p.createdAt,
        lastModifiedAt: p.createdAt,
        lifecycleStateInfo: { isEditedByAuthor: false },
    };
}

function getPost(api: Api, urn: string): Response {
    const readable = [
        "r_organization_social",
        "w_organization_social",
        "r_member_social",
        "w_member_social",
    ];
    if (!hasAny(api.token, readable)) return missingScope("posts", "GET", api.version);
    const post = findPost(api.w, urn);
    if (!post || post.deletedAt !== null) {
        return json({ status: 404, message: `Post ${urn} not found` }, 404);
    }
    return json(postJson(post));
}

function deletePost(api: Api, urn: string): Response {
    const post = findPost(api.w, urn);
    if (!post) return json({ status: 404, message: `Post ${urn} not found` }, 404);
    const denied = checkActor(api, post.authorUrn, "posts", "DELETE", "/author");
    if (denied) return denied;
    // Deleting twice is fine on LinkedIn too.
    post.deletedAt ??= api.now;
    return empty(204);
}

// ── Share statistics ───────────────────────────────────────────────────────

function safeDecode(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

/**
 * Rest.li 2.0 `List(a,b)` from a raw query value. Items are URL-encoded
 * inside a literal `List(…)`; a client that encoded the parentheses too is
 * tolerated rather than refused.
 */
export function parseRestliList(raw: string | null): string[] | null {
    if (raw === null) return null;
    let value = raw.replace(/\+/g, "%20");
    if (!value.startsWith("List(")) value = safeDecode(value);
    const m = /^List\((.*)\)$/s.exec(value);
    if (!m) return value ? [safeDecode(value)] : [];
    if (m[1] === "") return [];
    return m[1]!.split(",").map(item => safeDecode(item.trim()));
}

/** `shares=List(…)`, Rest.li 1.0 `shares[0]=…`, or repeated `shares=…`. */
function listParam(api: Api, name: string): string[] {
    const out: string[] = [];
    const listed = parseRestliList(rawQueryParam(api.req, name));
    if (listed) out.push(...listed);
    const indexed = new RegExp(`^${name}\\[\\d+\\]$`);
    for (const [key, value] of api.url.searchParams.entries()) {
        if (indexed.test(key)) out.push(value);
    }
    const repeated = api.url.searchParams.getAll(name);
    if (repeated.length > 1) out.push(...repeated);
    return [...new Set(out)];
}

function sumStats(all: ShareStatistics[]): ShareStatistics {
    const total: ShareStatistics = {
        impressionCount: 0,
        uniqueImpressionsCount: 0,
        clickCount: 0,
        likeCount: 0,
        commentCount: 0,
        shareCount: 0,
        engagement: 0,
    };
    for (const s of all) {
        total.impressionCount += s.impressionCount;
        total.uniqueImpressionsCount += s.uniqueImpressionsCount;
        total.clickCount += s.clickCount;
        total.likeCount += s.likeCount;
        total.commentCount += s.commentCount;
        total.shareCount += s.shareCount;
    }
    const engaged = total.clickCount + total.likeCount + total.commentCount + total.shareCount;
    total.engagement =
        total.impressionCount > 0
            ? Math.round((engaged / total.impressionCount) * 10_000) / 10_000
            : 0;
    return total;
}

function shareStatistics(api: Api): Response {
    if (!api.token.scopes.includes("rw_organization_admin")) {
        return missingScope(
            "organizationalEntityShareStatistics",
            "FINDER-organizationalEntity",
            api.version
        );
    }
    if (api.url.searchParams.get("q") !== "organizationalEntity") {
        return json({ status: 400, message: "Expected q=organizationalEntity" }, 400);
    }
    const entity = api.url.searchParams.get("organizationalEntity") ?? "";
    const orgId = parseOrgUrn(entity);
    if (!orgId || !orgById(orgId)) {
        return fieldError(
            "INVALID_VALUE_FOR_FIELD",
            "organizationalEntity",
            `${entity || "(missing)"} is not a known organization URN`
        );
    }
    // Share statistics are for ADMINISTRATORs only, not content admins.
    if (roleOf(api.token.memberId, orgId) !== "ADMINISTRATOR") {
        return forbidden(
            `Not enough permissions to access: organizationalEntityShareStatistics for ${entity} (ADMINISTRATOR role required)`
        );
    }
    const orgPosts = livePosts(api.w).filter(p => p.authorUrn === orgUrn(orgId));
    const shares = listParam(api, "shares");
    const ugcPosts = listParam(api, "ugcPosts");
    const elements: Record<string, unknown>[] = [];

    if (shares.length === 0 && ugcPosts.length === 0) {
        elements.push({
            organizationalEntity: orgUrn(orgId),
            totalShareStatistics: sumStats(orgPosts.map(p => postStats(api.w, p, api.now))),
        });
    } else {
        const wanted: [string, string[]][] = [
            ["share", shares],
            ["ugcPost", ugcPosts],
        ];
        for (const [field, urns] of wanted) {
            for (const urn of urns) {
                const post = orgPosts.find(p => p.urn === urn);
                if (!post) continue;
                const stats = postStats(api.w, post, api.now);
                // LinkedIn leaves out posts with no activity yet.
                if (!hasActivity(stats)) continue;
                elements.push({
                    organizationalEntity: orgUrn(orgId),
                    [field]: urn,
                    totalShareStatistics: stats,
                });
            }
        }
    }
    return json({ paging: { start: 0, count: 10, links: [] }, elements });
}

// ── Comments ───────────────────────────────────────────────────────────────

function actorDecoration(urn: string): Record<string, unknown> | null {
    const orgId = parseOrgUrn(urn);
    if (orgId) {
        const org = orgById(orgId);
        return org
            ? { id: Number(org.id), localizedName: org.name, vanityName: org.vanityName }
            : null;
    }
    const personId = parsePersonUrn(urn);
    const member = personId ? memberById(personId) : undefined;
    return member
        ? {
              id: member.id,
              localizedFirstName: member.firstName,
              localizedLastName: member.lastName,
          }
        : null;
}

function commentJson(
    w: LiState,
    c: LiComment,
    now: number,
    decorate: boolean
): Record<string, unknown> {
    const urn = commentUrn(c.activityUrn, c.id);
    const replies = c.parentId
        ? 0
        : w.comments.filter(r => r.parentId === c.id && isVisible(r, now)).length;
    const author = c.agentUrn ?? c.actorUrn;
    const decoration = decorate ? actorDecoration(c.actorUrn) : null;
    return {
        $URN: urn,
        commentUrn: urn,
        id: c.id,
        actor: c.actorUrn,
        ...(c.agentUrn ? { agent: c.agentUrn } : {}),
        ...(decoration ? { "actor~": decoration } : {}),
        object: c.activityUrn,
        ...(c.parentId ? { parentComment: commentUrn(c.activityUrn, c.parentId) } : {}),
        message: { text: c.text, attributes: [] },
        created: { actor: author, time: c.createdAt },
        lastModified: { actor: author, time: c.createdAt },
        likesSummary: {
            totalLikes: 0,
            aggregatedTotalLikes: 0,
            likedByCurrentUser: false,
            selectedLikes: [],
        },
        commentsSummary: {
            totalFirstLevelComments: replies,
            aggregatedTotalComments: replies,
            selectedComments: [],
        },
    };
}

/** A post or comment URN from the path → the post and (for a comment) the comment. */
function resolveTarget(
    w: LiState,
    target: string
): { post: LiPost; comment: LiComment | null } | null {
    const parsed = parseCommentUrn(target);
    if (parsed) {
        const post = findPost(w, parsed.objectUrn);
        const comment = post
            ? w.comments.find(
                  c => c.id === parsed.id && c.postUrn === post.urn && c.deletedAt === null
              )
            : undefined;
        return post && comment ? { post, comment } : null;
    }
    const post = findPost(w, target);
    return post && post.deletedAt === null ? { post, comment: null } : null;
}

function mayReadComments(api: Api, post: LiPost): Response | null {
    const readable = [
        "r_organization_social",
        "r_organization_social_feed",
        "r_member_social",
        "r_member_social_feed",
    ];
    if (!hasAny(api.token, readable)) {
        return missingScope("socialActions", "comments.GET_ALL", api.version);
    }
    const orgId = parseOrgUrn(post.authorUrn);
    if (orgId && !roleOf(api.token.memberId, orgId)) {
        return forbidden(`Member has no role on ${post.authorUrn}`);
    }
    const personId = parsePersonUrn(post.authorUrn);
    if (personId && personId !== api.token.memberId) {
        return forbidden(`Reading comments on ${post.authorUrn}'s posts is not permitted`);
    }
    return null;
}

function listComments(api: Api, target: string): Response {
    const resolved = resolveTarget(api.w, target);
    if (!resolved) return json({ status: 404, message: `${target} not found` }, 404);
    const denied = mayReadComments(api, resolved.post);
    if (denied) return denied;
    const parentId = resolved.comment ? (resolved.comment.parentId ?? resolved.comment.id) : null;
    const all = api.w.comments
        .filter(
            c => c.postUrn === resolved.post.urn && c.parentId === parentId && isVisible(c, api.now)
        )
        .sort((a, b) => a.createdAt - b.createdAt);
    if (api.url.searchParams.get("sortOrder") === "REVERSE_CHRONOLOGICAL") all.reverse();
    const start = Number(api.url.searchParams.get("start") ?? 0) || 0;
    const count = Math.min(100, Number(api.url.searchParams.get("count") ?? 10) || 10);
    const decorate = wantsDecoration(api, "actor");
    return json({
        paging: { start, count, total: all.length, links: [] },
        elements: all
            .slice(start, start + count)
            .map(c => commentJson(api.w, c, api.now, decorate)),
    });
}

async function createComment(api: Api, target: string): Promise<Response> {
    const resolved = resolveTarget(api.w, target);
    if (!resolved) return json({ status: 404, message: `${target} not found` }, 404);
    const body = await readJson(api.req);
    if (!isRecord(body)) {
        return json({ status: 400, message: "Unable to parse request body as a JSON object" }, 400);
    }
    if (typeof body.actor !== "string" || !body.actor) {
        return fieldError("MISSING_FIELD", "/actor", "actor is a required field");
    }
    const denied = checkActor(api, body.actor, "socialActions", "comments.CREATE", "/actor");
    if (denied) return denied;
    if (typeof body.object !== "string" || !body.object) {
        return fieldError("MISSING_FIELD", "/object", "object is a required field");
    }
    if (findPost(api.w, body.object)?.urn !== resolved.post.urn) {
        return fieldError(
            "INVALID_VALUE_FOR_FIELD",
            "/object",
            `${body.object} is not the post this comment targets (${resolved.post.urn} / ${resolved.post.activityUrn})`
        );
    }
    const text = isRecord(body.message) ? body.message.text : undefined;
    if (typeof text !== "string" || !text.trim()) {
        return fieldError("MISSING_FIELD", "/message/text", "message.text is a required field");
    }
    if (text.length > 1250) {
        return fieldError("FIELD_LENGTH_TOO_LONG", "/message/text", "exceeds 1250 characters");
    }

    let parent = resolved.comment;
    if (body.parentComment !== undefined) {
        const parsed =
            typeof body.parentComment === "string" ? parseCommentUrn(body.parentComment) : null;
        const named = parsed
            ? api.w.comments.find(c => c.id === parsed.id && c.postUrn === resolved.post.urn)
            : undefined;
        if (!named || (parent && parent.id !== named.id)) {
            return fieldError(
                "INVALID_VALUE_FOR_FIELD",
                "/parentComment",
                `${JSON.stringify(body.parentComment)} is not a comment on ${resolved.post.urn}${parent ? " matching the path" : ""}`
            );
        }
        parent = named;
    }
    if (parent && !isVisible(parent, api.now)) {
        return json({ status: 404, message: "Parent comment not found" }, 404);
    }
    const orgActor = parseOrgUrn(body.actor) !== null;
    const comment = addComment(api.w, resolved.post, {
        actorUrn: body.actor,
        agentUrn: orgActor ? personUrn(api.token.memberId) : null,
        text,
        // LinkedIn nests one level: a reply to a reply joins the top-level thread.
        parentId: parent ? (parent.parentId ?? parent.id) : null,
        createdAt: api.now,
        origin: "api",
    });
    return json(commentJson(api.w, comment, api.now, false), 201, {
        "x-restli-id": comment.id,
    });
}

function deleteComment(api: Api, target: string, id: string): Response {
    const resolved = resolveTarget(api.w, target);
    const comment = resolved
        ? api.w.comments.find(c => c.id === id && c.postUrn === resolved.post.urn)
        : undefined;
    if (!resolved || !comment) return json({ status: 404, message: "Comment not found" }, 404);
    const actor = api.url.searchParams.get("actor") ?? comment.actorUrn;
    const denied = checkActor(api, actor, "socialActions", "comments.DELETE", "actor");
    if (denied) return denied;
    comment.deletedAt ??= api.now;
    return empty(204);
}

// ── Page controls ──────────────────────────────────────────────────────────

async function control(ctx: Ctx, action: string | undefined): Promise<Response> {
    if (action === "state" && ctx.method === "GET") return json(linkedInSnapshot(ctx.w));
    if (action !== "action" || ctx.method !== "POST") return notFound();
    const body = await readJson(ctx.req);
    if (!isRecord(body)) return json({ error: "Expected a JSON body" }, 400);
    let w = ctx.w;
    switch (body.action) {
        case "reset":
            w = resetLinkedInWorld();
            break;
        case "revoke-all":
            revokeAllTokens(w);
            break;
        case "expire-access":
            expireAccessTokens(w);
            break;
        case "age":
            ageWorld(w, typeof body.minutes === "number" ? body.minutes : 60);
            break;
        case "comment": {
            const post = typeof body.postUrn === "string" ? findPost(w, body.postUrn) : undefined;
            if (!post) return json({ error: "Unknown post" }, 404);
            addFakeComment(w, post, {
                origin: "page",
                text: typeof body.text === "string" ? body.text : undefined,
                parentId: typeof body.parentId === "string" ? body.parentId : null,
            });
            break;
        }
        default:
            return json({ error: `Unknown action ${String(body.action)}` }, 400);
    }
    return json(linkedInSnapshot(w));
}
