/**
 * Development stand-in for the Google endpoints the Drive connector talks to:
 * OAuth (token, revoke, the consent decision), the slice of Drive v3 the
 * sync reads, and a Picker script. Point the app at it with
 *
 *   GOOGLE_STAND_IN_URL=<origin>/dev/stand-ins/google
 *
 * plus any GOOGLE_OAUTH_CLIENT_ID/SECRET pair (the stand-in accepts any).
 * The consent screen itself is a page — ./o/oauth2/v2/auth/page.tsx — that
 * posts its decision to …/consent here.
 *
 * What it gets right on purpose: the scopes. A drive.file token sees only
 * what was picked, and listing a picked folder returns only children that
 * were granted too, as Google does; drive.readonly sees everything Alex can.
 */

import {
    bytes,
    bearerToken,
    displayPath,
    empty,
    isRecord,
    json,
    originOf,
    readForm,
    readJson,
    redirect,
    segmentsAfter,
} from "../shared/http";
import { standInClock } from "../shared/store";
import { pickerScript } from "./picker-script";
import {
    ACCOUNT,
    FOLDER_MIME,
    GOOGLE_BASE_PATH,
    addFileToFolder,
    editFile,
    fileResource,
    googleWorld,
    nextId,
    pickerListing,
    resetGoogleWorld,
    touch,
    visible,
    type GoogleWorld,
    type StandInFile,
} from "./world";

const ACCESS_TOKEN_SECONDS = 3600;
const CODE_TTL_MS = 10 * 60_000;

function driveError(status: number, reason: string, message: string): Response {
    return json({ error: { code: status, message, errors: [{ reason, message }] } }, status);
}

function oauthError(status: number, error: string, description: string): Response {
    return json({ error, error_description: description }, status);
}

function base64url(value: string): string {
    return Buffer.from(value, "utf8").toString("base64url");
}

/** Unsigned, like the claims the app decodes; nothing verifies it. */
function idToken(): string {
    return [
        base64url(JSON.stringify({ alg: "none", typ: "JWT" })),
        base64url(JSON.stringify({ sub: ACCOUNT.sub, email: ACCOUNT.email, name: ACCOUNT.name })),
        "stand-in",
    ].join(".");
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

function scopesOf(w: GoogleWorld, req: Request): string[] | null {
    const token = bearerToken(req);
    const issued = token ? w.tokens[token] : undefined;
    if (!issued || issued.expiresAt <= standInClock.now()) return null;
    return issued.scopes;
}

function unauthenticated(): Response {
    return driveError(401, "authError", "Request had invalid authentication credentials.");
}

function notFound(id: string): Response {
    return driveError(404, "notFound", `File not found: ${id}.`);
}

function readable(w: GoogleWorld, scopes: string[], id: string): StandInFile | null {
    const file = w.files[id];
    return file && visible(w, scopes, file) ? file : null;
}

// ── OAuth ──────────────────────────────────────────────────────────────────

async function token(w: GoogleWorld, req: Request): Promise<Response> {
    const form = await readForm(req);
    const grant = form.get("grant_type");
    if (!form.get("client_id") || !form.get("client_secret")) {
        return oauthError(401, "invalid_client", "The OAuth client was not found.");
    }
    if (grant === "authorization_code") {
        const code = w.codes[form.get("code") ?? ""];
        if (
            !code ||
            code.expiresAt <= standInClock.now() ||
            code.redirectUri !== form.get("redirect_uri") ||
            code.clientId !== form.get("client_id")
        ) {
            return oauthError(400, "invalid_grant", "Malformed auth code.");
        }
        delete w.codes[form.get("code")!];
        const access = nextId(w, "ya29.standin");
        const refresh = nextId(w, "1//standin");
        w.tokens[access] = {
            scopes: code.scopes,
            expiresAt: standInClock.now() + ACCESS_TOKEN_SECONDS * 1000,
        };
        w.refreshTokens[refresh] = code.scopes;
        return json({
            access_token: access,
            expires_in: ACCESS_TOKEN_SECONDS,
            refresh_token: refresh,
            scope: code.scopes.join(" "),
            token_type: "Bearer",
            id_token: idToken(),
        });
    }
    if (grant === "refresh_token") {
        const scopes = w.refreshTokens[form.get("refresh_token") ?? ""];
        if (!scopes) return oauthError(400, "invalid_grant", "Token has been expired or revoked.");
        const access = nextId(w, "ya29.standin");
        w.tokens[access] = { scopes, expiresAt: standInClock.now() + ACCESS_TOKEN_SECONDS * 1000 };
        return json({
            access_token: access,
            expires_in: ACCESS_TOKEN_SECONDS,
            scope: scopes.join(" "),
            token_type: "Bearer",
        });
    }
    return oauthError(400, "unsupported_grant_type", `Invalid grant_type: ${grant ?? ""}`);
}

async function revoke(w: GoogleWorld, req: Request): Promise<Response> {
    const form = await readForm(req);
    const value = form.get("token") ?? new URL(req.url).searchParams.get("token") ?? "";
    delete w.tokens[value];
    delete w.refreshTokens[value];
    return empty(200);
}

/** The consent page's Allow / Cancel, sent back to the app like Google does. */
async function consent(w: GoogleWorld, req: Request): Promise<Response> {
    const form = await readForm(req);
    const back = acceptableRedirect(form.get("redirect_uri"));
    if (!back) return new Response("redirect_uri must point at this machine", { status: 400 });
    const state = form.get("state");
    if (state !== null) back.searchParams.set("state", state);
    if (form.get("decision") !== "allow") {
        back.searchParams.set("error", "access_denied");
        return redirect(back.toString(), 303);
    }
    // Ticked scopes, plus identity, which Google never lets anyone untick.
    const scopes = [...new Set([...form.getAll("scope"), "openid", "email"])];
    const code = nextId(w, "4/standin");
    w.codes[code] = {
        clientId: form.get("client_id") ?? "",
        redirectUri: form.get("redirect_uri")!,
        scopes,
        expiresAt: standInClock.now() + CODE_TTL_MS,
    };
    back.searchParams.set("code", code);
    back.searchParams.set("scope", scopes.join(" "));
    return redirect(back.toString(), 303);
}

// ── Drive v3 ───────────────────────────────────────────────────────────────

function listFiles(w: GoogleWorld, scopes: string[], url: URL): Response {
    const q = url.searchParams.get("q") ?? "";
    const parent = /'([^']+)' in parents/.exec(q)?.[1];
    // Anything else the app might query (Drive-linked files' own folder) has
    // no match here.
    if (!parent) return json({ kind: "drive#fileList", files: [] });
    const driveId = url.searchParams.get("driveId");
    const files = Object.values(w.files).filter(
        f =>
            f.parent === parent &&
            !(q.includes("trashed = false") && f.trashed) &&
            (!driveId || f.driveId === driveId) &&
            visible(w, scopes, f)
    );
    return json({ kind: "drive#fileList", files: files.map(fileResource) });
}

