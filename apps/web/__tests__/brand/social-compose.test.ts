/**
 * Growth › Brand Compose: where LinkedIn folds a post, which files can be
 * attached, and what a channel does with the images it is given.
 */

import {
    MEDIA_MAX_BYTES,
    channelMediaNote,
    fileSize,
    mediaRejection,
    overLimit,
    postLength,
    previewText,
} from "~/app/employer/tools/growth/brand/_lib/compose";

const CAPS = { publish: true, images: true, analytics: true, comments: true };

describe("previewText", () => {
    it("shows a short post whole", () => {
        expect(previewText("  Short and sweet.  ")).toEqual({
            shown: "Short and sweet.",
            more: false,
        });
    });

    it("folds a long post at the last word break before 210 characters", () => {
        const text = `${"word ".repeat(60)}end`;
        const { shown, more } = previewText(text);
        expect(more).toBe(true);
        expect(shown.length).toBeLessThanOrEqual(210);
        expect(shown.endsWith("word")).toBe(true);
        expect(text.startsWith(shown)).toBe(true);
    });

    it("cuts mid-word only when there is no break late enough", () => {
        const text = "x".repeat(300);
        expect(previewText(text)).toEqual({ shown: "x".repeat(210), more: true });
    });

    it("folds after the third line even when the post is short", () => {
        const text = "one\ntwo\nthree\nfour\nfive";
        expect(previewText(text)).toEqual({ shown: "one\ntwo\nthree", more: true });
    });

    it("three lines exactly is not folded", () => {
        expect(previewText("one\ntwo\nthree")).toEqual({ shown: "one\ntwo\nthree", more: false });
    });

    it("exactly 210 characters is not folded", () => {
        const text = "a".repeat(210);
        expect(previewText(text)).toEqual({ shown: text, more: false });
    });
});

describe("mediaRejection", () => {
    it.each(["image/jpeg", "image/png", "image/gif", "image/webp"])("takes %s", type => {
        expect(mediaRejection({ type, size: 1000 })).toBeNull();
    });

    it("refuses other types, naming the file", () => {
        expect(mediaRejection({ type: "image/svg+xml", size: 10, name: "logo.svg" })).toBe(
            "logo.svg: attach a JPEG, PNG, GIF or WebP image."
        );
        expect(mediaRejection({ type: "video/mp4", size: 10 })).toMatch(/JPEG, PNG, GIF or WebP/);
    });

    it("refuses anything over 5 MB", () => {
        expect(mediaRejection({ type: "image/png", size: MEDIA_MAX_BYTES })).toBeNull();
        expect(mediaRejection({ type: "image/png", size: MEDIA_MAX_BYTES + 1 })).toMatch(
            /5 MB at most/
        );
    });
});

describe("channelMediaNote", () => {
    const linkedin = { name: "LaunchStack", platform: "linkedin" as const, capabilities: CAPS };
    const bluesky = {
        name: "launchstack.bsky.social",
        platform: "bluesky" as const,
        capabilities: CAPS,
    };
    const textOnly = {
        name: "Dana Okafor",
        platform: "linkedin" as const,
        capabilities: { ...CAPS, images: false },
    };
    const png = { mimeType: "image/png" };
    const webp = { mimeType: "image/webp" };

    it("says nothing without images", () => {
        expect(channelMediaNote(textOnly, [])).toBeNull();
    });

    it("a channel without image support posts the text only", () => {
        expect(channelMediaNote(textOnly, [png])).toEqual({
            tone: "note",
            text: "Dana Okafor will post the text only.",
        });
    });

    it("WebP on LinkedIn is an error; elsewhere it is fine", () => {
        expect(channelMediaNote(linkedin, [png, webp])?.tone).toBe("error");
        expect(channelMediaNote(linkedin, [png])).toBeNull();
        expect(channelMediaNote(bluesky, [webp])).toBeNull();
    });

    it("a text-only channel never complains about WebP", () => {
        expect(channelMediaNote(textOnly, [webp])?.tone).toBe("note");
    });

    it("blocks an image Bluesky would refuse for size, before it fails at publish time", () => {
        const big = { mimeType: "image/jpeg", size: 2_400_000 };
        expect(channelMediaNote(bluesky, [png, big])).toEqual({
            tone: "error",
            text: "Bluesky takes images up to 1 MB. Use a smaller image or leave Bluesky out.",
        });
        expect(channelMediaNote(linkedin, [big])).toBeNull();
        expect(channelMediaNote(bluesky, [{ mimeType: "image/png", size: 900_000 }])).toBeNull();
    });
});

describe("limits", () => {
    it("counts the trimmed text", () => {
        expect(postLength("  hello \n")).toBe(5);
    });

    it("over the limit only past it, never without one", () => {
        expect(overLimit({ limit: 5 }, "hello")).toBe(false);
        expect(overLimit({ limit: 5 }, "hello!")).toBe(true);
        expect(overLimit({ limit: null }, "x".repeat(100_000))).toBe(false);
    });
});

describe("fileSize", () => {
    it.each([
        [500, "1 KB"],
        [340 * 1024, "340 KB"],
        [1.25 * 1024 * 1024, "1.3 MB"],
    ])("%s bytes → %s", (bytes, expected) => {
        expect(fileSize(bytes)).toBe(expected);
    });
});
