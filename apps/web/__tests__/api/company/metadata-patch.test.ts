/**
 * Manual overrides on the company record shipped broken: the client sent
 * `{ field, value }` while the route's schema required `{ path, value }`, so
 * every inline edit failed validation before it reached the path parser. The
 * parser in turn could not address `legal[]` or `policies` at all — the facts a
 * human is most likely to need to correct. And the read-modify-write of the
 * whole JSONB blob raced the worker's projection, which reads the same row,
 * spends seconds in an LLM call, then writes the blob back.
 *
 * These tests pin all three: the wire contract, the reachable paths, and the
 * row lock.
 */

import { PATCH } from "~/app/api/company/metadata/route";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import type { CompanyMetadataJSON } from "@launchstack/pipelines/company-metadata";

jest.mock("~/lib/require-workspace-context", () => {
    const actual = jest.requireActual("~/lib/require-workspace-context");
    return {
        ...actual,
        requireWorkspaceContext: jest.fn(),
    };
});

/** Rows written by the transaction, in order, for assertions. */
let mockStoredMetadata: CompanyMetadataJSON;
let mockWrittenMetadata: CompanyMetadataJSON | undefined;
let mockHistoryRows: Record<string, unknown>[] = [];
let mockLockedForUpdate = false;

jest.mock("~/server/db/index", () => ({
    db: {
        transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
            const tx = {
                select: () => {
                    const builder: Record<string, unknown> = {
                        from: () => builder,
                        where: () => builder,
                        for: (mode: string) => {
                            mockLockedForUpdate = mode === "update";
                            return builder;
                        },
                        then: (resolve: (value: unknown) => unknown) =>
                            resolve(mockStoredMetadata ? [{ metadata: mockStoredMetadata }] : []),
                    };
                    return builder;
                },
                update: () => ({
                    set: (values: { metadata: CompanyMetadataJSON }) => ({
                        where: () => {
                            mockWrittenMetadata = values.metadata;
                            return Promise.resolve(undefined);
                        },
                    }),
                }),
                insert: () => ({
                    values: (row: Record<string, unknown>) => {
                        mockHistoryRows.push(row);
                        return Promise.resolve(undefined);
                    },
                }),
            };
            return fn(tx);
        },
    },
}));

jest.mock("~/server/db/schema", () => ({
    companyMetadata: {
        companyId: { name: "company_id" },
        metadata: { name: "metadata" },
    },
    companyMetadataHistory: {
        companyId: { name: "history.company_id" },
    },
}));

jest.mock("drizzle-orm", () => ({
    eq: (...args: unknown[]) => ({ op: "eq", args }),
}));

const OWNER_CTX: WorkspaceContext = {
    authUserId: "clerk_owner",
    userPk: BigInt(7),
    companyId: BigInt(5),
    role: "owner",
    status: "verified",
};

function extractedFact(value: string) {
    return {
        value,
        visibility: "public" as const,
        usage: "outreach_ok" as const,
        confidence: 0.6,
        priority: "normal" as const,
        status: "active" as const,
        last_updated: "2026-01-01T00:00:00.000Z",
        sources: [
            {
                doc_id: 11,
                doc_name: "Acme MSA.pdf",
                extracted_at: "2026-01-01T00:00:00.000Z",
            },
        ],
    };
}

function baseMetadata(): CompanyMetadataJSON {
    return {
        schema_version: "1.0.0",
        company_id: "5",
        updated_at: "2026-01-01T00:00:00.000Z",
        company: { name: extractedFact("Acme") },
        people: [],
        services: [],
        markets: {},
        projects: [],
        policies: { refund: extractedFact("30 days") },
        legal: [
            {
                name: extractedFact("Acme MSA"),
                expiry_date: extractedFact("2026-09-02"),
            },
        ],
        provenance: {
            total_documents_processed: 1,
            extraction_model: "test",
            extraction_version: "1.0.0",
        },
    };
}

function patch(body: unknown) {
    return PATCH(
        new Request("http://localhost/api/company/metadata", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        })
    );
}

beforeEach(() => {
    mockStoredMetadata = baseMetadata();
    mockWrittenMetadata = undefined;
    mockHistoryRows = [];
    mockLockedForUpdate = false;
    (requireWorkspaceContext as jest.Mock).mockResolvedValue({
        success: true,
        data: OWNER_CTX,
    });
});

describe("PATCH /api/company/metadata", () => {
    it("accepts the path the client actually sends", async () => {
        const response = await patch({ path: "company.name", value: "Acme Corp" });

        expect(response.status).toBe(200);
        expect(mockWrittenMetadata?.company.name?.value).toBe("Acme Corp");
    });

    it("rejects the pre-fix wire shape rather than silently no-oping", async () => {
        const response = await patch({ field: "company.name", value: "Acme Corp" });

        expect(response.status).toBe(400);
        expect(mockWrittenMetadata).toBeUndefined();
    });

    it("marks a hand-edited fact as a manual override so extraction cannot clobber it", async () => {
        await patch({ path: "company.name", value: "Acme Corp" });

        expect(mockWrittenMetadata?.company.name?.priority).toBe("manual_override");
        expect(mockWrittenMetadata?.company.name?.confidence).toBe(1);
        expect(mockHistoryRows).toHaveLength(1);
        expect(mockHistoryRows[0]?.changeType).toBe("manual_override");
    });

    it("reaches legal entries, which the old parser could not address", async () => {
        const response = await patch({
            path: "legal.0.expiry_date",
            value: "2027-09-02",
        });

        expect(response.status).toBe(200);
        expect(mockWrittenMetadata?.legal[0]?.expiry_date?.value).toBe("2027-09-02");
        expect(mockWrittenMetadata?.legal[0]?.expiry_date?.priority).toBe("manual_override");
    });

    it("reaches policies, which the old parser could not address", async () => {
        const response = await patch({ path: "policies.refund", value: "60 days" });

        expect(response.status).toBe(200);
        expect(mockWrittenMetadata?.policies.refund?.value).toBe("60 days");
    });

    it("locks the row so a concurrent projection cannot overwrite the edit", async () => {
        await patch({ path: "company.name", value: "Acme Corp" });

        expect(mockLockedForUpdate).toBe(true);
    });

    it("preserves visibility and usage from the fact being replaced", async () => {
        mockStoredMetadata.company.name = {
            ...extractedFact("Acme"),
            visibility: "internal",
            usage: "no_outreach",
        };

        await patch({ path: "company.name", value: "Acme Corp" });

        expect(mockWrittenMetadata?.company.name?.visibility).toBe("internal");
        expect(mockWrittenMetadata?.company.name?.usage).toBe("no_outreach");
    });

    it("refuses an out-of-range index instead of appending", async () => {
        const response = await patch({ path: "legal.7.expiry_date", value: "x" });

        expect(response.status).toBe(400);
        expect(mockWrittenMetadata).toBeUndefined();
    });

    it("refuses an unknown path", async () => {
        const response = await patch({ path: "provenance.extraction_model", value: "x" });

        expect(response.status).toBe(400);
        expect(mockWrittenMetadata).toBeUndefined();
    });

    it("denies a non-management member", async () => {
        (requireWorkspaceContext as jest.Mock).mockResolvedValue({
            success: true,
            data: { ...OWNER_CTX, role: "editor" },
        });

        const response = await patch({ path: "company.name", value: "Acme Corp" });

        expect(response.status).toBe(403);
        expect(mockWrittenMetadata).toBeUndefined();
    });
});
