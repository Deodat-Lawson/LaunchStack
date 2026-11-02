/**
 * Rendered previews, kept in this process so a deck is rendered once per
 * version rather than once per view.
 *
 * Keys carry the document's version, so a new version is a new key and a
 * stale preview is never served; the old entry simply ages out. The cache is
 * bounded by bytes, evicting least-recently-used first, and a render already
 * in flight is shared with whoever asks for the same key meanwhile — a viewer
 * that mounts twice, or two readers opening the same deck, costs one
 * LibreOffice run.
 *
 * It is a per-process memory, not a store: a restart or a second replica
 * starts empty and re-renders on demand. The browser side carries the rest —
 * the route tags each response with a version ETag and asks the browser to
 * revalidate, so a reader coming back gets a 304 and keeps their copy.
 */

export interface PdfPreviewCacheOptions {
    /** Upper bound on the bytes held across every entry. */
    maxBytes: number;
    /** Anything larger is served but not kept. */
    maxEntryBytes: number;
}

const DEFAULT_OPTIONS: PdfPreviewCacheOptions = {
    maxBytes: 64 * 1024 * 1024,
    maxEntryBytes: 24 * 1024 * 1024,
};

export class PdfPreviewCache {
    private readonly entries = new Map<string, Buffer>();
    private readonly pending = new Map<string, Promise<Buffer | null>>();
    private bytes = 0;

    constructor(private readonly options: PdfPreviewCacheOptions = DEFAULT_OPTIONS) {}

    get(key: string): Buffer | null {
        const hit = this.entries.get(key);
        if (!hit) return null;
        // Re-insert to mark it most recently used.
        this.entries.delete(key);
        this.entries.set(key, hit);
        return hit;
    }

    set(key: string, pdf: Buffer): void {
        if (pdf.byteLength > this.options.maxEntryBytes) return;
        const previous = this.entries.get(key);
        if (previous) {
            this.entries.delete(key);
            this.bytes -= previous.byteLength;
        }
        this.entries.set(key, pdf);
        this.bytes += pdf.byteLength;
        for (const [oldest, buffer] of this.entries) {
            if (this.bytes <= this.options.maxBytes) break;
            this.entries.delete(oldest);
            this.bytes -= buffer.byteLength;
        }
    }

    /**
     * The cached bytes, or the result of `render` — run once per key however
     * many callers arrive while it is in flight. `render` returns null when
     * it failed in a way the caller reports itself; nothing is kept then.
     */
    async getOrRender(key: string, render: () => Promise<Buffer | null>): Promise<Buffer | null> {
        const hit = this.get(key);
        if (hit) return hit;
        const inFlight = this.pending.get(key);
        if (inFlight) return inFlight;
        const run = (async () => {
            try {
                const pdf = await render();
                if (pdf) this.set(key, pdf);
                return pdf;
            } finally {
                this.pending.delete(key);
            }
        })();
        this.pending.set(key, run);
        return run;
    }

    /** How many entries are held — for tests and diagnostics. */
    get size(): number {
        return this.entries.size;
    }

    /** Bytes held across every entry — for tests and diagnostics. */
    get byteLength(): number {
        return this.bytes;
    }

    clear(): void {
        this.entries.clear();
        this.pending.clear();
        this.bytes = 0;
    }
}

/** The one cache the preview route uses. */
export const pdfPreviewCache = new PdfPreviewCache();
