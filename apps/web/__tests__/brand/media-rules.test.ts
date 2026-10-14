/**
 * The networks' image rules, checked when a post is saved rather than at
 * its scheduled time: LinkedIn takes no WebP, Bluesky no image over ~1 MB.
 */
jest.mock("~/lib/storage", () => ({ fetchFile: jest.fn(), uploadFile: jest.fn() }));
jest.mock("~/server/db", () => ({ db: {} }));

import { mediaProblem, networkMediaProblem } from "~/server/brand/media";

describe("networkMediaProblem", () => {
    it("LinkedIn refuses WebP and takes the rest", () => {
        expect(networkMediaProblem("linkedin", [{ mimeType: "image/webp", size: 10 }])).toMatch(
            /WebP/
        );
        expect(
            networkMediaProblem("linkedin", [{ mimeType: "image/png", size: 4_000_000 }])
        ).toBeNull();
    });

    it("Bluesky refuses an image over 1 MB and takes WebP", () => {
        expect(
            networkMediaProblem("bluesky", [{ mimeType: "image/png", size: 1_000_001 }])
        ).toMatch(/1 MB/);
        expect(
            networkMediaProblem("bluesky", [{ mimeType: "image/webp", size: 900_000 }])
        ).toBeNull();
    });

    it("networks without images ignore them", () => {
        expect(networkMediaProblem("x", [{ mimeType: "image/webp", size: 9_000_000 }])).toBeNull();
    });
});

describe("mediaProblem (upload)", () => {
    it("takes JPEG, PNG, GIF and WebP up to 5 MB", () => {
        expect(mediaProblem("image/gif", 1)).toBeNull();
        expect(mediaProblem("image/svg+xml", 1)).toMatch(/JPG, PNG, GIF or WebP/);
        expect(mediaProblem("image/png", 0)).toMatch(/empty/);
        expect(mediaProblem("image/png", 5 * 1024 * 1024 + 1)).toMatch(/5 MB/);
    });
});
