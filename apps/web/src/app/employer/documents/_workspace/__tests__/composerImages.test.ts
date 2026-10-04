/** @jest-environment jsdom */

import { heicTo } from "heic-to/csp";
import {
    needsComposerImagePreparation,
    normalizeComposerFile,
    resizeComposerImage,
} from "../composerImages";
import { delimitedPreview, fencedPreview } from "../attachmentPreview";
import { IMAGE_MAX_BYTES } from "../composerState";

jest.mock("heic-to/csp", () => ({ heicTo: jest.fn() }));
const convertHeic = jest.mocked(heicTo);

beforeEach(() => convertHeic.mockReset());

describe("Portable image preparation", () => {
    it("keeps supported small images byte-for-byte", async () => {
        const file = new File(["image"], "small.png", { type: "image/png" });
        expect(await resizeComposerImage(file)).toBe(file);
    });

    it("infers known image MIME types when the browser omits them", () => {
        const normalized = normalizeComposerFile(new File(["image"], "PHOTO.JPEG"));
        expect(normalized.type).toBe("image/jpeg");
        expect(normalized.name).toBe("PHOTO.JPEG");
        expect(normalizeComposerFile(new File(["unknown"], "notes.unknown")).type).toBe("");
    });

    it("converts a HEIC image locally with the CSP decoder before upload", async () => {
        convertHeic.mockResolvedValue(new Blob(["jpeg"], { type: "image/jpeg" }));
        const file = new File(["heic"], "Portrait.HEIC");
        expect(needsComposerImagePreparation(file)).toBe(true);
        const converted = await resizeComposerImage(file);
        expect(convertHeic).toHaveBeenCalledWith({
            blob: expect.any(File),
            type: "image/jpeg",
            quality: 0.9,
        });
        expect(converted.name).toBe("Portrait.jpg");
        expect(converted.type).toBe("image/jpeg");
        expect(converted.size).toBe(4);
    });

    it("reports an actionable error for an invalid HEIC instead of uploading it", async () => {
        convertHeic.mockRejectedValue(new Error("Invalid HEIC container"));
        await expect(
            resizeComposerImage(new File(["bad"], "broken.heif", { type: "image/heif" }))
        ).rejects.toThrow("Export it as JPEG or PNG");
    });

    it("resizes an oversized image before upload and closes the decoded bitmap", async () => {
        const file = new File(["image"], "large.jpg", { type: "image/jpeg" });
        Object.defineProperty(file, "size", { value: IMAGE_MAX_BYTES + 1 });
        const bitmap = { width: 8192, height: 4096, close: jest.fn() };
        const original = globalThis.createImageBitmap;
        Object.defineProperty(globalThis, "createImageBitmap", {
            configurable: true,
            value: jest.fn().mockResolvedValue(bitmap),
        });
        const drawImage = jest.fn();
        const canvas = jest
            .spyOn(HTMLCanvasElement.prototype, "getContext")
            .mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
        const encode = jest
            .spyOn(HTMLCanvasElement.prototype, "toBlob")
            .mockImplementation(callback =>
                callback(new Blob(["smaller"], { type: "image/jpeg" }))
            );
        const resized = await resizeComposerImage(file);
        expect(resized.name).toBe("large.jpg");
        expect(resized.size).toBeLessThan(IMAGE_MAX_BYTES);
        expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 4096, 2048);
        expect(bitmap.close).toHaveBeenCalled();
        canvas.mockRestore();
        encode.mockRestore();
        Object.defineProperty(globalThis, "createImageBitmap", {
            configurable: true,
            value: original,
        });
    });
});

describe("Attachment previews", () => {
    it("renders quoted CSV cells, escaped quotes, and line breaks without HTML execution", () => {
        const preview = delimitedPreview(
            'Name,Notes\r\nA,"two, cells"\r\nB,"said ""hi"""\r\nC,<script>',
            ","
        );
        expect(preview).toContain("| A | two, cells |");
        expect(preview).toContain('said "hi"');
        expect(preview).toContain("&lt;script&gt;");
    });

    it("uses fences longer than code inside a file", () => {
        expect(fencedPreview("```\n![external](https://example.com/image.png)", "text")).toMatch(
            /^````text\n/
        );
    });
});
