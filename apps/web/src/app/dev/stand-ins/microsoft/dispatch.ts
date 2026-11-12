/**
 * Development stand-in for the Microsoft endpoints the OneDrive / SharePoint
 * and Outlook connectors talk to: Entra's OAuth token endpoint (and the
 * consent decision), and the slice of Microsoft Graph v1.0 the syncs read.
 * Point the app at it with
 *
 *   MICROSOFT_STAND_IN_URL=<origin>/dev/stand-ins/microsoft
 *
 * plus any client id / secret pair (the stand-in accepts any). From that base
 * the authority is the base itself (`…/{tenant}/oauth2/v2.0/authorize|token`)
 * and Graph is `…/graph/v1.0`. The consent screen is a page —
 * ./[tenant]/oauth2/v2.0/authorize/page.tsx — that posts its decision to
 * …/consent here.
 *
 * What it gets right on purpose: scopes (files need Files.Read.All or
 * Sites.Read.All, mail needs Mail.Read), Graph's error envelope, absolute
 * `@odata.nextLink` paging, cTag / eTag movement, and message delta with
 * `@removed` entries and expiring delta links.
 */

import {
    bearerToken,
    bytes,
    displayPath,
    isRecord,
    json,
    originOf,
    readForm,
    readJson,
    redirect,
    segmentsAfter,
} from "../shared/http";
import { standInClock } from "../shared/store";
import {
    ACCOUNTS,
    FILES_SCOPES,
    MAIL_SCOPE,
    MICROSOFT_BASE_PATH,
    TENANT_ID,
    accountByOid,
    addFile,
    addMessage,
    childrenOf,
    deleteItem,
    deleteMessage,
    driveItemResource,
    editFile,
    findMailFolder,
    invalidateDeltaTokens,
    itemBySharingUrl,
    mailFolderResource,
    mailRootId,
    messagesIn,
    microsoftWorld,
    nextId,
    resetMicrosoftWorld,
    revokeGrants,
    sizeOf,
    type MicrosoftWorld,
    type StandInAccount,
    type StandInDrive,
    type StandInItem,
    type StandInMailFolder,
    type StandInMessage,
    type StandInSite,
} from "./world";

const ACCESS_TOKEN_SECONDS = 3600;
const CODE_TTL_MS = 10 * 60_000;
const GRAPH_SCOPE_PREFIX = "https://graph.microsoft.com/";

// Graph's own defaults: ten messages or folders a page, two hundred children.
const MAIL_PAGE = 10;
const CHILDREN_PAGE = 200;

function graphError(status: number, code: string, message: string): Response {
    return json({ error: { code, message } }, status);
}

function oauthError(status: number, error: string, description: string): Response {
    return json({ error, error_description: description }, status);
}

function base64url(value: string): string {
    return Buffer.from(value, "utf8").toString("base64url");
}

/** A redirect_uri the stand-in will send a browser to: this machine only. */
export function acceptableRedirect(raw: string | null): URL | null {
    if (!raw) return null;
    try {
        const url = new URL(raw);
        const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
        return (url.protocol === "http:" || url.protocol === "https:") && local ? url : null;
    } catch {
        return null;
    }
}

/** "https://graph.microsoft.com/Files.Read.All" and "files.read.all" are the same scope. */
export function normalizeScope(scope: string): string {
    return scope.startsWith(GRAPH_SCOPE_PREFIX) ? scope.slice(GRAPH_SCOPE_PREFIX.length) : scope;
}

function hasScope(granted: readonly string[], wanted: readonly string[]): boolean {
    const have = new Set(granted.map(s => s.toLowerCase()));
    return wanted.some(s => have.has(s.toLowerCase()));
}

// ── OAuth ──────────────────────────────────────────────────────────────────

