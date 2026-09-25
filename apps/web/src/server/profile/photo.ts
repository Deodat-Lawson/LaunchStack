/**
 * Turns an uploaded image into the bytes we store for a profile photo.
 *
 * Whatever arrives — a phone JPG with EXIF rotation and GPS, a PNG with
 * transparency, the first frame of a GIF — leaves as a square WebP of
 * `PROFILE_PHOTO.outputSize` px with every metadata block dropped. The
 * browser has usually cropped to a square already; a non-square upload
 * (the API, an older client) is centre-cropped here.
 */

import sharp from "sharp";

import { PROFILE_PHOTO } from "~/lib/profile/fields";

export class ProfilePhotoError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ProfilePhotoError";
    }
}

export interface NormalizedPhoto {
    data: Buffer;
    mimeType: "image/webp";
    width: number;
    height: number;
    byteSize: number;
}

/** sharp's names for what we decode. `heif` is AVIF here; HEVC-coded HEIC is not decodable. */
const READABLE_FORMATS = new Set(["jpeg", "png", "webp", "gif", "heif"]);

/** A large phone photo is ~50 MP; beyond this is a decompression bomb, not a portrait. */
const MAX_INPUT_PIXELS = 80_000_000;

const UNREADABLE = `That file isn't an image we can read. Use a ${PROFILE_PHOTO.acceptLabel}.`;

export async function normalizeProfilePhoto(input: Buffer): Promise<NormalizedPhoto> {
    if (input.length === 0) throw new ProfilePhotoError("That file is empty.");
    if (input.length > PROFILE_PHOTO.maxBytes) {
        const mb = Math.round(PROFILE_PHOTO.maxBytes / (1024 * 1024));
        throw new ProfilePhotoError(`Photos can be up to ${mb} MB.`);
    }

    let meta: sharp.Metadata;
    try {
        meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    } catch {
        throw new ProfilePhotoError(UNREADABLE);
    }
    if (!meta.format || !READABLE_FORMATS.has(meta.format)) throw new ProfilePhotoError(UNREADABLE);
    if (meta.format === "heif" && meta.compression !== "av1") {
        throw new ProfilePhotoError(
            "HEIC photos aren't supported. Export it as a JPG and try again."
        );
    }

    // EXIF orientations 5–8 are quarter turns: the displayed width is the
    // stored height. The minimum applies to what the person saw.
    const turned = (meta.orientation ?? 1) >= 5;
    const width = (turned ? meta.height : meta.width) ?? 0;
    const height = (turned ? meta.width : meta.height) ?? 0;
    if (Math.min(width, height) < PROFILE_PHOTO.minSide) {
        const min = PROFILE_PHOTO.minSide;
        throw new ProfilePhotoError(`Use an image at least ${min}×${min} pixels.`);
    }

    try {
        const size = PROFILE_PHOTO.outputSize;
        const { data, info } = await sharp(input, {
            limitInputPixels: MAX_INPUT_PIXELS,
            // Phone JPGs are often a few bytes truncated; that is a warning,
            // not a reason to refuse someone's photo.
            failOn: "error",
        })
            .rotate()
            .resize(size, size, { fit: "cover", position: "centre" })
            .webp({ quality: 86 })
            .toBuffer({ resolveWithObject: true });
        return {
            data,
            mimeType: "image/webp",
            width: info.width,
            height: info.height,
            byteSize: data.length,
        };
    } catch {
        throw new ProfilePhotoError("That image couldn't be processed. Try a different file.");
    }
}
