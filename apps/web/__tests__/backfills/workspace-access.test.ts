jest.mock("~/server/notes/embed-note", () => ({ embedNote: jest.fn() }));

import type { DbClient } from "@launchstack/store/client";

import { BACKFILLS } from "~/server/backfills";
import {
    applyWorkspaceAccessBackfill,
    countWorkspaceAccessRows,
} from "~/server/backfills/workspace-access";

/** Flattens a drizzle `sql` tag into readable text for assertions. */
function sqlText(query: unknown): string {
    const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
    return chunks
        .map(chunk => {
            const value = (chunk as { value?: unknown }).value;
            return Array.isArray(value) ? value.join("") : "";
        })
        .join("")
        .replace(/\s+/g, " ")
        .trim();
}

describe("2026-09-workspace-access backfill", () => {
    it("is registered against the workspace_access migration and needs no engine", () => {
        const entry = BACKFILLS.find(b => b.id === "2026-09-workspace-access");
        expect(entry).toBeDefined();
        expect(entry?.requiresMigration).toBe("20260904031425_workspace_access");
        expect(entry?.requiresEngine).toBe(false);
        expect(entry?.estimate).toBeDefined();
    });

    it("estimates the rows still needing each of the three rewrites", async () => {
        const execute = jest
            .fn()
            .mockResolvedValueOnce([{ count: 1 }])
            .mockResolvedValueOnce([{ count: 2 }])
            .mockResolvedValueOnce([{ count: 3 }]);
        const db = { execute } as unknown as DbClient;

        await expect(countWorkspaceAccessRows(db)).resolves.toBe(6);
        const [pending, editors, links] = execute.mock.calls.map(call => sqlText(call[0]));
        expect(pending).toContain("u.status = 'pending' AND m.status = 'active'");
        expect(editors).toContain("WHERE role = 'editor'");
        expect(links).toContain("WHERE role IN ('employer', 'employee', 'owner')");
    });

    it("applies the three idempotent updates inside one transaction", async () => {
        const execute = jest.fn().mockResolvedValue(undefined);
        const transaction = jest.fn(async (fn: (tx: unknown) => Promise<void>) => fn({ execute }));
        const db = { transaction } as unknown as DbClient;

        await applyWorkspaceAccessBackfill(db);

        expect(transaction).toHaveBeenCalledTimes(1);
        const statements = execute.mock.calls.map(call => sqlText(call[0]));
        expect(statements).toHaveLength(3);
        expect(statements[0]).toContain("SET status = 'pending'");
        expect(statements[0]).toContain("AND m.status = 'active'");
        expect(statements[1]).toContain("SET role = 'member' WHERE role = 'editor'");
        expect(statements[2]).toContain("WHEN 'employer' THEN 'admin'");
        expect(statements[2]).toContain("WHEN 'employee' THEN 'member'");
        expect(statements[2]).toContain("WHEN 'owner' THEN 'admin'");
    });
});
