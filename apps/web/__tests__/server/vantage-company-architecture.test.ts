import { PgDialect } from "drizzle-orm/pg-core";
import { document } from "@launchstack/store/schema";
import {
    companyMetadata,
    companyProfileSources,
    type CompanyMetadataJSON,
    type MetadataFact,
} from "@launchstack/tools/company-context/schema";
import { READER_VERSION } from "@launchstack/pipelines/company-metadata";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import type { DocumentScope } from "~/lib/authz/scope-types";
import { scopeAllows } from "~/lib/authz/scope";
import {
    createCompanyArchitectureAdapterV0,
    COMPANY_ARCHITECTURE_MAX_PROFILE_BYTES,
} from "~/server/vantage/company-architecture";

jest.mock("~/server/db", () => ({ db: {} }));
jest.mock("~/lib/require-workspace-context", () => ({ requireWorkspaceContext: jest.fn() }));

const at = new Date("2026-10-16T12:00:00Z");
const built = new Date("2026-10-17T12:00:00Z");
const request = {
    reportWindow: {
        startInclusive: "2026-10-12T04:00:00Z",
        endExclusive: "2026-10-19T04:00:00Z",
        asOf: "2026-10-19T12:00:00Z",
    },
    budgets: {
        maxSources: 8,
        maxExcerptChars: 12000,
        maxQueries: 3,
        maxTokens: 8000,
        timeoutMs: 3000,
    },
};
type Deps = NonNullable<Parameters<typeof createCompanyArchitectureAdapterV0>[0]>;
const evidence = (id: number) => ({
    doc_id: id,
    doc_name: "Synthetic source " + id,
    version_id: id + 10,
    extracted_at: at.toISOString(),
    quote: "Synthetic company evidence.",
});
function fact(value: string, ids = [1]): MetadataFact {
    return {
        value,
        visibility: "private",
        usage: "no_outreach",
        confidence: 0.9,
        priority: "normal",
        status: "active",
        last_updated: at.toISOString(),
        sources: ids.map(evidence),
    };
}
function metadata(): CompanyMetadataJSON {
    return {
        schema_version: "1.1.0",
        company_id: "1",
        updated_at: built.toISOString(),
        company: {
            name: fact("Synthetic Acme"),
            description: fact("Makes synthetic planning tools."),
        },
        people: [],
        services: [],
        markets: {},
        projects: [],
        policies: {},
        legal: [],
        profile: {},
        provenance: {
            total_documents_processed: 1,
            extraction_model: "synthetic",
            extraction_version: "1.1.0",
        },
    };
}
const profile = () => ({
    id: "1",
    companyId: "1",
    metadata: metadata() as CompanyMetadataJSON | null,
    metadataBytes: 1200,
    schemaVersion: "1.1.0",
    createdAt: at,
    updatedAt: built,
    builtAt: built,
    buildStatus: "idle" as const,
});
const sourceRow = (id = 1) => ({
    id,
    companyId: 1n,
    documentId: BigInt(id),
    versionId: BigInt(id + 10),
    role: "about_us" as const,
    roleBy: "rules" as const,
    reason: "Synthetic company source",
    override: null,
    overrideBy: null,
    status: "done" as const,
    error: null,
    facts: { company: metadata().company },
    factCount: 2,
    passages: { total: 1, kept: 1, dropped: {} },
    readerVersion: READER_VERSION,
    modelId: "synthetic",
    readAt: at,
    createdAt: at,
    updatedAt: null,
});
const docRow = (id = 1) => ({
    id: String(id),
    companyId: "1",
    category: "General",
    currentVersionId: String(id + 10),
    updatedAt: null,
    versionId: String(id + 10),
    versionDocumentId: String(id),
    versionCreatedAt: new Date("2026-10-15T12:00:00Z"),
    versionNumber: 1,
    versionUrl: "https://synthetic.invalid/version/" + id,
    mimeType: "text/plain",
    fileSize: 100n,
    creationKey: "version-" + id,
    indexed: true,
    documentPayloadFingerprint: "a".repeat(64),
    versionPayloadFingerprint: "b".repeat(64),
});
function context(): WorkspaceContext {
    return {
        authUserId: "synthetic-member",
        userPk: 7n,
        companyId: 1n,
        role: "member",
        status: "active",
        permissions: new Set(["documents.read"]),
        can: jest.fn(() => false),
        documentScope: jest.fn(async () => ({ kind: "everything" as const })),
    };
}
function setup() {
    const state = {
        profile: profile(),
        sources: [sourceRow()],
        docs: [docRow()],
        scope: { kind: "everything" } as DocumentScope,
        ctx: context(),
        activeTransaction: false,
        rowsLimit: 0,
        lockError: null as (Error & { code: string }) | null,
    };
    const events: string[] = [];
    const execute = jest.fn(
        async (query: Parameters<InstanceType<typeof PgDialect>["sqlToQuery"]>[0]) => {
            const text = new PgDialect().sqlToQuery(query).sql;
            events.push(text);
            if (state.lockError && text.startsWith("LOCK TABLE")) throw state.lockError;
            return [];
        }
    );
    const select = jest.fn(() => {
        let table: unknown;
        const builder = {
            from(value: unknown) {
                table = value;
                return builder;
            },
            innerJoin() {
                return builder;
            },
            where() {
                return builder;
            },
            orderBy() {
                return builder;
            },
            async limit(limit: number) {
                state.rowsLimit = limit;
                if (table === companyMetadata) return [structuredClone(state.profile)];
                if (table === companyProfileSources)
                    return state.sources.map(row => ({
                        ...row,
                        facts: structuredClone(row.facts),
                    }));
                if (table === document)
                    return structuredClone(
                        state.docs.filter(doc =>
                            scopeAllows(state.scope, { id: Number(doc.id), category: doc.category })
                        )
                    );
                throw new Error("Unexpected synthetic query");
            },
        };
        return builder;
    });
    const tx = { select, execute };
    const transaction = jest.fn(async (callback: (value: typeof tx) => Promise<unknown>) => {
        events.push("BEGIN");
        state.activeTransaction = true;
        try {
            const result = await callback(tx);
            events.push("COMMIT");
            return result;
        } catch (error) {
            events.push("ROLLBACK");
            throw error;
        } finally {
            state.activeTransaction = false;
        }
    });
    const resolveWorkspace = jest.fn(async () => {
        events.push("AUTH");
        return { success: true as const, data: state.ctx };
    });
    const resolveScope = jest.fn(async () => {
        events.push("ACL");
        return structuredClone(state.scope);
    });
    let clock = new Date("2026-10-19T12:00:00Z");
    const deps: Deps = {
        database: { select, execute, transaction } as unknown as Deps["database"],
        resolveWorkspace,
        resolveScope,
        now: () => clock,
    };
    const adapter = createCompanyArchitectureAdapterV0(deps);
    return {
        state,
        events,
        select,
        execute,
        transaction,
        resolveWorkspace,
        resolveScope,
        adapter,
        tx,
        deps,
        advanceClock: () => {
            clock = new Date(clock.getTime() + 60000);
        },
    };
}