/** Unsigned, like the claims the app decodes; nothing verifies it. */
function idToken(req: Request, account: StandInAccount, clientId: string): string {
    const now = Math.floor(standInClock.now() / 1000);
    return [
        base64url(JSON.stringify({ alg: "none", typ: "JWT" })),
        base64url(
            JSON.stringify({
                iss: `${originOf(req)}${MICROSOFT_BASE_PATH}/${TENANT_ID}/v2.0`,
                aud: clientId,
                iat: now,
                exp: now + ACCESS_TOKEN_SECONDS,
                sub: `sub-${account.oid}`,
                oid: account.oid,
                tid: TENANT_ID,
                email: account.email,
                preferred_username: account.email,
                name: account.name,
                ver: "2.0",
            })
        ),
        "stand-in",
    ].join(".");
}

/** Entra reports what was granted without `offline_access`: the refresh token is the answer. */
function scopeString(scopes: readonly string[]): string {
    return scopes.filter(s => s.toLowerCase() !== "offline_access").join(" ");
}

function issueAccessToken(w: MicrosoftWorld, oid: string, scopes: string[]): string {
    const access = nextId(w, "eyJ0.standin");
    w.tokens[access] = {
        oid,
        scopes,
        expiresAt: standInClock.now() + ACCESS_TOKEN_SECONDS * 1000,
    };
    return access;
}

async function token(w: MicrosoftWorld, req: Request): Promise<Response> {
    const form = await readForm(req);
    const grant = form.get("grant_type");
    const clientId = form.get("client_id");
    if (!clientId || !form.get("client_secret")) {
        return oauthError(
            401,
            "invalid_client",
            "AADSTS7000218: The request body must contain the following parameter: 'client_assertion' or 'client_secret'."
        );
    }
    if (grant === "authorization_code") {
        const code = w.codes[form.get("code") ?? ""];
        if (
            !code ||
            code.expiresAt <= standInClock.now() ||
            code.redirectUri !== form.get("redirect_uri") ||
            code.clientId !== clientId
        ) {
            return oauthError(
                400,
                "invalid_grant",
                "AADSTS70008: The provided authorization code or refresh token has expired or is not valid for this client and redirect_uri."
            );
        }
        delete w.codes[form.get("code")!];
        const account = accountByOid(code.oid)!;
        const offline = hasScope(code.scopes, ["offline_access"]);
        let refresh: string | undefined;
        if (offline) {
            refresh = nextId(w, "0.standin");
            w.refreshTokens[refresh] = { oid: code.oid, scopes: code.scopes };
        }
        return json({
            token_type: "Bearer",
            scope: scopeString(code.scopes),
            expires_in: ACCESS_TOKEN_SECONDS,
            ext_expires_in: ACCESS_TOKEN_SECONDS,
            access_token: issueAccessToken(w, code.oid, code.scopes),
            ...(refresh ? { refresh_token: refresh } : {}),
            id_token: idToken(req, account, clientId),
        });
    }
    if (grant === "refresh_token") {
        const presented = form.get("refresh_token") ?? "";
        const issued = w.refreshTokens[presented];
        if (!issued) {
            return oauthError(
                400,
                "invalid_grant",
                "AADSTS70000: The refresh token has expired or has been revoked. The user must sign in again."
            );
        }
        return json({
            token_type: "Bearer",
            scope: scopeString(issued.scopes),
            expires_in: ACCESS_TOKEN_SECONDS,
            ext_expires_in: ACCESS_TOKEN_SECONDS,
            access_token: issueAccessToken(w, issued.oid, issued.scopes),
            refresh_token: presented,
        });
    }
    return oauthError(
        400,
        "unsupported_grant_type",
        `AADSTS70003: The app requested an unsupported grant type '${grant ?? ""}'.`
    );
}

