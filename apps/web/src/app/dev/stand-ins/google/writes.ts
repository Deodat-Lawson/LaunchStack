/**
 * The stand-in's Drive writes: the slice Create › File › "Write it in Google
 * Docs" and the in-app editor's save use, no more.
 *
 *   POST  /drive/v3/files                            make a folder (ensureFolder)
 *   POST  /upload/drive/v3/files?uploadType=multipart  HTML → a new Doc
 *   PATCH /upload/drive/v3/files/:id?uploadType=media  HTML → a Doc's new content
 *   PATCH /drive/v3/files/:id                        { trashed: true }
 *
 * A stand-in Doc is Markdown text, so HTML arrives through Turndown the way
 * Google's own import keeps the structure and drops the rest. Anything the
 * app creates is granted to it, as Google does for drive.file.
 */

import TurndownService from "turndown";

import { isRecord, json, originOf, readJson } from "../shared/http";
import { standInClock } from "../shared/store";
import {
    ACCOUNT,
    DOC_MIME,
    FOLDER_MIME,
    GOOGLE_BASE_PATH,
    fileResource,
    nextId,
    touch,
    visible,
    type GoogleWorld,
    type StandInFile,
} from "./world";

const turndown = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    emDelimiter: "*",
});

function driveError(status: number, reason: string, message: string): Response {
    return json({ error: { code: status, message, errors: [{ reason, message }] } }, status);
}

function now(): string {
    return new Date(standInClock.now()).toISOString();
}

/** Where a Doc opens: the stand-in page, scrolled to it. */
function withLink(req: Request, file: StandInFile): Record<string, unknown> {
    return {
        ...fileResource(file),
        webViewLink: `${originOf(req)}${GOOGLE_BASE_PATH}#${file.id}`,
    };
}

function grant(w: GoogleWorld, id: string): void {
    if (!w.granted.includes(id)) w.granted.push(id);
}

/** The body's content only: Google names a Doc from metadata, not `<title>`. */
function htmlToDocText(html: string): string {
    const body = html.replace(/<head[\s\S]*?<\/head>/i, "");
    return turndown.turndown(body).trim() + "\n";
}

/** A multipart/related body's two parts: the JSON metadata and the media. */
function splitMultipart(
    body: string,
    contentType: string
): { metadata: Record<string, unknown>; mediaType: string; media: string } | null {
    const boundary = /boundary=("?)([^";]+)\1/.exec(contentType)?.[2];
    if (!boundary) return null;
    const parts = body
        .split(`--${boundary}`)
        .map(part => part.replace(/^\r\n/, ""))
        .filter(part => part.trim() !== "" && !part.startsWith("--"));
    if (parts.length < 2) return null;
    const parse = (part: string) => {
        const at = part.indexOf("\r\n\r\n");
        const head = at === -1 ? "" : part.slice(0, at);
        const content = (at === -1 ? part : part.slice(at + 4)).replace(/\r\n$/, "");
        const type = /content-type:\s*([^\r\n;]+)/i.exec(head)?.[1]?.trim() ?? "";
        return { type, content };
    };
    const meta = parse(parts[0]!);
    const media = parse(parts[1]!);
    let metadata: unknown;
    try {
        metadata = JSON.parse(meta.content);
    } catch {
        return null;
    }
    return isRecord(metadata) ? { metadata, mediaType: media.type, media: media.content } : null;
}

/** POST /drive/v3/files — a folder in My Drive, which is all the app makes this way. */
export async function createFolder(w: GoogleWorld, req: Request): Promise<Response> {
    const body = await readJson(req);
    if (!isRecord(body) || body.mimeType !== FOLDER_MIME || typeof body.name !== "string") {
        return driveError(501, "notImplemented", "The stand-in only creates folders here.");
    }
    const id = nextId(w, "sa-folder");
    w.files[id] = {
        id,
        name: body.name,
        mimeType: FOLDER_MIME,
        parent: "root",
        owner: ACCOUNT.email,
        ownedByMe: true,
        version: 1,
        modifiedTime: now(),
        trashed: false,
    };
    grant(w, id);
    touch(w, id);
    return json(fileResource(w.files[id]));
}

/** POST /upload/drive/v3/files?uploadType=multipart — HTML converted into a new Doc. */
export async function createDoc(w: GoogleWorld, req: Request): Promise<Response> {
    const parsed = splitMultipart(await req.text(), req.headers.get("content-type") ?? "");
    if (!parsed) return driveError(400, "badRequest", "Malformed multipart body.");
    const { metadata, mediaType, media } = parsed;
    if (metadata.mimeType !== DOC_MIME || mediaType !== "text/html") {
        return driveError(501, "notImplemented", "The stand-in only converts HTML into a new Doc.");
    }
    const parents = Array.isArray(metadata.parents) ? metadata.parents : [];
    const parent = typeof parents[0] === "string" ? parents[0] : "root";
    const id = nextId(w, "sa-doc");
    w.files[id] = {
        id,
        name: typeof metadata.name === "string" ? metadata.name : "Untitled document",
        mimeType: DOC_MIME,
        parent,
        owner: ACCOUNT.email,
        ownedByMe: true,
        content: htmlToDocText(media),
        version: 1,
        modifiedTime: now(),
        trashed: false,
    };
    grant(w, id);
    touch(w, id);
    return json(withLink(req, w.files[id]));
}

/** PATCH /upload/drive/v3/files/:id?uploadType=media — a Doc's content replaced by HTML. */
export async function updateDocMedia(
    w: GoogleWorld,
    scopes: string[],
    id: string,
    req: Request
): Promise<Response> {
    const file = w.files[id];
    if (!file || !visible(w, scopes, file)) {
        return driveError(404, "notFound", `File not found: ${id}.`);
    }
    const type = (req.headers.get("content-type") ?? "").split(";")[0]!.trim();
    if (file.mimeType !== DOC_MIME || type !== "text/html") {
        return driveError(
            501,
            "notImplemented",
            "The stand-in only replaces a Doc's content with HTML."
        );
    }
    file.content = htmlToDocText(await req.text());
    file.version += 1;
    file.modifiedTime = now();
    touch(w, id);
    return json(withLink(req, file));
}

/** PATCH /drive/v3/files/:id — the app only ever trashes. */
export async function patchMetadata(
    w: GoogleWorld,
    scopes: string[],
    id: string,
    req: Request
): Promise<Response> {
    const file = w.files[id];
    if (!file || !visible(w, scopes, file)) {
        return driveError(404, "notFound", `File not found: ${id}.`);
    }
    const body = await readJson(req);
    if (!isRecord(body) || body.trashed !== true) {
        return driveError(501, "notImplemented", "The stand-in only trashes files.");
    }
    file.trashed = true;
    file.version += 1;
    file.modifiedTime = now();
    touch(w, id);
    return json(fileResource(file));
}
