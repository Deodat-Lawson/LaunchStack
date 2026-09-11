/**
 * logo-consistency.test.ts proves the *sources* all draw the same mark. It
 * cannot see the favicon, because favicon.ico is a raster derived from
 * icon.svg — and that derivation is where the mark was actually lost.
 *
 * The committed .ico rendered the artwork at roughly a fifth of the canvas in
 * the top-left corner on opaque white: 97% of every frame was blank, and at
 * the 16px a browser tab actually uses, the logo was three purple pixels. The
 * SVG it came from was correct the whole time, so every source-level check
 * passed while the thing users see was wrong.
 *
 * So this asserts on the pixels. PNG decoding here is deliberately hand-rolled
 * against node:zlib rather than pulling in an image library for one test.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

const REPO_ROOT = join(__dirname, "../../../..");
const WEB_ICO = "apps/web/public/favicon.ico";
const LANDING_ICO = "apps/landing/public/favicon.ico";

/** Sizes a browser, a bookmark bar, and a pinned tab actually ask for. */
const REQUIRED_SIZES = [16, 32, 48, 64, 128, 256];

type IcoEntry = { size: number; png: Buffer };

function parseIco(buf: Buffer): IcoEntry[] {
    expect(buf.readUInt16LE(0)).toBe(0); // reserved
    expect(buf.readUInt16LE(2)).toBe(1); // type: icon
    const count = buf.readUInt16LE(4);

    const entries: IcoEntry[] = [];
    for (let i = 0; i < count; i++) {
        const at = 6 + 16 * i;
        const size = buf.readUInt8(at) || 256; // 0 means 256
        const bytes = buf.readUInt32LE(at + 8);
        const offset = buf.readUInt32LE(at + 12);
        entries.push({ size, png: buf.subarray(offset, offset + bytes) });
    }
    return entries;
}

type Decoded = { width: number; height: number; pixels: Buffer };

/** Minimal decoder: 8-bit RGBA, non-interlaced — what every rasterizer emits. */
function decodePng(png: Buffer): Decoded {
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");

    let width = 0;
    let height = 0;
    const idat: Buffer[] = [];
    let pos = 8;
    while (pos < png.length) {
        const length = png.readUInt32BE(pos);
        const type = png.toString("ascii", pos + 4, pos + 8);
        const data = png.subarray(pos + 8, pos + 8 + length);
        if (type === "IHDR") {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            expect(data.readUInt8(8)).toBe(8); // bit depth
            expect(data.readUInt8(9)).toBe(6); // colour type: RGBA
            expect(data.readUInt8(12)).toBe(0); // non-interlaced
        } else if (type === "IDAT") {
            idat.push(data);
        } else if (type === "IEND") {
            break;
        }
        pos += 12 + length; // length + type + data + crc
    }

    const raw = inflateSync(Buffer.concat(idat));
    const bpp = 4;
    const stride = width * bpp;
    const out = Buffer.alloc(height * stride);

    // Undo the per-scanline filters (PNG spec §9).
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        for (let x = 0; x < stride; x++) {
            const a = x >= bpp ? out[y * stride + x - bpp]! : 0; // left
            const b = y > 0 ? out[(y - 1) * stride + x]! : 0; // up
            const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp]! : 0; // up-left
            const raws = line[x]!;
            let value: number;
            switch (filter) {
                case 0:
                    value = raws;
                    break;
                case 1:
                    value = raws + a;
                    break;
                case 2:
                    value = raws + b;
                    break;
                case 3:
                    value = raws + ((a + b) >> 1);
                    break;
                case 4: {
                    const p = a + b - c;
                    const pa = Math.abs(p - a);
                    const pb = Math.abs(p - b);
                    const pc = Math.abs(p - c);
                    value = raws + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
                    break;
                }
                default:
                    throw new Error(`unknown PNG filter ${String(filter)}`);
            }
            out[y * stride + x] = value & 0xff;
        }
    }
    return { width, height, pixels: out };
}

function coverage({ width, height, pixels }: Decoded) {
    let opaque = 0;
    let white = 0;
    for (let i = 0; i < width * height; i++) {
        const r = pixels[i * 4]!;
        const g = pixels[i * 4 + 1]!;
        const b = pixels[i * 4 + 2]!;
        const a = pixels[i * 4 + 3]!;
        if (a > 8) {
            opaque++;
            if (r === 255 && g === 255 && b === 255) white++;
        }
    }
    const total = width * height;
    return { opaque: opaque / total, blank: (total - opaque + white) / total };
}

describe.each([
    ["apps/web", WEB_ICO],
    ["apps/landing", LANDING_ICO],
])("%s favicon.ico", (_app, relPath) => {
    const entries = parseIco(readFileSync(join(REPO_ROOT, relPath)));

    it("ships every size a browser asks for", () => {
        expect(entries.map(e => e.size).sort((a, b) => a - b)).toEqual(REQUIRED_SIZES);
    });

    it.each(REQUIRED_SIZES)("draws the mark across the whole %ipx canvas", size => {
        const entry = entries.find(e => e.size === size);
        if (!entry) throw new Error(`no ${size}px entry`);
        const decoded = decodePng(entry.png);

        expect([decoded.width, decoded.height]).toEqual([size, size]);

        // The mark is a rounded tile rotated 6°, so it covers most — not all —
        // of the frame. Anything far below this means it was rendered small
        // inside a larger canvas, which is exactly the bug this guards.
        const { opaque, blank } = coverage(decoded);
        expect(opaque).toBeGreaterThan(0.6);

        // ...and the frame must not be overwhelmingly empty or flat white.
        expect(blank).toBeLessThan(0.5);
    });
});

it("both apps ship byte-identical favicons", () => {
    expect(
        readFileSync(join(REPO_ROOT, WEB_ICO)).equals(readFileSync(join(REPO_ROOT, LANDING_ICO)))
    ).toBe(true);
});