/** The consent page's Allow / Cancel, sent back to the app like Entra does. */
async function consent(w: MicrosoftWorld, req: Request): Promise<Response> {
    const form = await readForm(req);
    const back = acceptableRedirect(form.get("redirect_uri"));
    if (!back) return new Response("redirect_uri must point at this machine", { status: 400 });
    const state = form.get("state");
    if (form.get("decision") !== "allow") {
        back.searchParams.set("error", "access_denied");
        back.searchParams.set(
            "error_description",
            "AADSTS65004: User declined to consent to access the app."
        );
        if (state !== null) back.searchParams.set("state", state);
        return redirect(back.toString(), 303);
    }
    const account = ACCOUNTS.find(a => a.oid === form.get("account")) ?? ACCOUNTS[0]!;
    const scopes = [
        ...new Set(
            form
                .getAll("scope")
                .flatMap(value => value.split(/\s+/))
                .filter(Boolean)
                .map(normalizeScope)
        ),
    ];
    const code = nextId(w, "0.standin-code");
    w.codes[code] = {
        clientId: form.get("client_id") ?? "",
        redirectUri: form.get("redirect_uri")!,
        oid: account.oid,
        scopes,
        expiresAt: standInClock.now() + CODE_TTL_MS,
    };
    back.searchParams.set("code", code);
    if (state !== null) back.searchParams.set("state", state);
    return redirect(back.toString(), 303);
}

// ── Graph plumbing ─────────────────────────────────────────────────────────

interface Caller {
    account: StandInAccount;
    scopes: string[];
}

function callerOf(w: MicrosoftWorld, req: Request): Caller | null {
    const presented = bearerToken(req);
    const issued = presented ? w.tokens[presented] : undefined;
    if (!issued || issued.expiresAt <= standInClock.now()) return null;
    const account = accountByOid(issued.oid);
    return account ? { account, scopes: issued.scopes } : null;
}

function notFound(what: string): Response {
    return graphError(404, "itemNotFound", `${what} could not be found.`);
}

function accessDenied(needed: readonly string[]): Response {
    return graphError(
        403,
        "accessDenied",
        `Access denied. The token needs ${needed.join(" or ")}.`
    );
}

function query(url: URL, name: string): string | null {
    return url.searchParams.get(name);
}

/** Query string with `$` left readable, the way Graph writes its own links. */
function link(req: Request, url: URL, changes: Record<string, string | null>): string {
    const params = new Map<string, string>();
    for (const [key, value] of url.searchParams) params.set(key, value);
    for (const [key, value] of Object.entries(changes)) {
        if (value === null) params.delete(key);
        else params.set(key, value);
    }
    const search = [...params]
        .map(
            ([key, value]) =>
                `${encodeURIComponent(key).replace(/%24/g, "$")}=${encodeURIComponent(value)}`
        )
        .join("&");
    return `${originOf(req)}${url.pathname}${search ? `?${search}` : ""}`;
}

function encodeToken(value: Record<string, unknown>): string {
    return base64url(JSON.stringify(value));
}

function decodeToken(raw: string | null): Record<string, unknown> | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
        return isRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function pageSize(url: URL, fallback: number, req?: Request): number {
    const preferred = /odata\.maxpagesize\s*=\s*(\d+)/i.exec(req?.headers.get("prefer") ?? "")?.[1];
    const top = Number(query(url, "$top") ?? preferred ?? "");
    return Number.isInteger(top) && top > 0 ? Math.min(top, 999) : fallback;
}

/** `$select`, loosely: the named properties, plus the id and any `@` annotations. */
function select(url: URL, resource: Record<string, unknown>): Record<string, unknown> {
    const wanted = query(url, "$select");
    if (!wanted) return resource;
    const names = new Set(wanted.split(",").map(name => name.trim()));
    return Object.fromEntries(
        Object.entries(resource).filter(
            ([key]) => key === "id" || key.startsWith("@") || names.has(key)
        )
    );
}

/** One page of a collection, with an absolute `@odata.nextLink` when there is more. */
function paged(
    req: Request,
    url: URL,
    all: Record<string, unknown>[],
    fallbackSize: number
): Response {
    const size = pageSize(url, fallbackSize);
    const skip = decodeToken(query(url, "$skiptoken"));
    const offset = typeof skip?.o === "number" && skip.o > 0 ? skip.o : 0;
    const value = all.slice(offset, offset + size).map(entry => select(url, entry));
    const more = offset + size < all.length;
    return json({
        value,
        ...(more
            ? {
                  "@odata.nextLink": link(req, url, {
                      $skiptoken: encodeToken({ o: offset + size }),
                  }),
              }
            : {}),
    });
}

