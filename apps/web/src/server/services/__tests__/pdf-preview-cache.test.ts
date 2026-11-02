import { PdfPreviewCache } from "../pdf-preview-cache";

function pdf(size: number, fill = "x"): Buffer {
    return Buffer.alloc(size, fill);
}

describe("PdfPreviewCache", () => {
    it("keeps what fits and evicts the least recently used first", () => {
        const cache = new PdfPreviewCache({ maxBytes: 100, maxEntryBytes: 100 });
        cache.set("a", pdf(40));
        cache.set("b", pdf(40));
        // Touch `a` so `b` is the oldest.
        expect(cache.get("a")).not.toBeNull();
        cache.set("c", pdf(40));

        expect(cache.get("b")).toBeNull();
        expect(cache.get("a")).not.toBeNull();
        expect(cache.get("c")).not.toBeNull();
        expect(cache.byteLength).toBe(80);
    });

    it("serves an oversized render without keeping it", () => {
        const cache = new PdfPreviewCache({ maxBytes: 100, maxEntryBytes: 10 });
        cache.set("big", pdf(11));
        expect(cache.get("big")).toBeNull();
        expect(cache.size).toBe(0);
    });

    it("replaces an entry under the same key without double counting", () => {
        const cache = new PdfPreviewCache({ maxBytes: 100, maxEntryBytes: 100 });
        cache.set("a", pdf(30));
        cache.set("a", pdf(50));
        expect(cache.byteLength).toBe(50);
        expect(cache.size).toBe(1);
    });

    it("runs one render per key for callers who arrive together", async () => {
        const cache = new PdfPreviewCache({ maxBytes: 100, maxEntryBytes: 100 });
        let release!: (value: Buffer) => void;
        const render = jest.fn(
            () =>
                new Promise<Buffer>(resolve => {
                    release = resolve;
                })
        );

        const a = cache.getOrRender("k", render);
        const b = cache.getOrRender("k", render);
        release(pdf(5, "p"));

        expect(await a).toEqual(pdf(5, "p"));
        expect(await b).toEqual(pdf(5, "p"));
        expect(render).toHaveBeenCalledTimes(1);
        // Kept: the next caller does not render.
        expect(await cache.getOrRender("k", render)).toEqual(pdf(5, "p"));
        expect(render).toHaveBeenCalledTimes(1);
    });

    it("keeps nothing from a render that reported failure, and lets the next try again", async () => {
        const cache = new PdfPreviewCache({ maxBytes: 100, maxEntryBytes: 100 });
        const render = jest
            .fn<Promise<Buffer | null>, []>()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(pdf(3));

        expect(await cache.getOrRender("k", render)).toBeNull();
        expect(cache.size).toBe(0);
        expect(await cache.getOrRender("k", render)).toEqual(pdf(3));
        expect(render).toHaveBeenCalledTimes(2);
    });

    it("forgets an in-flight render that threw, so the key is not stuck", async () => {
        const cache = new PdfPreviewCache({ maxBytes: 100, maxEntryBytes: 100 });
        const render = jest
            .fn<Promise<Buffer | null>, []>()
            .mockRejectedValueOnce(new Error("boom"))
            .mockResolvedValueOnce(pdf(3));

        await expect(cache.getOrRender("k", render)).rejects.toThrow("boom");
        expect(await cache.getOrRender("k", render)).toEqual(pdf(3));
    });
});
