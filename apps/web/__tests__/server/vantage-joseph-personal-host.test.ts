import {
    createJosephPersonalHostV0,
    type JosephPersonalHostOptionsV0,
} from "~/server/vantage/experiments/joseph-personal-host";
import type {
    CompanyArchitectureRefV0,
    ContextScopeV0,
    TrustedContextSourceV0,
} from "@launchstack/pipelines/vantage/context-v0";

let sequence = 500;
function fixture(reviewState: CompanyArchitectureRefV0["reviewState"] = "unreviewed") {
    const companyId = String(++sequence),
        principalRef = `synthetic-joseph-${sequence}`;
    const actor: ContextScopeV0 = {
        companyId,
        principalRef,
        audience: { kind: "actor", principalRef },
        aclDigest: `synthetic-acl-${sequence}`,
    };
    const companyRef: CompanyArchitectureRefV0 = {
        kind: "company",
        id: `company-metadata/${companyId}`,
        version: "profile-1",
        companyId,
        canonical: true,
        reviewState,
    };
    const entry = (
        source: TrustedContextSourceV0["source"],
        excerpt: string,
        companyAudience = false
    ): TrustedContextSourceV0 => ({
        source,
        companyId,
        access: "allowed",
        aclDigest: actor.aclDigest,
        audience: companyAudience ? { kind: "company", companyId } : actor.audience,
        excerpt,
        contentHash: `synthetic-content-${source.id}-${source.version}`,
        sourceDate: "2026-10-16T16:00:00.000Z",
        checkedAt: "2026-10-26T19:00:00.000Z",
    });
    let records: TrustedContextSourceV0[] = [
        entry(companyRef, JSON.stringify({ reviewState, fixtureOnly: true }), true),
        entry(
            { kind: "doc", id: "workspace-document/21", version: "7" },
            "Synthetic private deletion evidence"
        ),
    ];
    const options: JosephPersonalHostOptionsV0 = {
        actor,
        records,
        reportWindow: {
            startInclusive: "2026-10-12T04:00:00.000Z",
            endExclusive: "2026-10-19T04:00:00.000Z",
            asOf: "2026-10-26T23:59:00.000Z",
        },
        budgets: {
            maxSources: 20,
            maxExcerptChars: 12000,
            maxTokens: 16000,
            timeoutMs: 5000,
            maxQueries: 3,
        },
        resolveFresh: async () => ({ actor, records }),
        now: () => "2026-10-26T19:00:00.000Z",
    };
    return {
        actor,
        options,
        entry,
        get records() {
            return records;
        },
        setRecords(next: TrustedContextSourceV0[]) {
            records = next;
        },
        host: () => createJosephPersonalHostV0({ ...options, records }),
    };
}