// ── Graph: files ───────────────────────────────────────────────────────────

function driveResource(drive: StandInDrive): Record<string, unknown> {
    return { id: drive.id, driveType: drive.driveType, name: drive.name, webUrl: drive.webUrl };
}

function siteResource(site: StandInSite): Record<string, unknown> {
    return { id: site.id, name: site.name, displayName: site.displayName, webUrl: site.webUrl };
}

/** The drive, if it exists and this account may open it; otherwise the error to send. */
function openDrive(w: MicrosoftWorld, caller: Caller, driveId: string): StandInDrive | Response {
    const drive = w.drives[driveId];
    if (!drive) return notFound("The drive");
    if (drive.ownerOid && drive.ownerOid !== caller.account.oid) {
        return graphError(
            403,
            "accessDenied",
            "Access denied. This OneDrive belongs to someone else."
        );
    }
    return drive;
}

function driveRoutes(
    w: MicrosoftWorld,
    req: Request,
    url: URL,
    caller: Caller,
    driveId: string,
    rest: string[]
): Response {
    const drive = openDrive(w, caller, driveId);
    if (drive instanceof Response) return drive;
    const [a, b, c] = rest;
    if (!a) return json(driveResource(drive));

    let item: StandInItem | undefined;
    let tail: string | undefined;
    if (a === "root") {
        item = w.items[drive.rootId];
        tail = b;
    } else if (a === "items" && b) {
        const found = w.items[b];
        item = found?.driveId === drive.id ? found : undefined;
        tail = c;
    } else {
        return notFound("The resource");
    }
    if (!item) return notFound("The item");

    if (!tail) return json(select(url, driveItemResource(w, item)));
    if (tail === "children") {
        if (item.kind === "file") return paged(req, url, [], CHILDREN_PAGE);
        return paged(
            req,
            url,
            childrenOf(w, item).map(child => driveItemResource(w, child)),
            CHILDREN_PAGE
        );
    }
    if (tail === "content") {
        if (item.kind !== "file") {
            return graphError(
                400,
                "invalidRequest",
                "Only files have content; this item is a folder or a package."
            );
        }
        return bytes(
            item.content ?? new Uint8Array(0),
            item.mimeType ?? "application/octet-stream"
        );
    }
    return notFound("The resource");
}

function sharedItem(w: MicrosoftWorld, url: URL, caller: Caller, shareToken: string): Response {
    let sharingUrl = "";
    if (shareToken.startsWith("u!")) {
        sharingUrl = Buffer.from(shareToken.slice(2), "base64url").toString("utf8");
    }
    const item = sharingUrl ? itemBySharingUrl(w, sharingUrl) : undefined;
    if (!item) return notFound("The sharing link");
    const drive = openDrive(w, caller, item.driveId);
    if (drive instanceof Response) return drive;
    return json(select(url, driveItemResource(w, item)));
}

function sites(w: MicrosoftWorld, req: Request, url: URL, rest: string[]): Response {
    const [siteId, tail] = rest;
    if (!siteId) {
        const q = (query(url, "search") ?? query(url, "$search") ?? "")
            .replace(/^"|"$/g, "")
            .trim()
            .toLowerCase();
        const matches = w.sites.filter(
            s =>
                q === "" ||
                q === "*" ||
                s.name.toLowerCase().includes(q) ||
                s.displayName.toLowerCase().includes(q)
        );
        return paged(req, url, matches.map(siteResource), CHILDREN_PAGE);
    }
    const site = w.sites.find(s => s.id === siteId);
    if (!site) return notFound("The site");
    if (!tail) return json(select(url, siteResource(site)));
    if (tail === "drives") {
        const drives = Object.values(w.drives).filter(d => d.siteId === site.id);
        return paged(req, url, drives.map(driveResource), CHILDREN_PAGE);
    }
    if (tail === "drive") {
        const drive = Object.values(w.drives).find(d => d.siteId === site.id);
        return drive ? json(driveResource(drive)) : notFound("The drive");
    }
    return notFound("The resource");
}

