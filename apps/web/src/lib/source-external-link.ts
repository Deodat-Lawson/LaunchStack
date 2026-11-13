/**
 * Where a source opens outside LaunchStack.
 *
 * A file that came from somewhere opens there: a Drive file in Drive, a
 * Notion page in Notion, a Gmail thread in Gmail, a saved page on its site, a
 * video on its platform, an artifact on claude.ai, a vault note in Obsidian, a
 * repository on GitHub. Everything else (an upload, a note written here, a
 * saved conversation) opens as the stored file in a browser tab, where the
 * browser shows a PDF or an image itself and hands a Word or Excel file to
 * the app that opens it.
 *
 * The documents list works this out per row and the viewer and row menus only
 * read it. Every address is checked or rebuilt from validated ids, so a stored
 * `javascript:` URL never reaches a link.
 */
import { artifactMarkerOf } from "~/lib/artifact-document";
import { isClaudeHostedUrl } from "~/lib/artifact-content";
import { transcriptMarkerOf } from "~/lib/media-document";
import { mediaEmbedFor } from "~/lib/media-embed";
import { websiteMarkerOf } from "~/lib/website-document";

export const EXTERNAL_LINK_KINDS = [
    "google-drive",
    "notion",
    "gmail",
    "obsidian",
    "github",
    "youtube",
    "claude",
    "web",
    "file",
] as const;

export type ExternalLinkKind = (typeof EXTERNAL_LINK_KINDS)[number];

export interface SourceExternalLink {
    kind: ExternalLinkKind;
    /** Absolute for every kind but `file`, which is this app's own path to the stored bytes. */
    url: string;
}

/**
 * An importer's note of where a file came from, for sources no connector
 * marks in its own way (a GitHub repository today). Kept in `ocr_metadata`,
 * which OCR completion merges into rather than replaces.
 */
export const ORIGIN_URL_KEY = "originUrl";
/**
 * On an archive: the address each file inside it sits under. Archive
 * expansion (packages/conversion) gives every extracted file its own
 * `originUrl` from it, and the project summary the archive's own.
 */
export const ORIGIN_ENTRY_BASE_URL_KEY = "originEntryBaseUrl";

export function originUrlMarker(url: string): Record<typeof ORIGIN_URL_KEY, string> {
    return { [ORIGIN_URL_KEY]: url };
}