describe("authenticated synthetic Joseph host", () => {
    it("starts with no stars and no inferred auth role, and truthfully blocks an unreviewed company", async () => {
        const f = fixture(),
            host = f.host(),
            view = await host.loadView();
        expect(view.state).toMatchObject({ revision: 0, roles: null, stars: [] });
        expect(view.roles.roleIds).toEqual([]);
        expect(view.ready).toBe(false);
        expect(view.blocker).toContain("unreviewed");
        expect(view.persistence).toBe("server-process-memory");
        expect(view.diagnostics.sources).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    lane: "company",
                    status: "omitted",
                    reason: expect.stringContaining("unreviewed"),
                }),
            ])
        );
        expect(view.documents[0]).toMatchObject({ id: "workspace-document/21", version: "7" });
    });
    it("supports explicit title hints, multi-role confirmation and primary perspective across reloads", async () => {
        const f = fixture(),
            host = createJosephPersonalHostV0({
                ...f.options,
                profileTitle: "Founder + Engineering",
            });
        expect((await host.loadView()).roles.userConfirmed).toBe(false);
        await host.provider.saveRoles(host.input, {
            roleIds: ["founder", "engineering"],
            primaryRoleId: "engineering",
            expectedRevision: 0,
        });
        const reloaded = await f.host().loadView();
        expect(reloaded.roles).toMatchObject({
            roleIds: ["engineering", "founder"],
            primaryRoleId: "engineering",
            userConfirmed: true,
        });
        expect(reloaded.state.revision).toBe(1);
        expect(f.actor.audience.kind).toBe("actor");
    });
    it("uses exact V0 document IDs and resolves a new authorized version without rewriting stored lineage", async () => {
        const f = fixture(),
            host = f.host();
        await host.provider.setStar(host.input, {
            documentId: "workspace-document/21",
            starred: true,
            expectedRevision: 0,
        });
        f.setRecords([
            f.records[0]!,
            f.entry(
                { kind: "doc", id: "workspace-document/21", version: "8" },
                "New synthetic deletion evidence"
            ),
        ]);
        const view = await f.host().loadView();
        expect(view.state.stars[0]!.lastKnownRef.version).toBe("7");
        expect(view.diagnostics.sources.find(item => item.lane === "star")?.source?.version).toBe(
            "8"
        );
        expect(view.documents[0]!.version).toBe("8");
        await expect(
            host.provider.setStar(host.input, {
                documentId: "21",
                starred: true,
                expectedRevision: 1,
            })
        ).rejects.toMatchObject({ status: 403 });
    });
    it("preserves unavailable star IDs without disclosing source text/title and permits removal", async () => {
        const f = fixture(),
            host = f.host();
        await host.provider.setStar(host.input, {
            documentId: "workspace-document/21",
            starred: true,
            expectedRevision: 0,
        });
        f.setRecords([f.records[0]!]);
        const next = f.host(),
            view = await next.loadView();
        expect(view.documents).toEqual([]);
        expect(view.state.stars).toHaveLength(1);
        expect(view.diagnostics.sources.find(item => item.lane === "star")).toMatchObject({
            status: "missing",
            source: { id: "workspace-document/21" },
        });
        expect(JSON.stringify(view)).not.toContain("Synthetic private deletion evidence");
        await next.provider.setStar(next.input, {
            documentId: "workspace-document/21",
            starred: false,
            expectedRevision: 1,
        });
        expect((await next.loadView()).state.stars).toEqual([]);
    });
    it("rejects concurrent stale revisions rather than silently retrying", async () => {
        const f = fixture(),
            host = f.host();
        const results = await Promise.allSettled([
            host.provider.saveRoles(host.input, { roleIds: ["founder"], expectedRevision: 0 }),
            host.provider.saveRoles(host.input, { roleIds: ["engineering"], expectedRevision: 0 }),
        ]);
        expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
        expect(results.find(result => result.status === "rejected")).toMatchObject({
            reason: { status: 409 },
        });
        expect((await host.loadView()).state.revision).toBe(1);
    });
    it("rechecks source availability inside CAS after the provider's initial access check", async () => {
        const f = fixture();
        let reads = 0;
        const host = createJosephPersonalHostV0({
            ...f.options,
            resolveFresh: async () => ({
                actor: f.actor,
                records: ++reads >= 4 ? [f.records[0]!] : f.records,
            }),
        });
        await expect(
            host.provider.setStar(host.input, {
                documentId: "workspace-document/21",
                starred: true,
                expectedRevision: 0,
            })
        ).rejects.toMatchObject({ status: 403 });
        expect((await f.host().loadView()).state.revision).toBe(0);
    });
    it("rejects snapshots after personal or source changes before any guarded write", async () => {
        const f = fixture(),
            host = f.host(),
            before = await host.snapshot(),
            persist = jest.fn(async () => "saved");
        await host.provider.saveRoles(host.input, { roleIds: ["product"], expectedRevision: 0 });
        await expect(host.withFreshState(before, persist)).rejects.toMatchObject({ status: 409 });
        const current = await host.snapshot();
        f.setRecords([
            f.records[0]!,
            f.entry(
                { kind: "doc", id: "workspace-document/21", version: "8" },
                "Changed exact source"
            ),
        ]);
        await expect(host.withFreshState(current.digest, persist)).rejects.toMatchObject({
            status: 409,
        });
        expect(persist).not.toHaveBeenCalled();
    });
    it("holds the personal-state mutex through guarded persistence", async () => {
        const f = fixture(),
            host = f.host(),
            before = await host.snapshot();
        let entered!: () => void, finish!: () => void;
        const enteredPromise = new Promise<void>(resolve => {
                entered = resolve;
            }),
            finishPromise = new Promise<void>(resolve => {
                finish = resolve;
            });
        const commit = host.withFreshState(before, async () => {
            entered();
            await finishPromise;
            return "saved";
        });
        await enteredPromise;
        const mutation = host.provider.saveRoles(host.input, {
            roleIds: ["product"],
            expectedRevision: 0,
        });
        expect((await host.provider.readPersonalState(host.input)).revision).toBe(0);
        finish();
        await expect(commit).resolves.toBe("saved");
        await expect(mutation).resolves.toMatchObject({ revision: 1 });
    });
    it("scopes state by company and principal without using ACL digest as a reset key", async () => {
        const f = fixture(),
            host = f.host();
        await host.provider.saveRoles(host.input, { roleIds: ["founder"], expectedRevision: 0 });
        const other = fixture();
        expect((await other.host().loadView()).state.revision).toBe(0);
        const changedActor = { ...f.actor, aclDigest: "new-synthetic-acl" },
            changedRecords = f.records.map(record => ({
                ...record,
                aclDigest: changedActor.aclDigest,
            }));
        const reauthorized = createJosephPersonalHostV0({
            ...f.options,
            actor: changedActor,
            records: changedRecords,
            resolveFresh: async () => ({ actor: changedActor, records: changedRecords }),
        });
        expect((await reauthorized.loadView()).state.revision).toBe(1);
    });
    it("rejects cross-company records, foreign actors and changed ACLs", async () => {
        const f = fixture();
        expect(() =>
            createJosephPersonalHostV0({
                ...f.options,
                records: [{ ...f.records[1]!, companyId: "foreign" }],
            })
        ).toThrow();
        const host = createJosephPersonalHostV0({
            ...f.options,
            resolveFresh: async () => ({
                actor: { ...f.actor, aclDigest: "revoked" },
                records: f.records,
            }),
        });
        await expect(host.loadView()).rejects.toMatchObject({ status: 403 });
        await expect(
            f.host().provider.readPersonalState({ ...f.host().input, principalRef: "foreign" })
        ).rejects.toMatchObject({ status: 403 });
    });
    it("never upgrades an unreviewed body via a caller-supplied reviewed ref", async () => {
        const f = fixture();
        const host = createJosephPersonalHostV0({
            ...f.options,
            companyRef: {
                ...f.records[0]!.source,
                companyId: f.actor.companyId,
                canonical: true,
                reviewState: "reviewed",
            } as CompanyArchitectureRefV0,
        });
        await expect(host.loadView()).rejects.toMatchObject({ status: 409 });
    });
    it("preserves independent mandatory inclusion when a personal star is removed", async () => {
        // Explicit unit-only reviewed fixture; the real canonical demo remains unreviewed.
        const f = fixture("reviewed");
        f.setRecords([
            f.records[0]!,
            { ...f.records[1]!, audience: { kind: "company", companyId: f.actor.companyId } },
        ]);
        const host = createJosephPersonalHostV0({
            ...f.options,
            records: f.records,
            mandatoryRefs: [f.records[1]!.source],
        });
        await host.provider.setStar(host.input, {
            documentId: "workspace-document/21",
            starred: true,
            expectedRevision: 0,
        });
        let view = await host.loadView();
        expect(view.ready).toBe(true);
        expect(view.diagnostics.sources.find(item => item.lane === "star")?.reason).toContain(
            "Already included"
        );
        await host.provider.setStar(host.input, {
            documentId: "workspace-document/21",
            starred: false,
            expectedRevision: 1,
        });
        view = await host.loadView();
        expect(view.diagnostics.sources.find(item => item.lane === "mandatory")?.status).toBe(
            "used"
        );
        expect(view.state.stars).toEqual([]);
    });
    it("does not silently discard required context over budget", async () => {
        const f = fixture("reviewed"),
            host = createJosephPersonalHostV0({
                ...f.options,
                budgets: { ...f.options.budgets, maxSources: 0 },
            });
        const view = await host.loadView();
        expect(view.ready).toBe(false);
        expect(view.diagnostics.coverage.used).toEqual([]);
        expect(view.diagnostics.coverage.omitted).toHaveLength(1);
        expect(view.blocker).not.toContain("remains unreviewed");
    });
    it("ignores volatile checkedAt values while fingerprinting exact content/version/ACL", async () => {
        const f = fixture();
        let tick = 0;
        const host = createJosephPersonalHostV0({
            ...f.options,
            resolveFresh: async () => ({
                actor: f.actor,
                records: f.records.map(record => ({
                    ...record,
                    checkedAt: new Date(1793041200000 + ++tick).toISOString(),
                })),
            }),
        });
        expect((await host.snapshot()).digest).toBe((await host.snapshot()).digest);
        expect((await host.loadView()).ready).toBe(false);
    });
});
