import "server-only";

/**
 * Turns a screenshot someone attached to a report into the bytes we store.
 *
 * Whatever arrives — a PNG from the clipboard, a phone JPG with EXIF rotation
 * and GPS, the first frame of a GIF — leaves as a WebP no longer than
 * `MAX_EDGE` px on its long side, upright, with every metadata block dropped
 * (sharp writes none unless asked). Anything sharp cannot decode, or that is
 * not one of the contract's types once decoded, is refused with a 400: the
 * declared content type is the browser's guess and is checked, never trusted.
 */

import sharp from "sharp";

import { copy } from "~/i18n/copy";
import { FEEDBACK_LIMITS } from "~/lib/feedback/contract";
import { badRequest } from "~/server/workspace/errors";

export interface NormalizedFeedbackImage {
    data: Buffer;
    contentType: "image/webp";
    width: number;
    height: number;
    byteSize: number;
}

/** Long edge of the stored image. A 5K screenshot halves; a laptop's stays as it is. */
export const MAX_EDGE = 2560;
const WEBP_QUALITY = 85;

/** sharp's names for the contract's `attachmentTypes`. */
const READABLE_FORMATS = new Set(["png", "jpeg", "webp", "gif"]);

/** An 8K screenshot is ~33 MP; beyond this is a decompression bomb, not a screen. */
const MAX_INPUT_PIXELS = 50_000_000;

const ALLOWED_TYPES: ReadonlySet<string> = new Set(FEEDBACK_LIMITS.attachmentTypes);

export async function normalizeFeedbackImage(
    input: Buffer,
    declaredType?: string | null
): Promise<NormalizedFeedbackImage> {
    if (input.length === 0) throw badRequest(copy("errors.feedback.imageEmpty"));
    if (input.length > FEEDBACK_LIMITS.attachmentBytesMax) {
        const mb = Math.round(FEEDBACK_LIMITS.attachmentBytesMax / (1024 * 1024));
        throw badRequest(copy("errors.feedback.imageTooLarge", { mb }));
    }
    const declared = declaredType?.split(";")[0]?.trim().toLowerCase();
    if (declared && !ALLOWED_TYPES.has(declared)) {
        throw badRequest(copy("errors.feedback.imageType"));
    }

    let meta: sharp.Metadata;
    try {
        meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    } catch {
        throw badRequest(copy("errors.feedback.imageUnreadable"));
    }
    if (!meta.format || !READABLE_FORMATS.has(meta.format)) {
        throw badRequest(copy("errors.feedback.imageType"));
    }

    try {
        const { data, info } = await sharp(input, {
            limitInputPixels: MAX_INPUT_PIXELS,
            // A few truncated bytes are a warning, not a reason to lose the report.
            failOn: "error",
        })
            .rotate()
            .resize({
                width: MAX_EDGE,
                height: MAX_EDGE,
                fit: "inside",
                withoutEnlargement: true,
            })
            .webp({ quality: WEBP_QUALITY })
            .toBuffer({ resolveWithObject: true });
        return {
            data,
            contentType: "image/webp",
            width: info.width,
            height: info.height,
            byteSize: data.length,
        };
    } catch {
        throw badRequest(copy("errors.feedback.imageProcessFailed"));
    }
}
