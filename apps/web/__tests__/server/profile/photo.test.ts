/** @jest-environment node */

import sharp from "sharp";

import { PROFILE_PHOTO } from "~/lib/profile/fields";
import { normalizeProfilePhoto, ProfilePhotoError } from "~/server/profile/photo";

/** A w×h image: left half red, right half blue — so a turn or a crop is visible. */
async function halves(
    width: number,
    height: number,
    format: "jpeg" | "png" | "gif" | "webp",
    options: { orientation?: number; alpha?: boolean } = {}
): Promise<Buffer> {
    const channels = options.alpha ? 4 : 3;
    const raw = Buffer.alloc(width * height * channels);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const i = (y * width + x) * channels;
            const left = x < width / 2;
            raw[i] = left ? 220 : 20;
            raw[i + 1] = 20;
            raw[i + 2] = left ? 20 : 220;
            if (options.alpha) raw[i + 3] = 128;
        }
    }
    let image = sharp(raw, { raw: { width, height, channels } });
    if (options.orientation) {
        image = image.withMetadata({
            orientation: options.orientation,
            exif: { IFD0: { Copyright: "secret", Artist: "home" } },
        });
    }
    return image.toFormat(format).toBuffer();
}

async function pixel(data: Buffer, x: number, y: number) {
    const { data: raw, info } = await sharp(data).raw().toBuffer({ resolveWithObject: true });
    const i = (y * info.width + x) * info.channels;
    return { r: raw[i]!, g: raw[i + 1]!, b: raw[i + 2]! };
}

describe("normalizeProfilePhoto", () => {
    it("turns a JPG into a square WebP of the stored size", async () => {
        const out = await normalizeProfilePhoto(await halves(800, 600, "jpeg"));
        expect(out.mimeType).toBe("image/webp");
        expect(out).toMatchObject({
            width: PROFILE_PHOTO.outputSize,
            height: PROFILE_PHOTO.outputSize,
        });
        const meta = await sharp(out.data).metadata();
        expect(meta.format).toBe("webp");
        expect(out.byteSize).toBe(out.data.length);
    });

    it("centre-crops a non-square upload", async () => {
        // 1200×400: the centred 400px square straddles the colour boundary.
        const out = await normalizeProfilePhoto(await halves(1200, 400, "png"));
        const left = await pixel(out.data, 10, 256);
        const right = await pixel(out.data, 500, 256);
        expect(left.r).toBeGreaterThan(left.b);
        expect(right.b).toBeGreaterThan(right.r);
    });

    it("applies EXIF rotation and drops every metadata block", async () => {
        // Orientation 6 = displayed turned 90° clockwise: the red left half
        // ends up on top.
        const out = await normalizeProfilePhoto(await halves(400, 400, "jpeg", { orientation: 6 }));
        const top = await pixel(out.data, 256, 20);
        const bottom = await pixel(out.data, 256, 490);
        expect(top.r).toBeGreaterThan(top.b);
        expect(bottom.b).toBeGreaterThan(bottom.r);

        const meta = await sharp(out.data).metadata();
        expect(meta.exif).toBeUndefined();
        expect(meta.orientation).toBeUndefined();
    });

    it("keeps transparency and takes the first frame of a GIF", async () => {
        const png = await normalizeProfilePhoto(await halves(300, 300, "png", { alpha: true }));
        expect((await sharp(png.data).metadata()).hasAlpha).toBe(true);
        const gif = await normalizeProfilePhoto(await halves(300, 300, "gif"));
        expect(gif.width).toBe(PROFILE_PHOTO.outputSize);
    });

    it("refuses what is not a usable photo", async () => {
        await expect(normalizeProfilePhoto(Buffer.alloc(0))).rejects.toThrow("empty");
        await expect(normalizeProfilePhoto(Buffer.from("<svg></svg>"))).rejects.toBeInstanceOf(
            ProfilePhotoError
        );
        await expect(normalizeProfilePhoto(Buffer.from("not an image at all"))).rejects.toThrow(
            "isn't an image"
        );
        await expect(normalizeProfilePhoto(await halves(40, 40, "png"))).rejects.toThrow(
            "at least 64×64"
        );
        await expect(
            normalizeProfilePhoto(Buffer.alloc(PROFILE_PHOTO.maxBytes + 1))
        ).rejects.toThrow("up to 10 MB");
    });
});