function getFile(w: GoogleWorld, scopes: string[], id: string, url: URL): Response {
    const file = readable(w, scopes, id);
    if (!file) return notFound(id);
    if (url.searchParams.get("alt") === "media") {
        if (file.mimeType.startsWith("application/vnd.google-apps.")) {
            return driveError(
                403,
                "fileNotDownloadable",
                "Only files with binary content can be downloaded. Use Export with Docs Editors files."
            );
        }
        return bytes(new TextEncoder().encode(file.content ?? ""), file.mimeType);
    }
    return json(fileResource(file));
}

function exportFile(w: GoogleWorld, scopes: string[], id: string, url: URL): Response {
    const file = readable(w, scopes, id);
    if (!file) return notFound(id);
    const target = url.searchParams.get("mimeType") ?? "";
    if (
        file.mimeType === FOLDER_MIME ||
        !file.mimeType.startsWith("application/vnd.google-apps.")
    ) {
        return driveError(403, "fileNotExportable", "Export only supports Docs Editors files.");
    }
    if (target !== "text/markdown" && target !== "text/plain") {
        return driveError(
            400,
            "badRequest",
            `The stand-in exports Docs as Markdown, not ${target}.`
        );
    }
    return bytes(new TextEncoder().encode(file.content ?? ""), target);
}

function changes(w: GoogleWorld, scopes: string[], url: URL): Response {
    const from = Number(url.searchParams.get("pageToken") ?? "0");
    const entries = w.changes
        .filter(c => c.seq > from)
        .flatMap(c => {
            const file = w.files[c.fileId];
            return file && visible(w, scopes, file)
                ? [
                      {
                          kind: "drive#change",
                          fileId: file.id,
                          removed: false,
                          file: fileResource(file),
                      },
                  ]
                : [];
        });
    return json({
        kind: "drive#changeList",
        changes: entries,
        newStartPageToken: String(w.seq),
    });
}

// ── Picker support ─────────────────────────────────────────────────────────