function repoBase(owner: string, repo: string): string {
    return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function refPath(branch: string): string {
    return branch.split("/").map(encodeURIComponent).join("/");
}

/** `https://github.com/<owner>/<repo>`, at the branch when one was named. */
export function githubRepoUrl(owner: string, repo: string, branch?: string | null): string {
    const base = repoBase(owner, repo);
    return branch ? `${base}/tree/${refPath(branch)}` : base;
}

/**
 * What a GitHub import writes on its archive: the repository, and where each
 * file in it lives — on the branch imported, or `HEAD` (the default branch)
 * when none was named.
 */
export function githubRepoOrigin(
    owner: string,
    repo: string,
    branch?: string | null
): Record<typeof ORIGIN_URL_KEY | typeof ORIGIN_ENTRY_BASE_URL_KEY, string> {
    return {
        [ORIGIN_URL_KEY]: githubRepoUrl(owner, repo, branch),
        [ORIGIN_ENTRY_BASE_URL_KEY]: `${repoBase(owner, repo)}/blob/${branch ? refPath(branch) : "HEAD"}/`,
    };
}

export interface ExternalLinkContext {
    /** `users.id` of the person reading, as a string. */
    viewerUserPk: string;
    /** `users.id` owning each per-member connection, keyed by connection id. */
    connectionOwners: ReadonlyMap<string, string>;
}

export interface ExternalLinkInput {
    ocrMetadata: unknown;
    /** The stored file as this app serves it — the address its preview loads. */
    fileUrl: string | null;
    /** The Drive file a linked document opens in (`document_drive_links`, status linked). */
    driveLinkUrl?: string | null;
}

const DRIVE_ID = /^[A-Za-z0-9_-]{10,128}$/;
const NOTION_ID = /^[0-9a-f]{32}$/i;

/** Google's own editors, by the Drive MIME type of a native file. */
const GOOGLE_EDITORS: Record<string, string> = {
    "application/vnd.google-apps.document": "document",
    "application/vnd.google-apps.spreadsheet": "spreadsheets",
    "application/vnd.google-apps.presentation": "presentation",
    "application/vnd.google-apps.drawing": "drawings",
    "application/vnd.google-apps.form": "forms",
};

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

/** An http(s) address, normalised; null for anything else. */
function webUrl(value: unknown, hosts?: (host: string) => boolean): string | null {
    if (typeof value !== "string" || !value) return null;
    try {
        const url = new URL(value);
        if (url.protocol !== "https:" && url.protocol !== "http:") return null;
        if (hosts && !hosts(url.hostname.toLowerCase())) return null;
        return url.href;
    } catch {
        return null;
    }
}

function isDriveHost(host: string): boolean {
    return host === "drive.google.com" || host === "docs.google.com";
}

function isNotionHost(host: string): boolean {
    return (
        host === "notion.so" ||
        host.endsWith(".notion.so") ||
        host === "notion.site" ||
        host.endsWith(".notion.site")
    );
}

/** A Drive file's page, in Google's own editor when it is a native Doc, Sheet or Slides. */
export function driveFileUrl(fileId: string, mimeType?: unknown): string | null {
    if (!DRIVE_ID.test(fileId)) return null;
    const editor = typeof mimeType === "string" ? GOOGLE_EDITORS[mimeType] : undefined;
    return editor
        ? `https://docs.google.com/${editor}/d/${fileId}/edit`
        : `https://drive.google.com/file/d/${fileId}/view`;
}

function fromConnector(
    metadata: Record<string, unknown>,
    context: ExternalLinkContext
): SourceExternalLink | null | undefined {
    switch (metadata.connector) {
        case "google-drive": {
            const id = typeof metadata.driveFileId === "string" ? metadata.driveFileId : "";
            const url = driveFileUrl(id, metadata.driveMimeType);
            return url ? { kind: "google-drive", url } : null;
        }
        case "notion": {
            const url = webUrl(metadata.notionUrl, isNotionHost);
            if (url) return { kind: "notion", url };
            const id =
                typeof metadata.notionPageId === "string"
                    ? metadata.notionPageId.replace(/-/g, "")
                    : "";
            return NOTION_ID.test(id)
                ? { kind: "notion", url: `https://www.notion.so/${id}` }
                : null;
        }
        case "gmail": {
            // A thread opens only in its owner's mailbox; anyone it was shared
            // with gets the stored copy instead of Gmail's "not found".
            const owner =
                typeof metadata.connectionId === "string"
                    ? context.connectionOwners.get(metadata.connectionId)
                    : undefined;
            if (owner !== context.viewerUserPk) return null;
            const url = webUrl(metadata.gmailLink, host => host === "mail.google.com");
            return url ? { kind: "gmail", url } : null;
        }
        case "obsidian": {
            // The vault is on its owner's computer, so only they can open it there.
            if (metadata.obsidianOwner !== context.viewerUserPk) return null;
            const vault = typeof metadata.obsidianVault === "string" ? metadata.obsidianVault : "";
            const path = typeof metadata.obsidianPath === "string" ? metadata.obsidianPath : "";
            if (!vault || !path) return null;
            return {
                kind: "obsidian",
                url: `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(path)}`,
            };
        }
        default:
            return undefined;
    }
}

/**
 * The one place a source opens outside LaunchStack, or null when it has no
 * origin and no stored file (a mindmap, a row still being written).
 */
export function sourceExternalLink(
    input: ExternalLinkInput,
    context: ExternalLinkContext
): SourceExternalLink | null {
    const metadata = record(input.ocrMetadata);
    const file: SourceExternalLink | null = input.fileUrl
        ? { kind: "file", url: input.fileUrl }
        : null;

    if (metadata) {
        const connector = fromConnector(metadata, context);
        // A connector's own file whose origin cannot be opened by this reader
        // still opens as the stored copy.
        if (connector !== undefined) return connector ?? file;
    }

    const linked = webUrl(input.driveLinkUrl, isDriveHost);
    if (linked) return { kind: "google-drive", url: linked };

    if (!metadata) return file;

    const origin = webUrl(metadata[ORIGIN_URL_KEY]);
    if (origin) {
        const host = new URL(origin).hostname.toLowerCase();
        return { kind: host === "github.com" ? "github" : "web", url: origin };
    }

    const website = websiteMarkerOf(metadata);
    if (website) return { kind: "web", url: website.url };

    const videoUrl = webUrl(transcriptMarkerOf(metadata)?.videoUrl);
    if (videoUrl) {
        const embed = mediaEmbedFor(videoUrl);
        return embed?.provider === "youtube"
            ? { kind: "youtube", url: embed.watchUrl }
            : { kind: "web", url: videoUrl };
    }

    const artifactUrl = webUrl(artifactMarkerOf(metadata)?.sourceUrl);
    if (artifactUrl) {
        return { kind: isClaudeHostedUrl(artifactUrl) ? "claude" : "web", url: artifactUrl };
    }

    return file;
}

/** Whether a value read back from the API is a link this module made. */
export function isSourceExternalLink(value: unknown): value is SourceExternalLink {
    const link = record(value);
    return (
        link !== null &&
        typeof link.url === "string" &&
        link.url.length > 0 &&
        (EXTERNAL_LINK_KINDS as readonly unknown[]).includes(link.kind)
    );
}

/**
 * What to show for where it opens: the site's name for a web address
 * ("notion.so", "github.com/acme/app"), null for the stored file and for an
 * app link, which have no address worth reading.
 */
export function externalLinkHost(link: SourceExternalLink): string | null {
    if (link.kind === "file" || link.kind === "obsidian") return null;
    try {
        const url = new URL(link.url);
        const host = url.hostname.replace(/^www\./, "");
        if (link.kind === "github") {
            const [owner, repo] = url.pathname.split("/").filter(Boolean);
            return owner && repo ? `${host}/${owner}/${repo}` : host;
        }
        return host;
    } catch {
        return null;
    }
}