// ── Graph: mail ────────────────────────────────────────────────────────────

function recipient(p: { name: string; address: string }) {
    return { emailAddress: { name: p.name, address: p.address } };
}

function wantsTextBody(req: Request): boolean {
    return /outlook\.body-content-type\s*=\s*"?text"?/i.test(req.headers.get("prefer") ?? "");
}

function plainText(html: string): string {
    return html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .trim();
}

function messageResource(message: StandInMessage, textBody: boolean): Record<string, unknown> {
    const readable = message.text ?? plainText(message.html);
    return {
        "@odata.etag": `W/"${message.seq}"`,
        id: message.id,
        conversationId: message.conversationId,
        subject: message.subject,
        from: recipient(message.from),
        sender: recipient(message.from),
        toRecipients: message.to.map(recipient),
        ccRecipients: message.cc.map(recipient),
        sentDateTime: message.sentDateTime,
        receivedDateTime: message.receivedDateTime,
        isDraft: message.isDraft,
        isRead: message.isRead,
        // Graph does not count inline images as attachments here.
        hasAttachments: message.attachments.some(a => !a.isInline),
        body:
            textBody && message.text !== undefined
                ? { contentType: "text", content: message.text }
                : { contentType: "html", content: message.html },
        bodyPreview: readable.replace(/\s+/g, " ").slice(0, 255),
        webLink: `https://outlook.office365.example/owa/?ItemID=${encodeURIComponent(message.id)}&exvsurl=1&viewmodel=ReadMessageItem`,
        parentFolderId: message.folderId,
        internetMessageId: message.internetMessageId,
    };
}

function newestFirst(messages: StandInMessage[]): StandInMessage[] {
    return [...messages].sort(
        (a, b) => b.receivedDateTime.localeCompare(a.receivedDateTime) || a.id.localeCompare(b.id)
    );
}

function messagePage(req: Request, url: URL, messages: StandInMessage[]): Response {
    const text = wantsTextBody(req);
    const response = paged(
        req,
        url,
        newestFirst(messages).map(m => messageResource(m, text)),
        MAIL_PAGE
    );
    if (text) response.headers.set("preference-applied", 'outlook.body-content-type="text"');
    return response;
}

function listMessages(w: MicrosoftWorld, req: Request, url: URL, caller: Caller): Response {
    let mine = Object.values(w.messages).filter(m => m.oid === caller.account.oid);
    const filter = query(url, "$filter");
    if (filter) {
        const conversation = /^\s*conversationId\s+eq\s+'((?:[^']|'')*)'\s*$/i.exec(filter)?.[1];
        if (conversation === undefined) {
            return graphError(
                400,
                "BadRequest",
                "The stand-in filters messages by conversationId eq '…' only."
            );
        }
        const id = conversation.replace(/''/g, "'");
        mine = mine.filter(m => m.conversationId === id);
    }
    const search = query(url, "$search");
    if (search) {
        const q = search.trim().replace(/^"|"$/g, "").toLowerCase();
        mine = mine.filter(m =>
            [m.subject, m.text ?? plainText(m.html), m.from.name, m.from.address].some(field =>
                field.toLowerCase().includes(q)
            )
        );
    }
    return messagePage(req, url, mine);
}

function syncStateNotFound(): Response {
    return graphError(
        410,
        "syncStateNotFound",
        "The sync state generation is not found; start a new delta query for this folder."
    );
}

/**
 * Message delta for one folder. With no token: every message, in pages, then
 * a delta link. With a delta link: what was created or changed since, and
 * `@removed` for what was deleted, then a fresh delta link.
 */
