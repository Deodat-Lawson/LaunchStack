import { describe, expect, it } from "vitest";

import type { ReadablePage } from "@launchstack/tools/web-research";

import { discoverPictures } from "./pictures";

const page = (url: string, over: Partial<ReadablePage> = {}): ReadablePage => ({
    url,
    finalUrl: url,
    status: 200,
    contentType: "text/html",
    title: null,
    text: "",
    truncated: false,
    fetchedAt: "2026-11-13T00:00:00Z",
    ...over,
});

describe("discoverPictures", () => {
    it("takes what the homepage declares, without asking for the favicon", async () => {
        const asked: string[] = [];
        const pictures = await discoverPictures("acme.example", async url => {
            asked.push(url);
            return page(url, {
                image: "https://acme.example/og.jpg",
                icon: "https://acme.example/i.png",
            });
        });
        expect(pictures).toEqual({
            imageUrl: "https://acme.example/og.jpg",
            iconUrl: "https://acme.example/i.png",
        });
        expect(asked).toEqual(["https://acme.example/"]);
    });

    it("falls back to the site's own /favicon.ico when the homepage declares nothing", async () => {
        const pictures = await discoverPictures("acme.example", async url =>
            url.endsWith("/favicon.ico")
                ? page(url, { contentType: "image/x-icon" })
                : page(url, { image: null, icon: null })
        );
        expect(pictures).toEqual({ imageUrl: null, iconUrl: "https://acme.example/favicon.ico" });
    });

    it("keeps none when the site has none, or cannot be read: nothing is guessed", async () => {
        const html404 = await discoverPictures("acme.example", async url =>
            url.endsWith("/favicon.ico")
                ? page(url, { status: 404, contentType: "text/html" })
                : page(url)
        );
        expect(html404).toBeNull();
        const down = await discoverPictures("down.example", async () => {
            throw new Error("ECONNREFUSED");
        });
        expect(down).toBeNull();
    });
});
