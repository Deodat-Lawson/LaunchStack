/**
 * Byte ranges are what let a `<video>`/`<audio>` element seek a stored file
 * (RFC 9110 §14). A wrong answer here is a player that cannot seek, or one
 * that plays the wrong bytes.
 */

import {
    forwardRangeInit,
    partialContentHeaders,
    rangeNotSatisfiable,
    relayedRangeResponse,
    resolveByteRange,
} from "~/server/storage/byte-range";

describe("resolveByteRange", () => {
    const SIZE = 1000;

    it("sends everything when there is no Range header", () => {
        expect(resolveByteRange(null, SIZE)).toEqual({ kind: "full" });
        expect(resolveByteRange("", SIZE)).toEqual({ kind: "full" });
    });

    it("serves a closed range", () => {
        expect(resolveByteRange("bytes=0-99", SIZE)).toEqual({
            kind: "partial",
            start: 0,
            end: 99,
        });
    });

    it("serves an open-ended range to the last byte — the one a seek sends", () => {
        expect(resolveByteRange("bytes=500-", SIZE)).toEqual({
            kind: "partial",
            start: 500,
            end: 999,
        });
    });

    it("serves the last N bytes for a suffix range — how an MP4 index is read", () => {
        expect(resolveByteRange("bytes=-100", SIZE)).toEqual({
            kind: "partial",
            start: 900,
            end: 999,
        });
        // A suffix longer than the file is the whole file.
        expect(resolveByteRange("bytes=-5000", SIZE)).toEqual({
            kind: "partial",
            start: 0,
            end: 999,
        });
    });

    it("clamps an end past the file to the last byte", () => {
        expect(resolveByteRange("bytes=900-5000", SIZE)).toEqual({
            kind: "partial",
            start: 900,
            end: 999,
        });
    });

    it("tolerates whitespace and a capitalised unit", () => {
        expect(resolveByteRange("Bytes = 10 - 20", SIZE)).toEqual({
            kind: "partial",
            start: 10,
            end: 20,
        });
    });

    it("refuses a range that starts past the end", () => {
        expect(resolveByteRange("bytes=1000-", SIZE)).toEqual({ kind: "unsatisfiable" });
        expect(resolveByteRange("bytes=2000-3000", SIZE)).toEqual({ kind: "unsatisfiable" });
        expect(resolveByteRange("bytes=-0", SIZE)).toEqual({ kind: "unsatisfiable" });
        expect(resolveByteRange("bytes=-10", 0)).toEqual({ kind: "unsatisfiable" });
    });

    it("ignores what it may ignore: other units, multiple ranges, garbage, inverted ranges", () => {
        for (const header of [
            "items=0-5",
            "bytes=0-10,20-30",
            "bytes=abc",
            "bytes=-",
            "bytes=50-10",
        ]) {
            expect(resolveByteRange(header, SIZE)).toEqual({ kind: "full" });
        }
    });
});

describe("partialContentHeaders / rangeNotSatisfiable", () => {
    it("describes the slice being sent", () => {
        expect(partialContentHeaders({ start: 10, end: 19 }, 100)).toEqual({
            "Accept-Ranges": "bytes",
            "Content-Range": "bytes 10-19/100",
            "Content-Length": "10",
        });
    });

    it("answers 416 with the file's size", () => {
        const res = rangeNotSatisfiable(100);
        expect(res.status).toBe(416);
        expect(res.headers.get("Content-Range")).toBe("bytes */100");
    });
});

describe("forwardRangeInit", () => {
    it("passes a browser's Range on to storage as plain-object headers", () => {
        const request = new Request("http://localhost/x", { headers: { Range: "bytes=5-" } });
        expect(forwardRangeInit(request)).toEqual({ headers: { Range: "bytes=5-" } });
    });

    it("adds nothing when the browser asked for the whole file", () => {
        expect(forwardRangeInit(new Request("http://localhost/x"))).toBeUndefined();
    });
});

describe("relayedRangeResponse", () => {
    it("passes a ranged storage answer through as 206", () => {
        const upstream = new Response("abc", {
            status: 206,
            headers: { "content-range": "bytes 0-2/10", "content-length": "3" },
        });
        expect(relayedRangeResponse(upstream)).toEqual({
            status: 206,
            headers: {
                "Accept-Ranges": "bytes",
                "Content-Range": "bytes 0-2/10",
                "Content-Length": "3",
            },
        });
    });

    it("relays storage's 416", () => {
        const upstream = new Response(null, {
            status: 416,
            headers: { "content-range": "bytes */10" },
        });
        expect(relayedRangeResponse(upstream).status).toBe(416);
    });

    it("answers 200 when storage ignored the range and sent everything", () => {
        const upstream = new Response("abcdefghij", {
            status: 200,
            headers: { "content-length": "10" },
        });
        expect(relayedRangeResponse(upstream)).toEqual({
            status: 200,
            headers: { "Accept-Ranges": "bytes", "Content-Length": "10" },
        });
    });
});