function messagesDelta(
    w: MicrosoftWorld,
    req: Request,
    url: URL,
    folder: StandInMailFolder
): Response {
    const rawSkip = query(url, "$skiptoken");
    const rawDelta = query(url, "$deltatoken");
    let since = 0;
    let upto = w.mailSeq;
    let offset = 0;
    if (rawSkip || rawDelta) {
        const state = decodeToken(rawSkip ?? rawDelta);
        if (
            !state ||
            state.f !== folder.id ||
            state.e !== w.deltaEpoch ||
            typeof state.since !== "number" ||
            typeof state.upto !== "number" ||
            state.upto > w.mailSeq
        ) {
            return syncStateNotFound();
        }
        if (rawSkip) {
            since = state.since;
            upto = state.upto;
            offset = typeof state.o === "number" ? state.o : 0;
        } else {
            since = state.upto;
        }
    }
    const inWindow = (seq: number) => seq > since && seq <= upto;
    const changed = messagesIn(w, folder.id)
        .filter(m => inWindow(m.seq))
        .sort((a, b) => a.seq - b.seq);
    const entries: Record<string, unknown>[] = [
        ...changed.map(m =>
            query(url, "$select")
                ? select(url, messageResource(m, wantsTextBody(req)))
                : {
                      "@odata.etag": `W/"${m.seq}"`,
                      id: m.id,
                      conversationId: m.conversationId,
                      isDraft: m.isDraft,
                      receivedDateTime: m.receivedDateTime,
                  }
        ),
        ...w.removedMessages
            .filter(r => r.folderId === folder.id && inWindow(r.seq))
            .map(r => ({ id: r.id, "@removed": { reason: "deleted" } })),
    ];
    const size = pageSize(url, MAIL_PAGE, req);
    const value = entries.slice(offset, offset + size);
    const state = { f: folder.id, e: w.deltaEpoch, since, upto };
    const next =
        offset + size < entries.length
            ? {
                  "@odata.nextLink": link(req, url, {
                      $deltatoken: null,
                      $skiptoken: encodeToken({ ...state, o: offset + size }),
                  }),
              }
            : {
                  "@odata.deltaLink": link(req, url, {
                      $skiptoken: null,
                      $deltatoken: encodeToken(state),
                  }),
              };
    return json({ value, ...next });
}

function mailFolders(
    w: MicrosoftWorld,
    req: Request,
    url: URL,
    caller: Caller,
    rest: string[]
): Response {
    const [folderId, a, b] = rest;
    const listing = (parentId: string) =>
        paged(
            req,
            url,
            Object.values(w.mailFolders)
                .filter(f => f.oid === caller.account.oid && f.parentFolderId === parentId)
                .map(f => mailFolderResource(w, f)),
            MAIL_PAGE
        );
    if (!folderId) return listing(mailRootId(caller.account));
    const folder = findMailFolder(w, caller.account.oid, folderId);
    if (!folder) return notFound("The mail folder");
    if (!a) return json(select(url, mailFolderResource(w, folder)));
    if (a === "childFolders" && !b) return listing(folder.id);
    if (a === "messages" && !b) return messagePage(req, url, messagesIn(w, folder.id));
    if (a === "messages" && b === "delta") return messagesDelta(w, req, url, folder);
    return notFound("The resource");
}

function messageRoutes(
    w: MicrosoftWorld,
    req: Request,
    url: URL,
    caller: Caller,
    rest: string[]
): Response {
    const [messageId, a, attachmentId, b] = rest;
    if (!messageId) return listMessages(w, req, url, caller);
    const found = w.messages[messageId];
    const message = found?.oid === caller.account.oid ? found : undefined;
    if (!message) return notFound("The message");
    if (!a) {
        const text = wantsTextBody(req);
        return json(
            select(url, messageResource(message, text)),
            200,
            text ? { "preference-applied": 'outlook.body-content-type="text"' } : undefined
        );
    }
    if (a !== "attachments") return notFound("The resource");
    const attachmentResource = (att: StandInMessage["attachments"][number]) => ({
        "@odata.type": "#microsoft.graph.fileAttachment",
        id: att.id,
        name: att.name,
        contentType: att.contentType,
        size: att.content.byteLength,
        isInline: att.isInline,
        contentId: att.contentId ?? null,
        lastModifiedDateTime: message.sentDateTime,
    });
    if (!attachmentId) return paged(req, url, message.attachments.map(attachmentResource), 100);
    const attachment = message.attachments.find(att => att.id === attachmentId);
    if (!attachment) return notFound("The attachment");
    if (!b) {
        return json({
            ...attachmentResource(attachment),
            contentBytes: Buffer.from(attachment.content).toString("base64"),
        });
    }
    if (b === "$value") return bytes(attachment.content, attachment.contentType);
    return notFound("The resource");
}

