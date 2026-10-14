/**
 * Images for Brand posts. Compose uploads them as soon as they are picked;
 * they sit in the app's object storage until the post goes out, because the
 * networks take the bytes at publish time (a LinkedIn image upload belongs
 * to one author, a Bluesky blob is dropped if no post claims it soon).
 */
import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import type { PublishMedia } from "@launchstack/tools/social-publish";

import { fetchFile, uploadFile } from "~/lib/storage";
import { db } from "~/server/db";
import { brandMedia, type BrandMediaRow } from "~/server/db/schema/brand";

export const BRAND_MEDIA_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
/** LinkedIn takes far more; Bluesky caps an image at about 1 MB, which its client checks. */
export const BRAND_MEDIA_MAX_BYTES = 5 * 1024 * 1024;

export interface BrandMediaView {
    id: string;
    url: string;
    mimeType: string;
    name: string | null;
    size: number;
    alt: string | null;
}

export class BrandMediaError extends Error {
    /** Read by the shared route error handler, which passes status and code through. */
    readonly code = "media_invalid";
    constructor(
        message: string,
        readonly status: number
    ) {
        super(message);
        this.name = "BrandMediaError";
    }
}

/** The same-origin URL a signed-in member's browser loads the image from. */
export function brandMediaUrl(id: string): string {
    return `/api/brand/media/${encodeURIComponent(id)}`;
}

export function toMediaView(row: BrandMediaRow, alt: string | null = null): BrandMediaView {
    return {
        id: row.id,
        url: brandMediaUrl(row.id),
        mimeType: row.mimeType,
        name: row.name ?? null,
        size: row.size,
        alt,
    };
}

export function mediaProblem(mimeType: string, size: number): string | null {
    if (!(BRAND_MEDIA_TYPES as readonly string[]).includes(mimeType))
        return "Use a JPG, PNG, GIF or WebP image.";
    if (size === 0) return "That file is empty.";
    if (size > BRAND_MEDIA_MAX_BYTES) return "Images can be up to 5 MB.";
    return null;
}

/** Bluesky refuses an image blob over this many bytes. */
export const BLUESKY_MAX_IMAGE_BYTES = 1_000_000;

/**
 * Why a network would refuse these images, checked when the post is saved
 * rather than at its scheduled time: LinkedIn takes no WebP, Bluesky no
 * image over about 1 MB. Null when the network takes them (or ignores media).
 */
export function networkMediaProblem(
    platform: string,
    media: ReadonlyArray<Pick<BrandMediaRow, "mimeType" | "size">>
): string | null {
    if (platform === "linkedin" && media.some(m => m.mimeType === "image/webp"))
        return "LinkedIn does not take WebP images. Use JPEG, PNG or GIF.";
    if (platform === "bluesky" && media.some(m => m.size > BLUESKY_MAX_IMAGE_BYTES))
        return "Bluesky takes images up to 1 MB. Use a smaller image or leave Bluesky out.";
    return null;
}

export async function saveBrandMedia(args: {
    companyId: bigint;
    userId: string;
    file: File;
}): Promise<BrandMediaRow> {
    const problem = mediaProblem(args.file.type, args.file.size);
    if (problem) throw new BrandMediaError(problem, 400);
    const id = randomUUID();
    const data = new Uint8Array(await args.file.arrayBuffer());
    const stored = await uploadFile({
        filename: `brand-${id}-${args.file.name || "image"}`,
        data,
        contentType: args.file.type,
        userId: args.userId,
        companyId: args.companyId,
    });
    const [row] = await db
        .insert(brandMedia)
        .values({
            id,
            companyId: args.companyId,
            uploadedByUserId: args.userId,
            storageUrl: stored.url,
            mimeType: args.file.type,
            size: args.file.size,
            name: args.file.name ? args.file.name.slice(0, 300) : null,
        })
        .returning();
    return row!;
}

export async function getBrandMediaRows(
    companyId: bigint,
    ids: readonly string[]
): Promise<BrandMediaRow[]> {
    if (ids.length === 0) return [];
    return db
        .select()
        .from(brandMedia)
        .where(and(eq(brandMedia.companyId, companyId), inArray(brandMedia.id, [...ids])));
}

export async function getBrandMediaRow(
    companyId: bigint,
    id: string
): Promise<BrandMediaRow | null> {
    const [row] = await getBrandMediaRows(companyId, [id]);
    return row ?? null;
}

/** The stored file, for the browser (through the media route) or a network. */
export async function readBrandMedia(row: BrandMediaRow): Promise<Uint8Array> {
    const response = await fetchFile(row.storageUrl);
    if (!response.ok) {
        throw new BrandMediaError(
            `The image ${row.name ?? row.id} could not be read from storage.`,
            502
        );
    }
    return new Uint8Array(await response.arrayBuffer());
}

/** A post's images, in order, ready for a publish adapter. Missing rows are an error, not a silent drop. */
export async function loadPublishMedia(
    companyId: bigint,
    refs: ReadonlyArray<{ id: string; alt: string | null }>
): Promise<PublishMedia[]> {
    if (refs.length === 0) return [];
    const rows = await getBrandMediaRows(
        companyId,
        refs.map(r => r.id)
    );
    const byId = new Map(rows.map(r => [r.id, r]));
    const out: PublishMedia[] = [];
    for (const ref of refs) {
        const row = byId.get(ref.id);
        if (!row) throw new BrandMediaError("An image on this post was deleted.", 404);
        out.push({
            data: await readBrandMedia(row),
            mimeType: row.mimeType,
            alt: ref.alt ?? undefined,
            filename: row.name ?? undefined,
        });
    }
    return out;
}
