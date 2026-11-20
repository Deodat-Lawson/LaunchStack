import "server-only";

/**
 * A picture of a saved web page, for the website viewer.
 *
 * A website source keeps the page's HTML (with a `<base>` pointing back at the
 * site, so its stylesheets and images resolve). It cannot be shown live: most
 * company sites refuse to be framed inside another app, and framed in an
 * isolated sandbox the saved copy renders blank. So Gotenberg's Chromium
 * screenshots it (JavaScript off, as for every user HTML it renders; ADR-009),
 * the shot is shrunk to a WebP, stored like any other file, and remembered in
 * the document's `ocrMetadata.websitePreview` against the HTML it was taken
 * of. Later opens read the stored picture; a new version of the HTML is a new
 * `document.url`, which takes a new shot.
 */

import { createHash, randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import sharp from "sharp";

import { document } from "@launchstack/store/schema";
import type { GotenbergClient } from "@launchstack/document-conversion-engine";

import { fetchFile, uploadFile } from "~/lib/storage";
import { planObjectDeletion } from "~/server/storage/deletion/plan";
import { db } from "~/server/db";

/** The browser window the page is laid out in: an ordinary laptop. */
export const PREVIEW_WINDOW = { width: 1280, height: 800 } as const;

/** Stored width in pixels: sharp on a high-density screen at the viewer's width. */
export const STORED_WIDTH = 1600;

/**
 * Tallest stored picture. WebP stops at 16,383 px; at 1,600 px wide this is
 * about 12,800 px of page, longer than nearly every homepage.
 */
export const MAX_STORED_HEIGHT = 16_000;

/** Chromium shoots at twice the window's density: 2,560 px wide, and long pages run tall. */
const MAX_INPUT_PIXELS = 200_000_000;

const WEBP_QUALITY = 80;

export const WEBSITE_PREVIEW_CONTENT_TYPE = "image/webp";

/** What `ocrMetadata.websitePreview` holds. */
export interface WebsitePreviewRecord {
    /** Where the picture is stored. */
    url: string;
    /** The `document.url` (the saved HTML) it was taken of. */
    source: string;
    width: number;
    height: number;
    /** The page ran past {@link MAX_STORED_HEIGHT}; the picture is its top. */
    truncated: boolean;
    renderedAt: string;
}

export interface WebsitePreview {
    record: WebsitePreviewRecord;
    image: Buffer;
}

/** The record in a document row's `ocrMetadata`, or null when there is none. */
export function websitePreviewOf(ocrMetadata: unknown): WebsitePreviewRecord | null {
    if (!ocrMetadata || typeof ocrMetadata !== "object" || Array.isArray(ocrMetadata)) {
        return null;
    }
    const value = (ocrMetadata as { websitePreview?: unknown }).websitePreview;
    if (!value || typeof value !== "object") return null;
    const record = value as Partial<Record<keyof WebsitePreviewRecord, unknown>>;
    if (typeof record.url !== "string" || !record.url) return null;
    if (typeof record.source !== "string" || !record.source) return null;
    return {
        url: record.url,
        source: record.source,
        width: typeof record.width === "number" ? record.width : 0,
        height: typeof record.height === "number" ? record.height : 0,
        truncated: record.truncated === true,
        renderedAt: typeof record.renderedAt === "string" ? record.renderedAt : "",
    };
}

/** An ETag for the stored picture: it changes exactly when the stored file does. */
export function websitePreviewEtag(record: WebsitePreviewRecord): string {
    return `"${createHash("sha1").update(record.url).digest("hex").slice(0, 20)}"`;
}

/**
 * Chromium's full-page shot, as stored: at most {@link STORED_WIDTH} wide,
 * cut at {@link MAX_STORED_HEIGHT}, WebP, no metadata.
 */
export async function shrinkScreenshot(
    shot: Buffer,
    limits: { width?: number; maxHeight?: number } = {}
): Promise<{ data: Buffer; width: number; height: number; truncated: boolean }> {
    const maxWidth = limits.width ?? STORED_WIDTH;
    const maxHeight = limits.maxHeight ?? MAX_STORED_HEIGHT;
    const options = { limitInputPixels: MAX_INPUT_PIXELS, sequentialRead: true } as const;
    const meta = await sharp(shot, options).metadata();
    if (!meta.width || !meta.height) throw new Error("The screenshot has no dimensions");

    const scale = Math.min(1, maxWidth / meta.width);
    const width = Math.max(1, Math.round(meta.width * scale));
    const fullHeight = Math.max(1, Math.round(meta.height * scale));
    const height = Math.min(fullHeight, maxHeight);

    // extract() after resize() crops the resized image.
    const data = await sharp(shot, options)
        .resize({ width, height: fullHeight, fit: "fill" })
        .extract({ left: 0, top: 0, width, height })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();
    return { data, width, height, truncated: fullHeight > height };
}

export interface RenderInput {
    documentId: number;
    /** `document.url`: the saved HTML. */
    source: string;
    gotenberg: GotenbergClient;
    /** Who the stored file is attributed to. */
    userId: string;
    companyId: bigint;
}

/**
 * Two people opening the same new website at once share one render, not two
 * Chromium runs and two stored files.
 */
const inFlight = new Map<string, Promise<WebsitePreview>>();

export function renderWebsitePreview(input: RenderInput): Promise<WebsitePreview> {
    const key = `${input.documentId}:${input.source}`;
    const running = inFlight.get(key);
    if (running) return running;
    const render = renderAndStore(input).finally(() => inFlight.delete(key));
    inFlight.set(key, render);
    return render;
}

export class WebsiteSourceUnreadableError extends Error {
    constructor(public readonly status: number | null) {
        super(status ? `storage answered ${status}` : "storage unreachable");
        this.name = "WebsiteSourceUnreadableError";
    }
}

async function renderAndStore(input: RenderInput): Promise<WebsitePreview> {
    let html: string;
    try {
        const res = await fetchFile(input.source);
        if (!res.ok) throw new WebsiteSourceUnreadableError(res.status);
        html = await res.text();
    } catch (error) {
        if (error instanceof WebsiteSourceUnreadableError) throw error;
        throw new WebsiteSourceUnreadableError(null);
    }

    const shot = await input.gotenberg.htmlToScreenshot({
        html,
        width: PREVIEW_WINDOW.width,
        height: PREVIEW_WINDOW.height,
        // A lossless PNG of a long page runs to tens of megabytes; this is
        // an intermediate, re-encoded below.
        format: "jpeg",
        quality: 90,
        waitDelay: "1s",
    });
    const picture = await shrinkScreenshot(shot.image);

    const stored = await uploadFile({
        filename: `website-preview-${input.documentId}.webp`,
        data: picture.data,
        contentType: WEBSITE_PREVIEW_CONTENT_TYPE,
        userId: input.userId,
        companyId: input.companyId,
    });

    const record: WebsitePreviewRecord = {
        url: stored.url,
        source: input.source,
        width: picture.width,
        height: picture.height,
        truncated: picture.truncated,
        renderedAt: new Date().toISOString(),
    };

    await db.transaction(async tx => {
        const [current] = await tx
            .select({ url: document.url, ocrMetadata: document.ocrMetadata })
            .from(document)
            .where(eq(document.id, input.documentId))
            .for("update");
        const previous = websitePreviewOf(current?.ocrMetadata);
        const moved = !current || current.url !== input.source;
        const obsoleteUrl = moved ? stored.url : previous?.url;
        if (obsoleteUrl && (moved || obsoleteUrl !== stored.url)) {
            await planObjectDeletion(tx, {
                companyId: input.companyId,
                urls: [obsoleteUrl],
                requestedBy: input.userId,
                reason: "replaced_object",
                traceId: randomUUID(),
            });
        }
        if (moved) return;
        // Merge rather than replacing the website marker and OCR's keys.
        await tx
            .update(document)
            .set({
                ocrMetadata: sql`coalesce(${document.ocrMetadata}, '{}'::jsonb) || jsonb_build_object('websitePreview', ${JSON.stringify(record)}::jsonb)`,
            })
            .where(and(eq(document.id, input.documentId), eq(document.url, input.source)));
    });

    return { record, image: picture.data };
}

/** The stored picture's bytes, or null when the file is gone. */
export async function readStoredPreview(record: WebsitePreviewRecord): Promise<Buffer | null> {
    try {
        const res = await fetchFile(record.url);
        if (!res.ok) return null;
        return Buffer.from(await res.arrayBuffer());
    } catch {
        return null;
    }
}
