/**
 * Settings shows a person their own access keys and lets them revoke only
 * those. The routes pass the caller's ids; this pins that the service turns
 * them into SQL that cannot reach a colleague's key, a key from another
 * workspace, or an already-revoked one. Real Drizzle builder, recording proxy.
 */

import type * as PgProxy from "drizzle-orm/pg-proxy";

interface Query {
    sql: string;
    params: unknown[];
}
const mockQueries: Query[] = [];
const mockAnswers: unknown[][][] = [];

jest.mock("~/server/db", () => {
    const { drizzle } = jest.requireActual<typeof PgProxy>("drizzle-orm/pg-proxy");
    return {
        db: drizzle(async (sql: string, params: unknown[]) => {
            mockQueries.push({ sql, params });
            return { rows: mockAnswers.shift() ?? [] };
        }),
    };
});

import { createAccessKey, listAccessKeys, revokeAccessKey } from "~/server/mcp/access-keys";

const KEYS = /"pdr_ai_v2_mcp_access_keys"/;

beforeEach(() => {
    mockQueries.length = 0;
    mockAnswers.length = 0;
});

it("lists only the caller's live keys in this workspace, without the hash", async () => {
    const now = "2026-10-16T10:00:00.000Z";
    mockAnswers.push([
        [
            3,
            50,
            41,
            "Nightly export",
            "lsk_AbC123",
            "stored-hash",
            ["launchstack:read"],
            now,
            null,
            null,
        ],
    ]);
    const keys = await listAccessKeys({ companyId: 50n, userPk: 41n });
    const [query] = mockQueries;
    expect(query!.sql).toMatch(KEYS);
    expect(query!.sql).toMatch(
        /"company_id" = \$1 and "pdr_ai_v2_mcp_access_keys"\."user_id" = \$2 and "pdr_ai_v2_mcp_access_keys"\."revoked_at" is null/
    );
    expect(query!.params).toEqual([50n, 41n]);
    expect(keys).toEqual([
        {
            id: 3,
            name: "Nightly export",
            displayPrefix: "lsk_AbC123",
            access: "read",
            createdAt: now,
            lastUsedAt: null,
        },
    ]);
    expect(JSON.stringify(keys)).not.toContain("stored-hash");
});

it("revokes by id only together with the caller's user and workspace, and only a live key", async () => {
    mockAnswers.push([]);
    await expect(revokeAccessKey({ companyId: 50n, userPk: 41n, keyId: 3 })).resolves.toBe(false);
    const [query] = mockQueries;
    expect(query!.sql).toMatch(/^update "pdr_ai_v2_mcp_access_keys" set "revoked_at" = \$1/);
    expect(query!.sql).toMatch(
        /where \("pdr_ai_v2_mcp_access_keys"\."id" = \$2 and "pdr_ai_v2_mcp_access_keys"\."company_id" = \$3 and "pdr_ai_v2_mcp_access_keys"\."user_id" = \$4 and "pdr_ai_v2_mcp_access_keys"\."revoked_at" is null\)/
    );
    expect(query!.params.slice(1)).toEqual([3, 50n, 41n]);
});

it("returns the secret once and stores only its hash", async () => {
    mockAnswers.push([]); // the live-key count (none yet)
    const now = "2026-10-16T10:00:00.000Z";
    mockAnswers.push([
        [3, 50, 41, "Nightly export", "lsk_AbC123", "hash", ["launchstack:read"], now, null, null],
    ]);
    const { key, secret } = await createAccessKey({
        companyId: 50n,
        userPk: 41n,
        name: "Nightly export",
        access: "read",
    });
    expect(secret).toMatch(/^lsk_/);
    const insert = mockQueries[1]!;
    expect(insert.sql).toMatch(/^insert into "pdr_ai_v2_mcp_access_keys"/);
    expect(insert.params).not.toContain(secret);
    expect(JSON.stringify(key)).not.toContain(secret);
    expect(key).toMatchObject({ id: 3, name: "Nightly export", access: "read" });
});
