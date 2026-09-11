/**
 * Deterministic text-utility tests: numeric normalisation, URL detection,
 * grapheme-aware emoji and length counting, and URL-safe question counting.
 */

import {
    countEmojis,
    countGraphemes,
    countQuestions,
    countUrls,
    effectiveCharLength,
    extractNumerics,
} from "~/lib/agents/evals/campaign/text";

describe("extractNumerics", () => {
    it("normalises thousands separators so 4,000 equals 4000", () => {
        expect(extractNumerics("used by over 4,000 engineering teams")).toEqual(["4000"]);
        expect(extractNumerics("used by over 4000 engineering teams")).toEqual(["4000"]);
    });

    it("keeps decimals and percentages", () => {
        expect(extractNumerics("dwell fell from 14.2 hours; uptime 99.9%")).toEqual([
            "14.2",
            "99.9%",
        ]);
    });
});

describe("countUrls", () => {
    it("counts explicit links", () => {
        expect(countUrls("Read https://fernwoodaudio.example/blog today")).toBe(1);
        expect(countUrls("See http://example.com and https://example.org/x")).toBe(2);
    });

    it("counts bare domains with a path", () => {
        expect(countUrls("Read fernwoodaudio.example/blog today")).toBe(1);
    });

    it("counts a bare domain without a path", () => {
        expect(countUrls("visit fernwoodaudio.example today")).toBe(1);
        expect(countUrls("visit fernwoodaudio.example.")).toBe(1);
    });

    it("does not count prose like node.js", () => {
        expect(countUrls("I write node.js services all day")).toBe(0);
        expect(countUrls("compare fig.1 with fig.2")).toBe(0);
    });

    it("does not double-count a domain that also has a path", () => {
        expect(countUrls("fernwoodaudio.example/blog and fernwoodaudio.example")).toBe(2);
    });
});

describe("countEmojis", () => {
    it("counts emoji-presentation characters", () => {
        expect(countEmojis("Nice 🎉🎉")).toBe(2);
    });

    it("does not count a bare text-default symbol like ©", () => {
        expect(countEmojis("© 2026 Fernwood Audio")).toBe(0);
    });

    it("counts a text-default symbol with an explicit VS16", () => {
        expect(countEmojis("©️")).toBe(1);
    });

    it("counts a flag once", () => {
        expect(countEmojis("Made in 🇺🇸 proudly")).toBe(1);
    });

    it("counts a ZWJ family sequence once", () => {
        expect(countEmojis("Family: 👨‍👩‍👧")).toBe(1);
    });

    it("counts VS16-styled pictographs once each", () => {
        expect(countEmojis("Nice day out 🎙️🌧️")).toBe(2);
    });
});

describe("countQuestions", () => {
    it("ignores question marks inside URLs", () => {
        expect(
            countQuestions("Details: https://example.com/p?utm_source=news&utm_medium=social")
        ).toBe(0);
    });

    it("still counts real questions alongside a UTM link", () => {
        expect(countQuestions("Ready to switch? https://example.com/p?utm_source=x")).toBe(1);
    });
});

describe("grapheme-aware length", () => {
    it("counts astral emoji as one character each", () => {
        expect(countGraphemes("😀😀")).toBe(2);
        expect("😀😀".length).toBe(4); // UTF-16 would overcount
    });

    it("counts a ZWJ family as one character", () => {
        expect(countGraphemes("👨‍👩‍👧")).toBe(1);
    });

    it("weights each URL as 23 characters on X", () => {
        const url = `https://example.com/${"a".repeat(100)}`;
        expect(effectiveCharLength(`Read ${url} now`, "x")).toBe(countGraphemes("Read  now") + 23);
    });

    it("uses plain grapheme counting on other platforms", () => {
        const url = `https://example.com/${"a".repeat(100)}`;
        const text = `Read ${url} now`;
        expect(effectiveCharLength(text, "linkedin")).toBe(countGraphemes(text));
    });
});