// ── Graph router ───────────────────────────────────────────────────────────

function graph(w: MicrosoftWorld, req: Request, url: URL, segments: string[]): Response {
    const caller = callerOf(w, req);
    if (!caller) {
        return graphError(
            401,
            "InvalidAuthenticationToken",
            "Access token is missing, expired or was not issued by this stand-in."
        );
    }
    if (req.method.toUpperCase() !== "GET") {
        return graphError(501, "notSupported", "The stand-in only reads; it does not write.");
    }
    const [a, b, ...rest] = segments;
    const files = () => (hasScope(caller.scopes, FILES_SCOPES) ? null : accessDenied(FILES_SCOPES));
    const mail = () => (hasScope(caller.scopes, [MAIL_SCOPE]) ? null : accessDenied([MAIL_SCOPE]));

    if (a === "me" && !b) {
        return json(
            select(url, {
                id: caller.account.oid,
                displayName: caller.account.name,
                mail: caller.account.email,
                userPrincipalName: caller.account.email,
                jobTitle: caller.account.jobTitle,
            })
        );
    }
    if (a === "me" && b === "drive") {
        return files() ?? driveRoutes(w, req, url, caller, caller.account.driveId, rest);
    }
    if (a === "drives" && b) return files() ?? driveRoutes(w, req, url, caller, b, rest);
    if (a === "shares" && b && rest[0] === "driveItem" && rest.length === 1) {
        return files() ?? sharedItem(w, url, caller, b);
    }
    if (a === "sites") return files() ?? sites(w, req, url, b ? [b, ...rest] : []);
    if (a === "me" && b === "mailFolders") return mail() ?? mailFolders(w, req, url, caller, rest);
    if (a === "me" && b === "messages") return mail() ?? messageRoutes(w, req, url, caller, rest);
    return graphError(
        400,
        "BadRequest",
        `No stand-in for ${req.method} ${url.pathname}. Resource not found for the segment '${b ?? a ?? ""}'.`
    );
}

// ── The viewer page's state and buttons ────────────────────────────────────

export interface MicrosoftSnapshot {
    now: number;
    tenant: string;
    accounts: { oid: string; email: string; name: string; jobTitle: string; driveId: string }[];
    sites: StandInSite[];
    drives: StandInDrive[];
    items: {
        id: string;
        driveId: string;
        parent: string | null;
        name: string;
        kind: StandInItem["kind"];
        size: number;
        version: number;
    }[];
    mailFolders: StandInMailFolder[];
    messages: {
        id: string;
        oid: string;
        folderId: string;
        conversationId: string;
        subject: string;
        from: string;
        receivedAt: number;
        isDraft: boolean;
        attachments: number;
    }[];
    accessTokens: number;
    refreshTokens: number;
    calls: MicrosoftWorld["calls"];
}

export function microsoftSnapshot(): MicrosoftSnapshot {
    const w = microsoftWorld();
    const now = standInClock.now();
    return {
        now,
        tenant: TENANT_ID,
        accounts: ACCOUNTS.map(a => ({
            oid: a.oid,
            email: a.email,
            name: a.name,
            jobTitle: a.jobTitle,
            driveId: a.driveId,
        })),
        sites: w.sites,
        drives: Object.values(w.drives),
        items: Object.values(w.items).map(item => ({
            id: item.id,
            driveId: item.driveId,
            parent: item.parent,
            name: item.name,
            kind: item.kind,
            size: sizeOf(w, item),
            version: item.version,
        })),
        mailFolders: Object.values(w.mailFolders),
        messages: newestFirst(Object.values(w.messages)).map(m => ({
            id: m.id,
            oid: m.oid,
            folderId: m.folderId,
            conversationId: m.conversationId,
            subject: m.subject,
            from: m.from.name,
            receivedAt: Date.parse(m.receivedDateTime),
            isDraft: m.isDraft,
            attachments: m.attachments.length,
        })),
        accessTokens: Object.values(w.tokens).filter(t => t.expiresAt > now).length,
        refreshTokens: Object.keys(w.refreshTokens).length,
        calls: w.calls.slice(0, 30),
    };
}

