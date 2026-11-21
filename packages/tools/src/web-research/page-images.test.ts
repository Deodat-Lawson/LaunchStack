import { describe, expect, it } from "vitest";

import { pageImages } from "./fetch";

describe("pageImages", () => {
    it("takes the share image and the touch icon a page declares, made absolute", () => {
        const html = `<html><head>
            <meta property="og:image" content="/img/hero.jpg">
            <link rel="icon" href="/favicon.ico">
            <link rel="apple-touch-icon" href="https://cdn.example.com/touch.png">
        </head><body>Hi</body></html>`;
        expect(pageImages(html, "https://acme.example/about")).toEqual({
            image: "https://acme.example/img/hero.jpg",
            icon: "https://cdn.example.com/touch.png",
        });
    });

    it("falls back to twitter:image and a plain icon, with any quoting", () => {
        const html = `<head><meta name='twitter:image' content='https://acme.example/t.png'/><link rel="shortcut icon" href=/f.png></head>`;
        expect(pageImages(html, "https://acme.example/")).toEqual({
            image: "https://acme.example/t.png",
            icon: "https://acme.example/f.png",
        });
    });

    it("keeps only https: no http, no data URIs, nothing guessed", () => {
        const html = `<head><meta property="og:image" content="http://acme.example/a.jpg"><link rel="icon" href="data:image/png;base64,AAA"></head>`;
        expect(pageImages(html, "https://acme.example/")).toEqual({ image: null, icon: null });
        expect(pageImages("<p>no head</p>", "https://acme.example/")).toEqual({
            image: null,
            icon: null,
        });
    });
});