function pickerItems(w: GoogleWorld, req: Request, url: URL): Response {
    if (!scopesOf(w, req)) return unauthenticated();
    const view = url.searchParams.get("view");
    const parent = url.searchParams.get("parent");
    const items = pickerListing(
        w,
        view === "shared" || view === "drives" ? view : "all",
        parent ?? null
    ).map(f => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        owner: f.ownedByMe ? "me" : f.owner,
    }));
    return json({ items });
}

/** What a real pick does under drive.file: the app may now open these ids. */
async function grant(w: GoogleWorld, req: Request): Promise<Response> {
    if (!scopesOf(w, req)) return unauthenticated();
    const body = await readJson(req);
    const raw = isRecord(body) && Array.isArray(body.ids) ? (body.ids as unknown[]) : [];
    const ids = raw.filter((id): id is string => typeof id === "string");
    for (const id of ids) {
        if (w.files[id] && !w.granted.includes(id)) {
            w.granted.push(id);
            touch(w, id);
        }
    }
    return json({ granted: w.granted });
}

export interface GoogleSnapshot {
    now: number;
    account: typeof ACCOUNT;
    files: StandInFile[];
    granted: string[];
    tokens: number;
    calls: GoogleWorld["calls"];
}

export function googleSnapshot(): GoogleSnapshot {
    const w = googleWorld();
    return {
        now: standInClock.now(),
        account: ACCOUNT,
        files: Object.values(w.files),
        granted: [...w.granted],
        tokens: Object.keys(w.tokens).length,
        calls: w.calls.slice(0, 30),
    };
}

async function action(req: Request): Promise<Response> {
    const body = (await readJson(req)) as Record<string, unknown> | undefined;
    const w = googleWorld();
    switch (body?.action) {
        case "reset":
            resetGoogleWorld();
            break;
        case "add-file":
            addFileToFolder(
                w,
                typeof body.folderId === "string" ? body.folderId : "sa-financials",
                typeof body.name === "string"
                    ? body.name
                    : `Added ${new Date().toLocaleTimeString()}.md`,
                typeof body.content === "string"
                    ? body.content
                    : "# Added later\n\nThis file was added to the folder after it was imported.\n"
            );
            break;
        case "edit-file":
            editFile(
                w,
                typeof body.fileId === "string" ? body.fileId : "sa-readme",
                "\nEdited after the import: the data room now also holds the pitch deck.\n"
            );
            break;
        case "forget-grants":
            w.granted = [];
            break;
        default:
            return json({ error: "unknown action" }, 400);
    }
    return json(googleSnapshot());
}

// ── Router ─────────────────────────────────────────────────────────────────

async function route(req: Request): Promise<Response> {
    const w = googleWorld();
    const url = new URL(req.url);
    const method = req.method.toUpperCase();
    const [a, b, c, d, e] = segmentsAfter(req, GOOGLE_BASE_PATH);

    if (a === "token" && method === "POST") return token(w, req);
    if (a === "revoke" && method === "POST") return revoke(w, req);
    if (a === "consent" && method === "POST") return consent(w, req);
    if (a === "picker" && b === "api.js") {
        return new Response(pickerScript(`${originOf(req)}${GOOGLE_BASE_PATH}`), {
            headers: {
                "content-type": "application/javascript; charset=utf-8",
                "cache-control": "no-store",
            },
        });
    }
    if (a === "_standin") {
        if (b === "state" && method === "GET") return json(googleSnapshot());
        if (b === "action" && method === "POST") return action(req);
        if (b === "picker" && method === "GET") return pickerItems(w, req, url);
        if (b === "grant" && method === "POST") return grant(w, req);
    }

    if (a === "drive" && b === "v3" && method === "GET") {
        const scopes = scopesOf(w, req);
        if (!scopes) return unauthenticated();
        if (c === "files" && !d) return listFiles(w, scopes, url);
        if (c === "files" && d && !e) return getFile(w, scopes, d, url);
        if (c === "files" && d && e === "export") return exportFile(w, scopes, d, url);
        if (c === "changes" && d === "startPageToken") {
            return json({ kind: "drive#startPageToken", startPageToken: String(w.seq) });
        }
        if (c === "changes" && !d) return changes(w, scopes, url);
    }
    if ((a === "drive" || a === "upload") && method !== "GET") {
        return driveError(501, "notImplemented", "The stand-in does not write files.");
    }
    return driveError(404, "notFound", `No stand-in for ${method} ${url.pathname}`);
}

export async function handleGoogleRequest(req: Request): Promise<Response> {
    const response = await route(req);
    const w = googleWorld();
    // The picker script and the viewer's own polling would drown the log.
    const path = displayPath(req, GOOGLE_BASE_PATH);
    if (!path.startsWith("/_standin/state") && !path.startsWith("/picker/")) {
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