describe("company architecture server host security", () => {
    it("captures the native profile as unreviewed company context without profile-edit privileges", async () => {
        const s = setup();
        const captured = await s.adapter.capture(request);
        expect(captured.projection.status).toBe("available");
        expect(captured.projection.requiredEntry!.source.reviewState).toBe("unreviewed");
        expect(captured.projection.requiredEntry!.audience).toEqual({
            kind: "company",
            companyId: "1",
        });
        expect(captured.actor).toMatchObject({ principalRef: "synthetic-member", companyId: "1" });
        expect(s.state.ctx.can).not.toHaveBeenCalled();
        expect(s.state.ctx.documentScope).not.toHaveBeenCalled();
    });

    it("locks before initial fresh authentication and ACL resolution, not merely before persistence", async () => {
        const s = setup();
        s.resolveScope.mockImplementation(async () => {
            expect(s.state.activeTransaction).toBe(true);
            expect(s.events.some(event => event.startsWith("LOCK TABLE"))).toBe(true);
            return s.state.scope;
        });
        await s.adapter.capture(request);
        expect(s.events.findIndex(event => event.startsWith("LOCK TABLE"))).toBeLessThan(
            s.events.indexOf("AUTH")
        );
        expect(s.events.at(-1)).toBe("COMMIT");
    });

    it("payload identity and ACL claims cannot select an actor or company", async () => {
        const s = setup();
        const supplied = {
            ...request,
            principalRef: "attacker",
            companyId: "2",
            aclDigest: "forged",
        };
        const captured = await s.adapter.capture(supplied);
        expect(captured.actor).toMatchObject({ principalRef: "synthetic-member", companyId: "1" });
        expect(captured.projection.requiredEntry!.companyId).toBe("1");
    });

    it("pins primitive identity and permissions before awaiting the scope resolver", async () => {
        const s = setup();
        s.resolveScope.mockImplementation(async () => {
            s.state.ctx.authUserId = "changed-during-await";
            s.state.ctx.userPk = 99n;
            s.state.ctx.companyId = 2n;
            (s.state.ctx.permissions as Set<"documents.read" | "folders.manage">).add(
                "folders.manage"
            );
            return { kind: "everything" };
        });
        const captured = await s.adapter.capture(request);
        expect(captured.actor).toMatchObject({ principalRef: "synthetic-member", companyId: "1" });
        await expect(s.adapter.assertFresh(captured)).rejects.toMatchObject({ status: 409 });
    });

    it("same-company users with identical effective scope receive differently bound source versions", async () => {
        const s = setup();
        const first = await s.adapter.capture(request);
        s.state.ctx = { ...context(), authUserId: "other-member", userPk: 8n };
        const second = await s.adapter.capture(request);
        expect(second.actor.aclDigest).not.toBe(first.actor.aclDigest);
        expect(second.projection.requiredEntry!.source.version).not.toBe(
            first.projection.requiredEntry!.source.version
        );
        await expect(s.adapter.assertFresh(first)).rejects.toMatchObject({ status: 409 });
    });

    it("requires current documents.read even when a forged can() returns true", async () => {
        const s = setup();
        s.state.ctx.permissions = new Set();
        s.state.ctx.can = () => true;
        await expect(s.adapter.capture(request)).rejects.toMatchObject({ status: 403 });
        expect(s.select).not.toHaveBeenCalled();
    });

    it("rejects fabricated captures, modified clones and captures from another factory", async () => {
        const s = setup();
        const captured = await s.adapter.capture(request);
        expect(Object.isFrozen(captured)).toBe(true);
        expect(Object.isFrozen(captured.actor)).toBe(true);
        expect(Object.isFrozen(captured.projection)).toBe(true);
        await expect(s.adapter.assertFresh(structuredClone(captured))).rejects.toMatchObject({
            status: 409,
        });
        const foreign = createCompanyArchitectureAdapterV0(s.deps);
        await expect(foreign.assertFresh(captured)).rejects.toMatchObject({ status: 409 });
        const persist = jest.fn();
        await expect(foreign.guardedCommit(captured, persist)).rejects.toMatchObject({
            status: 409,
        });
        expect(persist).not.toHaveBeenCalled();
    });

    it("rejects unowned transaction objects instead of silently reading outside them", async () => {
        const s = setup();
        const captured = await s.adapter.capture(request);
        await expect(s.adapter.assertFresh(captured, { transaction: s.tx })).rejects.toMatchObject({
            status: 503,
        });
        await expect(s.adapter.assertFresh(captured, { transaction: null })).rejects.toMatchObject({
            status: 503,
        });
    });

    it("fresh authorization ignores a request's previously memoized documentScope", async () => {
        const s = setup();
        const captured = await s.adapter.capture(request);
        s.state.scope = {
            kind: "only",
            allowedCategories: [],
            allowedDocumentIds: [],
            deniedDocumentIds: [],
        };
        await expect(s.adapter.assertFresh(captured)).rejects.toMatchObject({ status: 409 });
        expect(s.resolveScope).toHaveBeenCalledTimes(2);
        expect(s.state.ctx.documentScope).not.toHaveBeenCalled();
    });

    it.each(["normal", "manual_override"] as const)(
        "a %s fused value cannot leak through a hidden thirteenth dependency",
        async priority => {
            const s = setup();
            const ids = Array.from({ length: 13 }, (_, i) => i + 1);
            s.state.profile.metadata!.company.description = {
                ...fact("FUSED_PRIVATE_SENTINEL", ids),
                priority,
            };
            s.state.profile.metadata!.company.description.sources[12]!.doc_name =
                "HIDDEN_THIRTEENTH_TITLE";
            delete s.state.profile.metadata!.company.description.sources[12]!.quote;
            s.state.sources = ids.map(sourceRow);
            s.state.docs = ids.slice(0, 12).map(docRow);
            const captured = await s.adapter.capture(request);
            expect(captured.projection.status).not.toBe("available");
            expect(captured.projection.requiredEntry).toBeUndefined();
            expect(JSON.stringify(captured)).not.toContain("FUSED_PRIVATE_SENTINEL");
            expect(JSON.stringify(captured)).not.toContain("HIDDEN_THIRTEENTH_TITLE");
        }
    );

    it("manual doc_id zero remains a labeled human assertion with no invented document version", async () => {
        const s = setup();
        for (const key of ["name", "description"] as const) {
            const value = s.state.profile.metadata!.company[key]!;
            value.priority = "manual_override";
            value.sources = [
                { doc_id: 0, doc_name: "Manual edit", extracted_at: at.toISOString() },
            ];
        }
        s.state.sources = [];
        s.state.docs = [];
        const captured = await s.adapter.capture(request);
        expect(captured.projection.status).toBe("available");
        expect(JSON.stringify(captured.projection.record)).toContain("human-entered-unreviewed");
        expect(s.select).toHaveBeenCalledTimes(1);
    });

    it("does not invent a current version when the native version belongs to another document", async () => {
        const s = setup();
        s.state.docs[0]!.versionDocumentId = "2";
        await expect(s.adapter.capture(request)).rejects.toMatchObject({ status: 503 });
    });

    it("rejects unsafe or excessive raw provenance before querying backing documents", async () => {
        const s = setup();
        s.state.profile.metadata!.company.description!.sources[0]!.doc_id =
            Number.MAX_SAFE_INTEGER + 1;
        await expect(s.adapter.capture(request)).rejects.toMatchObject({ status: 503 });
        expect(s.select).toHaveBeenCalledTimes(1);
        s.select.mockClear();
        s.state.profile = profile();
        s.state.profile.metadata!.company.description!.sources = Array.from(
            { length: 129 },
            (_, i) => evidence(i + 1)
        );
        await expect(s.adapter.capture(request)).rejects.toMatchObject({ status: 503 });
        expect(s.select).toHaveBeenCalledTimes(1);
    });

    it("fails closed on an oversized canonical profile", async () => {
        const s = setup();
        s.state.profile.metadata = null;
        s.state.profile.metadataBytes = COMPANY_ARCHITECTURE_MAX_PROFILE_BYTES + 1;
        await expect(s.adapter.capture(request)).rejects.toMatchObject({ status: 503 });
        expect(s.select).toHaveBeenCalledTimes(1);
    });

    it.each(["maxSources", "maxExcerptChars", "timeoutMs", "maxQueries", "maxTokens"] as const)(
        "rejects an absent explicit %s budget before opening a transaction",
        async key => {
            const s = setup();
            const missing = structuredClone(request);
            delete (missing.budgets as Partial<typeof missing.budgets>)[key];
            await expect(s.adapter.capture(missing)).rejects.toMatchObject({ status: 400 });
            expect(s.transaction).not.toHaveBeenCalled();
        }
    );

    it("uses volatile check time without making an unchanged captured source stale", async () => {
        const s = setup();
        const captured = await s.adapter.capture(request);
        s.advanceClock();
        const fresh = await s.adapter.assertFresh(captured);
        expect(fresh.snapshotFingerprint).toBe(captured.snapshotFingerprint);
    });

    it("uses the same owned native transaction for final reread and persistence", async () => {
        const s = setup();
        const captured = await s.adapter.capture(request);
        const persist = jest.fn(async transaction => {
            expect(transaction).toBe(s.tx);
            expect(s.state.activeTransaction).toBe(true);
            return "synthetic-saved";
        });
        await expect(s.adapter.guardedCommit(captured, persist)).resolves.toBe("synthetic-saved");
        expect(persist).toHaveBeenCalledTimes(1);
        expect(s.events.at(-1)).toBe("COMMIT");
    });

    it("typed lock failures do not expose native error text", async () => {
        const s = setup();
        s.state.lockError = Object.assign(new Error("PRIVATE_NATIVE_ERROR_SENTINEL"), {
            code: "55P03",
        });
        await expect(s.adapter.capture(request)).rejects.toMatchObject({
            status: 503,
            code: "guard_lock_unavailable",
        });
        expect(s.events.at(-1)).toBe("ROLLBACK");
        expect(s.select).not.toHaveBeenCalled();
    });

    it("timeout rolls back the lock window and a late scope result cannot start native reads", async () => {
        const s = setup();
        let finish: ((scope: DocumentScope) => void) | undefined;
        s.resolveScope.mockImplementation(
            () =>
                new Promise(resolve => {
                    finish = resolve;
                })
        );
        await expect(
            s.adapter.capture({ ...request, budgets: { ...request.budgets, timeoutMs: 20 } })
        ).rejects.toMatchObject({ status: 503 });
        expect(s.events.at(-1)).toBe("ROLLBACK");
        expect(s.select).not.toHaveBeenCalled();
        finish!({ kind: "everything" });
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(s.select).not.toHaveBeenCalled();
    });
});
