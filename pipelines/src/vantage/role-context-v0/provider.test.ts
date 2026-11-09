import { describe, expect, it } from "vitest";
import {
    createPersonalContextFixtureV0,
    createMemoryPersonalContextStoreV0,
    fixtureRequestV0 as input,
} from "./fixtures";
import { createPersonalContextProviderV0, RequiredContextErrorV0 } from "./provider";
import { mergedRolePrioritiesV0, resolveRoleSelectionV0 } from "./roles";
import { emptyPersonalContextV0 } from "./contracts";
import { validateRequiredContextBundle } from "../proposals/context-v0";

const roles = (values: string[], primaryRoleId?: string) =>
    resolveRoleSelectionV0({
        principalRef: input.principalRef,
        values,
        primaryRoleId,
        confirmed: true,
    });
const required = async (
    fixture: ReturnType<typeof createPersonalContextFixtureV0>,
    request = input
) =>
    fixture.provider.resolveRequiredContext({
        ...request,
        roleContext: await fixture.provider.resolveBusinessRoles(request),
    });
async function star(f: ReturnType<typeof createPersonalContextFixtureV0>, id = "101") {
    const state = await f.provider.readPersonalState(input);
    return f.provider.setStar(input, {
        documentId: id,
        starred: true,
        expectedRevision: state.revision,
    });
}
async function diagnostics(f: ReturnType<typeof createPersonalContextFixtureV0>, request = input) {
    try {
        await required(f, request);
        throw new Error("Expected blocked context");
    } catch (error) {
        expect(error).toBeInstanceOf(RequiredContextErrorV0);
        return (error as RequiredContextErrorV0).diagnostics;
    }
}
describe("Joseph multi-role context", () => {
    it("resolves Founder + Engineering and never adds ACL fields", async () => {
        const f = createPersonalContextFixtureV0();
        const before = structuredClone(f.actor);
        const result = await f.provider.resolveBusinessRoles(input);
        expect(result.roleIds).toEqual(["founder", "engineering"]);
        expect(result.userConfirmed).toBe(false);
        expect(f.actor).toEqual(before);
        expect(result).not.toHaveProperty("permissions");
    });
    it("normalizes aliases, deduplicates and preserves deterministic primary-first merging", () => {
        expect(roles(["engineering lead", "Founder", "engineering"], "engineering")).toEqual(
            roles(["founder", "engineering"], "engineering")
        );
        expect(mergedRolePrioritiesV0(roles(["founder", "engineering"], "engineering"))[0]).toBe(
            "blockers"
        );
    });
    it.each([{ values: [] }, { values: ["administrator"] }, { values: ["totally unknown"] }])(
        "has an explicit safe fallback for $values",
        ({ values }) => {
            expect(roles(values).fallback).toBe(true);
            expect(roles(values).roleIds).toEqual([]);
        }
    );
    it("keeps recognized roles while reporting a partially unknown identity", () => {
        expect(roles(["founder", "unknown"])).toMatchObject({
            roleIds: ["founder"],
            fallback: true,
        });
    });
    it("persists manual corrections without changing profile title or membership", async () => {
        const f = createPersonalContextFixtureV0();
        await f.provider.saveRoles(input, {
            roleIds: ["growth-sales", "engineering"],
            primaryRoleId: "engineering",
            expectedRevision: 0,
        });
        expect(await f.provider.resolveBusinessRoles(input)).toMatchObject({
            roleIds: ["engineering", "growth-sales"],
            primaryRoleId: "engineering",
            userConfirmed: true,
        });
        expect(await f.deps.readProfileTitle(f.actor)).toBe("Founder + Engineering lead");
    });
    it("rejects an invalid primary role and unknown manual role", async () => {
        const f = createPersonalContextFixtureV0();
        await expect(
            f.provider.saveRoles(input, {
                roleIds: ["founder"],
                primaryRoleId: "engineering",
                expectedRevision: 0,
            })
        ).rejects.toMatchObject({ status: 400 });
        await expect(
            f.provider.saveRoles(input, { roleIds: ["admin"], expectedRevision: 0 })
        ).rejects.toMatchObject({ status: 400 });
    });
    it("cannot request roles outside the resolved profile", async () => {
        const f = createPersonalContextFixtureV0();
        await expect(
            f.provider.resolveBusinessRoles({ ...input, requestedRoleIds: ["growth-sales"] })
        ).rejects.toMatchObject({ status: 400 });
    });
    it("uses atomic revisions to reject stale or simultaneous edits", async () => {
        const f = createPersonalContextFixtureV0();
        const results = await Promise.allSettled([
            f.provider.saveRoles(input, { roleIds: ["founder"], expectedRevision: 0 }),
            f.provider.saveRoles(input, { roleIds: ["product"], expectedRevision: 0 }),
        ]);
        expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
        expect(results.find(r => r.status === "rejected")).toMatchObject({
            reason: { status: 409 },
        });
    });
});
describe("personal Vantage stars and required context", () => {
    it("accepts zero stars with a real company record", async () => {
        const bundle = await required(createPersonalContextFixtureV0());
        expect(bundle.personalVantageStars).toEqual([]);
        expect(validateRequiredContextBundle(bundle).ok).toBe(true);
    });
    it("retains January's unchanged document, exact version, offsets and constraints", async () => {
        const f = createPersonalContextFixtureV0();
        await star(f);
        const bundle = await required(f);
        expect(bundle.personalVantageStars[0]).toMatchObject({
            source: { kind: "doc", id: "101", version: "7" },
            module: "vantage",
            audience: f.actor.audience,
            excerptOffsets: { sourceVersion: "7", start: 0 },
        });
        expect(bundle.constraints).toContain(
            "Every release requires a rollback plan and an owner."
        );
        expect(bundle.coverage.used).toHaveLength(2);
        expect(validateRequiredContextBundle(bundle).ok).toBe(true);
    });
    it("is deterministic regardless of star insertion order", async () => {
        const a = createPersonalContextFixtureV0(),
            b = createPersonalContextFixtureV0();
        await star(a, "101");
        await star(a, "102");
        await star(b, "102");
        await star(b, "101");
        expect(await required(a)).toEqual(await required(b));
    });
    it("persists selections across adapter recreation without caching excerpts", async () => {
        const f = createPersonalContextFixtureV0();
        await star(f);
        const snapshot = f.store.snapshot();
        expect(JSON.stringify(snapshot)).not.toContain("rollback plan");
        const reopened = createPersonalContextFixtureV0(snapshot);
        expect((await required(reopened)).personalVantageStars).toHaveLength(1);
    });
    it("is scoped by company, user and Vantage module", async () => {
        const f = createPersonalContextFixtureV0();
        await star(f);
        for (const actor of [
            { ...f.actor, companyId: "other-company" },
            { ...f.actor, principalRef: "other-user" },
        ])
            expect((await f.store.read(actor)).stars).toEqual([]);
        const bad = {
            ...emptyPersonalContextV0(f.actor),
            module: "marketing",
        } as unknown as ReturnType<typeof emptyPersonalContextV0>;
        expect((await createMemoryPersonalContextStoreV0([bad]).read(f.actor)).revision).toBe(0);
        await expect(required(f, { ...input, companyId: "other-company" })).rejects.toThrow();
    });
    it("star/unstar is unique and preserves original starredAt", async () => {
        const f = createPersonalContextFixtureV0();
        const first = await star(f);
        const second = await star(f);
        expect(second.stars).toHaveLength(1);
        expect(second.stars[0]?.starredAt).toBe(first.stars[0]?.starredAt);
        await f.provider.setStar(input, { documentId: "101", starred: false, expectedRevision: 2 });
        expect((await required(f)).personalVantageStars).toEqual([]);
    });
    it.each(["revoked", "missing"] as const)(
        "checks %s stars on every call and never falls back to private excerpts",
        async status => {
            const f = createPersonalContextFixtureV0();
            await star(f);
            await required(f);
            f.controls[status].add("101");
            const d = await diagnostics(f);
            expect(d.coverage[status]).toContainEqual({ kind: "doc", id: "101", version: "7" });
            expect(JSON.stringify(d)).not.toContain("rollback plan");
            await expect(star(f)).rejects.toMatchObject({ status: 403 });
            await f.provider.setStar(input, {
                documentId: "101",
                starred: false,
                expectedRevision: 1,
            });
            expect((await required(f)).status).toBe("complete");
        }
    );
    it("reports missing architecture distinctly, still checks every star", async () => {
        const f = createPersonalContextFixtureV0();
        await star(f);
        f.controls.architectureMissing = true;
        const d = await diagnostics(f);
        expect(d.sources.find(s => s.lane === "company")).toMatchObject({ status: "missing" });
        expect(d.sources.find(s => s.lane === "star")).toMatchObject({ status: "used" });
    });
    it("preserves Joseph's strict review gate for the TL adapter's unreviewed company profile", async () => {
        const f = createPersonalContextFixtureV0();
        const inventory = f.deps.requiredSources;
        f.deps.requiredSources = async (...args) => {
            const value = await inventory(...args);
            return {
                ...value,
                companyArchitecture: { ...value.companyArchitecture!, reviewState: "unreviewed" },
            };
        };
        await expect(required(f)).rejects.toMatchObject({ status: 409 });
    });
    it("does not truncate mandatory context to fit top-k or excerpt budgets", async () => {
        const f = createPersonalContextFixtureV0();
        await star(f);
        await star(f, "102");
        const d = await diagnostics(f, {
            ...input,
            budgets: { ...input.budgets, maxSources: 1, maxExcerptChars: 2 },
        });
        expect(d.coverage.checked).toHaveLength(3);
        expect(d.coverage.used).toEqual([]);
        expect(d.coverage.omitted).toHaveLength(3);
    });
    it("rejects wrong-tenant and wrong-user source bodies without disclosing them", async () => {
        const f = createPersonalContextFixtureV0();
        await star(f);
        const read = f.deps.readDocument;
        f.deps.readDocument = async (...args) => {
            const r = await read(...args);
            return r.status === "allowed"
                ? { ...r, entry: { ...r.entry, companyId: "other", excerpt: "SECRET" } }
                : r;
        };
        expect(JSON.stringify(await diagnostics(f))).not.toContain("SECRET");
    });
    it("re-resolves changed document versions instead of using star-time content", async () => {
        const f = createPersonalContextFixtureV0();
        await star(f);
        const read = f.deps.readDocument;
        f.deps.readDocument = async (...args) => {
            const r = await read(...args);
            return r.status === "allowed"
                ? {
                      ...r,
                      entry: {
                          ...r.entry,
                          source: { ...r.entry.source, version: "8" },
                          excerptOffsets: undefined,
                      },
                  }
                : r;
        };
        expect((await required(f)).personalVantageStars[0]?.source.version).toBe("8");
    });
    it("rejects post-cutoff, stale offset and source-ID substitution", async () => {
        for (const change of [
            { sourceDate: "2026-10-27T00:00:00Z" },
            { excerptOffsets: { start: 0, end: 2, sourceVersion: "wrong" } },
            { source: { kind: "doc" as const, id: "another", version: "7" } },
        ]) {
            const f = createPersonalContextFixtureV0();
            await star(f);
            const read = f.deps.readDocument;
            f.deps.readDocument = async (...args) => {
                const r = await read(...args);
                return r.status === "allowed" ? { ...r, entry: { ...r.entry, ...change } } : r;
            };
            expect((await diagnostics(f)).coverage.omitted).toHaveLength(1);
        }
    });
    it("deduplicates a document mandatory in both lanes while recording the personal check", async () => {
        const f = createPersonalContextFixtureV0();
        await star(f);
        const inventory = f.deps.requiredSources;
        f.deps.requiredSources = async (...args) => ({
            ...(await inventory(...args)),
            workspaceMandatoryDocuments: [{ kind: "doc", id: "101", version: "7" }],
        });
        const read = f.deps.readSource;
        f.deps.readSource = (actor, ref, window, signal) =>
            ref.kind === "doc"
                ? f.deps.readDocument(actor, ref.id, window, signal)
                : read(actor, ref, window, signal);
        const result = await f.provider.prepareRequiredContext({
            ...input,
            roleContext: await f.provider.resolveBusinessRoles(input),
        });
        expect(result.bundle.workspaceMandatoryDocuments).toHaveLength(1);
        expect(result.bundle.personalVantageStars).toHaveLength(0);
        expect(result.diagnostics.sources.find(s => s.lane === "star")?.reason).toContain(
            "Already included"
        );
        expect(validateRequiredContextBundle(result.bundle).ok).toBe(true);
    });
    it("bounds a hanging resolver and honors cancellation", async () => {
        const f = createPersonalContextFixtureV0();
        f.deps.requiredSources = () => new Promise(() => {});
        await expect(
            required(f, { ...input, budgets: { ...input.budgets, timeoutMs: 10 } })
        ).rejects.toMatchObject({ status: 503 });
        const controller = new AbortController();
        controller.abort();
        await expect(required(f, { ...input, signal: controller.signal })).rejects.toMatchObject({
            status: 503,
        });
    });
    it("treats source-adapter outages as explicit unavailable coverage", async () => {
        const f = createPersonalContextFixtureV0();
        await star(f);
        f.deps.readDocument = async () => {
            throw new Error("private error contents");
        };
        const d = await diagnostics(f);
        expect(d.sources.find(s => s.lane === "star")?.status).toBe("unavailable");
        expect(JSON.stringify(d)).not.toContain("private error");
    });
    it("rejects an injected store returning another user's data", async () => {
        const f = createPersonalContextFixtureV0();
        f.deps.store = {
            ...f.store,
            read: async () => ({ ...emptyPersonalContextV0(f.actor), principalRef: "other" }),
        };
        await expect(
            createPersonalContextProviderV0(f.deps).readPersonalState(input)
        ).rejects.toMatchObject({ status: 403 });
    });
});
