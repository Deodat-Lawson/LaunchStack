/** @jest-environment node */

/**
 * Screenshots are re-encoded before they are stored: upright WebP, no
 * metadata (a phone photo's GPS must not reach a triager), capped in size,
 * and anything that is not one of the contract's image types is refused
 * with a 400.
 */

jest.mock("server-only", () => ({}), { virtual: true });

import sharp from "sharp";

import { MAX_EDGE, normalizeFeedbackImage } from "~/server/feedback/images";
import { isWorkspaceError } from "~/server/workspace/errors";

async function png(width: number, height: number): Promise<Buffer> {
    return sharp({
        create: { width, height, channels: 3, background: { r: 200, g: 40, b: 90 } },
    })
        .png()
        .toBuffer();
}

/** A JPEG carrying EXIF (camera, GPS-ish text) and a quarter-turn orientation. */
async function phoneJpeg(): Promise<Buffer> {
    return sharp({
        create: { width: 300, height: 100, channels: 3, background: { r: 10, g: 120, b: 200 } },
    })
        .jpeg()
        .withMetadata({
            orientation: 6,
            exif: { IFD0: { Make: "PhoneCo", Model: "Snapper 9", Artist: "GPS 51.5N 0.12W" } },
        })
        .toBuffer();
}

async function refusal(promise: Promise<unknown>): Promise<{ status: number; key: string }> {
    try {
        await promise;
    } catch (error) {
        if (isWorkspaceError(error)) return { status: error.status, key: error.copy?.key ?? "" };
        throw error;
    }
    throw new Error("expected a refusal");
}

describe("normalizeFeedbackImage", () => {
    it("re-encodes to WebP and drops every metadata block", async () => {
        const input = await phoneJpeg();
        const inputMeta = await sharp(input).metadata();
        expect(inputMeta.exif).toBeDefined();
        expect(inputMeta.orientation).toBe(6);

        const out = await normalizeFeedbackImage(input, "image/jpeg");

        expect(out.contentType).toBe("image/webp");
        expect(out.byteSize).toBe(out.data.length);
        const meta = await sharp(out.data).metadata();
        expect(meta.format).toBe("webp");
        expect(meta.exif).toBeUndefined();
        expect(meta.icc).toBeUndefined();
        expect(meta.xmp).toBeUndefined();
        expect(meta.orientation).toBeUndefined();
        expect(out.data.includes(Buffer.from("PhoneCo"))).toBe(false);
        expect(out.data.includes(Buffer.from("GPS 51.5N"))).toBe(false);
        // The quarter turn is applied, not forgotten: 300×100 stored shows as 100×300.
        expect([out.width, out.height]).toEqual([100, 300]);
        expect([meta.width, meta.height]).toEqual([100, 300]);
    });

    it("caps the long edge and never enlarges", async () => {
        const wide = await normalizeFeedbackImage(await png(5120, 1280), "image/png");
        expect([wide.width, wide.height]).toEqual([MAX_EDGE, 640]);

        const small = await normalizeFeedbackImage(await png(640, 400), "");
        expect([small.width, small.height]).toEqual([640, 400]);
    });

    it("takes GIF and WebP as well as PNG and JPEG", async () => {
        const base = sharp({
            create: { width: 40, height: 30, channels: 3, background: { r: 0, g: 0, b: 0 } },
        });
        const gif = await base.clone().gif().toBuffer();
        const webp = await base.clone().webp().toBuffer();
        expect((await normalizeFeedbackImage(gif, "image/gif")).contentType).toBe("image/webp");
        expect((await normalizeFeedbackImage(webp, "image/webp")).width).toBe(40);
    });

    it("refuses what is not an image", async () => {
        await expect(
            refusal(normalizeFeedbackImage(Buffer.from("not an image at all"), "image/png"))
        ).resolves.toEqual({ status: 400, key: "errors.feedback.imageUnreadable" });
    });

    it("refuses a declared type outside the contract, and a decoded one too", async () => {
        await expect(
            refusal(normalizeFeedbackImage(await png(10, 10), "text/html"))
        ).resolves.toEqual({ status: 400, key: "errors.feedback.imageType" });

        // A real TIFF that claims to be nothing: decodable, but not ours to keep.
        const tiff = await sharp(await png(10, 10))
            .tiff()
            .toBuffer();
        await expect(refusal(normalizeFeedbackImage(tiff, null))).resolves.toEqual({
            status: 400,
            key: "errors.feedback.imageType",
        });
    });

    it("refuses empty and oversized files before decoding", async () => {
        await expect(refusal(normalizeFeedbackImage(Buffer.alloc(0)))).resolves.toEqual({
            status: 400,
            key: "errors.feedback.imageEmpty",
        });
        await expect(
            refusal(normalizeFeedbackImage(Buffer.alloc(5 * 1024 * 1024 + 1), "image/png"))
        ).resolves.toEqual({ status: 400, key: "errors.feedback.imageTooLarge" });
    });
});
