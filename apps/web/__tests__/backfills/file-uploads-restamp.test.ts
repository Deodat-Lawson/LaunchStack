jest.mock("~/server/notes/embed-note", () => ({ embedNote: jest.fn() }));

import type { DbClient } from "@launchstack/store/client";

import { BACKFILLS } from "~/server/backfills";
import {
    countCanonicallyOwnedUnstampedFileUploads,
    stampCanonicallyOwnedFileUploads,
} from "~/server/backfills/file-uploads-company-id";

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
 * Files the connector sinks uploaded without a company stamp, after the
 * first file_uploads backfill had already completed. Checked against a real
 * database in the dev run; here, that the statements take ownership only from
 * canonical document URLs in one tenant and never touch a stamped row.
 */
describe("2026-10-file-uploads-restamp backfill", () => {
    it("is registered, needs no engine, and waits for the company_id column", () => {
        const entry = BACKFILLS.find(b => b.id === "2026-10-file-uploads-restamp");
        expect(entry).toBeDefined();
        expect(entry?.requiresEngine).toBe(false);
        expect(entry?.requiresMigration).toBe("20260809142627_file_uploads_company_id");
    });

    it("counts unstamped files a canonical URL in exactly one tenant points at", async () => {
        const execute = jest.fn().mockResolvedValue([{ count: 4 }]);
        await expect(
            countCanonicallyOwnedUnstampedFileUploads({ execute } as unknown as DbClient)
        ).resolves.toBe(4);

        const text = sqlText(execute.mock.calls[0]?.[0]);
        expect(text).toContain("FROM pdr_ai_v2_document_versions v");
        expect(text).toContain("HAVING COUNT(DISTINCT r.company_id) = 1");
        expect(text).toContain("WHERE f.company_id IS NULL");
        // The anchored matcher, not the weak one: `/api/files/5/extra` names no file.
        expect(text).toContain(String.raw`'^(https?://[^/?#]+)?/api/files/([0-9]+)/?(\?.*)?$'`);
    });

    it("only fills NULL stamps and never clears one", async () => {
        const execute = jest.fn().mockResolvedValue(undefined);
        await stampCanonicallyOwnedFileUploads({ execute } as unknown as DbClient);

        expect(execute).toHaveBeenCalledTimes(1);
        const text = sqlText(execute.mock.calls[0]?.[0]);
        expect(text).toContain("SET company_id = p.company_id");
        expect(text).toContain("AND f.company_id IS NULL");
        expect(text).not.toMatch(/SET company_id = NULL/i);
    });
});
