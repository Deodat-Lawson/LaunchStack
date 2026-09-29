import {
    CROP_MAX_ZOOM,
    INITIAL_CROP,
    clampCrop,
    cropLayout,
    cropSourceRect,
    zoomCrop,
} from "~/lib/profile/crop";

const VIEWPORT = 280;
const landscape = { width: 4000, height: 3000 };
const portrait = { width: 1080, height: 1920 };

describe("profile photo crop", () => {
    it("starts as the centred largest square", () => {
        const wide = cropSourceRect(INITIAL_CROP, landscape, VIEWPORT);
        expect(wide.x).toBeCloseTo(500);
        expect(wide.y).toBeCloseTo(0);
        expect(wide.size).toBeCloseTo(3000);
        const tall = cropSourceRect(INITIAL_CROP, portrait, VIEWPORT);
        expect(tall.x).toBeCloseTo(0);
        expect(tall.y).toBeCloseTo(420);
        expect(tall.size).toBeCloseTo(1080);
    });

    it("covers the viewport at zoom 1", () => {
        const layout = cropLayout(INITIAL_CROP, landscape, VIEWPORT);
        expect(layout.height).toBeCloseTo(VIEWPORT);
        expect(layout.width).toBeGreaterThan(VIEWPORT);
        expect(layout.top).toBeCloseTo(0);
    });

    it("never pans past an edge", () => {
        const far = clampCrop({ zoom: 1, offsetX: 10_000, offsetY: 10_000 }, landscape, VIEWPORT);
        // Only the long axis has slack at zoom 1.
        expect(far.offsetY).toBe(0);
        const rect = cropSourceRect(far, landscape, VIEWPORT);
        expect(rect.x).toBeCloseTo(0);
        const back = cropSourceRect({ ...far, offsetX: -10_000 }, landscape, VIEWPORT);
        expect(back.x + back.size).toBeCloseTo(landscape.width);
    });

    it("zooms about the centre and keeps zoom in range", () => {
        const zoomed = zoomCrop(INITIAL_CROP, 2, landscape, VIEWPORT);
        const rect = cropSourceRect(zoomed, landscape, VIEWPORT);
        expect(rect.size).toBeCloseTo(1500);
        expect(rect.x + rect.size / 2).toBeCloseTo(landscape.width / 2);
        expect(rect.y + rect.size / 2).toBeCloseTo(landscape.height / 2);

        expect(zoomCrop(INITIAL_CROP, 99, landscape, VIEWPORT).zoom).toBe(CROP_MAX_ZOOM);
        expect(zoomCrop(INITIAL_CROP, 0.2, landscape, VIEWPORT).zoom).toBe(1);
    });

    it("keeps the point under the centre fixed when zooming a panned crop", () => {
        const panned = clampCrop({ zoom: 2, offsetX: 100, offsetY: 0 }, landscape, VIEWPORT);
        const before = cropSourceRect(panned, landscape, VIEWPORT);
        const after = cropSourceRect(zoomCrop(panned, 3, landscape, VIEWPORT), landscape, VIEWPORT);
        expect(after.x + after.size / 2).toBeCloseTo(before.x + before.size / 2);
    });

    it("stays inside a small image", () => {
        const tiny = { width: 90, height: 70 };
        const rect = cropSourceRect({ zoom: 4, offsetX: 500, offsetY: -500 }, tiny, VIEWPORT);
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.size).toBeLessThanOrEqual(tiny.width + 1e-9);
        expect(rect.y + rect.size).toBeLessThanOrEqual(tiny.height + 1e-9);
    });
});