const DEFAULT_EDIT_ITEM = "od-engagement-letter";
const DEFAULT_FOLDER = "od-workpapers";
const DEFAULT_CONVERSATION = "conv-morgan-planning-meeting";

async function action(req: Request): Promise<Response> {
    const body = await readJson(req);
    const input = isRecord(body) ? body : {};
    const text = (key: string) => {
        const value = input[key];
        return typeof value === "string" ? value : undefined;
    };
    const w = microsoftWorld();
    try {
        switch (input.action) {
            case "reset":
                resetMicrosoftWorld();
                break;
            case "edit-file":
                editFile(w, text("itemId") ?? DEFAULT_EDIT_ITEM, text("content"));
                break;
            case "remove-file": {
                // Without a target: the first file left in Workpapers.
                const folder = w.items[DEFAULT_FOLDER];
                const target =
                    text("itemId") ??
                    (folder ? childrenOf(w, folder).find(i => i.kind === "file")?.id : undefined);
                if (!target) return json({ error: "There is no file left to remove." }, 400);
                deleteItem(w, target);
                break;
            }
            case "add-file":
                addFile(
                    w,
                    text("parentId") ?? DEFAULT_FOLDER,
                    text("name") ??
                        `WP-${String(childrenOf(w, w.items[DEFAULT_FOLDER]!).length + 1).padStart(2, "0")} Added ${new Date(standInClock.now()).toISOString().slice(11, 19).replace(/:/g, "")}.md`,
                    text("content") ??
                        "# Added later\n\nThis workpaper was added to the folder after it was imported.\n"
                );
                break;
            case "new-reply":
                addMessage(w, text("conversationId") ?? DEFAULT_CONVERSATION, {
                    text: text("text"),
                });
                break;
            case "delete-message": {
                const target = text("messageId");
                if (!target) return json({ error: "messageId is required." }, 400);
                deleteMessage(w, target);
                break;
            }
            case "revoke-grants":
                revokeGrants(w, text("oid"));
                break;
            case "invalidate-delta":
                invalidateDeltaTokens(w);
                break;
            default:
                return json({ error: "unknown action" }, 400);
        }
    } catch (err) {
        return json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
    return json(microsoftSnapshot());
}

// ── Router ─────────────────────────────────────────────────────────────────

async function route(req: Request): Promise<Response> {
    const w = microsoftWorld();
    const url = new URL(req.url);
    const method = req.method.toUpperCase();
    const segments = segmentsAfter(req, MICROSOFT_BASE_PATH);
    const [a, b, c, d] = segments;

    if (a === "consent" && !b && method === "POST") return consent(w, req);
    if (a === "_standin") {
        if (b === "state" && method === "GET") return json(microsoftSnapshot());
        if (b === "action" && method === "POST") return action(req);
    }
    if (a === "graph" && b === "v1.0") return graph(w, req, url, segments.slice(2));
    // Any tenant segment: a GUID, a domain, "common", "organizations".
    if (a && b === "oauth2" && c === "v2.0" && d === "token" && method === "POST") {
        return token(w, req);
    }
    return json(
        { error: { code: "notFound", message: `No stand-in for ${method} ${url.pathname}` } },
        404
    );
}

export async function handleMicrosoftRequest(req: Request): Promise<Response> {
    const response = await route(req);
    const w = microsoftWorld();
    // The viewer's own polling would drown the log.
    const path = displayPath(req, MICROSOFT_BASE_PATH);
    if (!path.startsWith("/_standin/state")) {
        w.calls.unshift({
            at: standInClock.now(),
            method: req.method,
            path,
            status: response.status,
        });
        if (w.calls.length > 60) w.calls.length = 60;
    }
    return response;
}
