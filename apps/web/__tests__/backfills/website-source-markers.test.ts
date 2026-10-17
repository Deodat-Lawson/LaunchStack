jest.mock("~/server/notes/embed-note", () => ({ embedNote: jest.fn() }));

import type { DbClient } from "@launchstack/store/client";

import { BACKFILLS } from "~/server/backfills";
import {
    countUnmarkedWebsiteSources,
    markWebsiteSources,
} from "~/server/backfills/website-source-markers";

/** Flattens a drizzle `sql` tag (nested ones included) into readable text for assertions. */
function sqlText(query: unknown): string {
    const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
    return chunks
        .map(chunk => {
            if ((chunk as { queryChunks?: unknown }).queryChunks) return sqlText(chunk);
            const value = (chunk as { value?: unknown }).value;
            if (Array.isArray(value)) return value.join("");
            if (typeof chunk === "string") return `'${chunk}'`;
            return "";
        })
        .join("")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Web pages saved before the importers wrote the website marker get it from
 * the outbox, where each import's event still carries `isWebsite` and the raw
 * creation key. Checked against a real database in the dev run; here, that
 * the statements read the right evidence and never overwrite a marker.
 */
describe("2026-10-website-source-markers backfill", () => {
    it("is registered and needs no engine", () => {
        const entry = BACKFILLS.find(b => b.id === "2026-10-website-source-markers");
        expect(entry).toBeDefined();
        expect(entry?.requiresEngine).toBe(false);
    });

    it("counts website imports whose row has no marker yet", async () => {
        const execute = jest.fn().mockResolvedValue([{ count: 3 }]);
        await expect(countUnmarkedWebsiteSources({ execute } as unknown as DbClient)).resolves.toBe(
            3
        );
        const text = sqlText(execute.mock.calls[0]?.[0]);
        expect(text).toContain("o.event_type = 'source.version.created'");
        expect(text).toContain("o.payload->'payload'->>'isWebsite' = 'true'");
        expect(text).toContain("d.company_id = o.company_id");
        expect(text).toContain("d.ocr_metadata->>'kind' IS NULL");
    });

    it("merges the marker into ocrMetadata rather than replacing it", async () => {
        const execute = jest.fn().mockResolvedValue(undefined);
        await markWebsiteSources({ execute } as unknown as DbClient);
        const text = sqlText(execute.mock.calls[0]?.[0]);
        expect(text).toContain("coalesce(d.ocr_metadata, '{}'::jsonb) || jsonb_build_object(");
        expect(text).toContain("'kind', 'website'");
    });
});
