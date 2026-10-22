import { describe, expect, it } from "vitest";
import normalFixture from "../../../../fixtures/vantage-context-v0/normal.json";
import type { ContextScopeV0 } from "../proposals/context-v0";
import { createEvidenceSnapshotV0 } from "./evidence-snapshot";
import { createSourceRegistryV0 } from "./registry";
import type {
    RegisteredContextSourceV0,
    SourceRegistryV0,
    TrustedContextSourceV0,
} from "./contracts";

const clone = <T>(value: T): T => structuredClone(value);

function makeRegistry(): SourceRegistryV0 {
    const actor = clone(normalFixture.requiredBundle.actor) as unknown as ContextScopeV0;
    const reportWindow = clone(normalFixture.retrievalBundle.reportWindow);
    const built = createSourceRegistryV0({
        actor,
        reportWindow,
        trustedCatalog: clone(
            normalFixture.retrievalInput.sourceCatalog
        ) as TrustedContextSourceV0[],
    });
    if (!built.ok) throw new Error(built.issues.map(issue => issue.message).join("; "));
    return built.registry;
}

describe("Vantage V0 evidence snapshot boundary", () => {
    it("rejects invalid budgets before reading registry entries", () => {
        const registry = makeRegistry();
        const ref = registry.entries[0]!.source;
        for (const budgets of [
            { maxSources: Number.NaN, maxExcerptChars: 100 },
            { maxSources: -1, maxExcerptChars: 100 },
            { maxSources: 1.5, maxExcerptChars: 100 },
            { maxSources: 1, maxExcerptChars: Number.POSITIVE_INFINITY },
        ]) {
            const result = createEvidenceSnapshotV0({
                registry,
                refs: [ref],
                asOf: registry.scope.reportWindow.asOf,
                budgets,
            });
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.issues[0]?.code).toBe("invalid_budget");
        }
    });

    it("requires a strict registry-bound ISO asOf", () => {
        const registry = makeRegistry();
        const ref = registry.entries[0]!.source;
        const invalid = createEvidenceSnapshotV0({
            registry,
            refs: [ref],
            asOf: "2026-02-31T12:00:00Z",
            budgets: { maxSources: 10, maxExcerptChars: 5000 },
        });
        expect(invalid.ok).toBe(false);
        if (!invalid.ok)
            expect(invalid.issues.some(issue => issue.code === "invalid_as_of")).toBe(true);

        const mismatched = createEvidenceSnapshotV0({
            registry,
            refs: [ref],
            asOf: "2026-10-19T13:00:00Z",
            budgets: { maxSources: 10, maxExcerptChars: 5000 },
        });
        expect(mismatched.ok).toBe(false);
        if (!mismatched.ok)
            expect(mismatched.issues.some(issue => issue.code === "as_of_mismatch")).toBe(true);
    });

    it("rejects a canonical source dated after the requested asOf", () => {
        const registry = makeRegistry();
        const ref = registry.entries[0]!.source;
        const futureEntry: RegisteredContextSourceV0 = {
            ...registry.entries[0]!,
            sourceDate: "2026-10-20T00:00:00Z",
        };
        const byKey = new Map([[`${ref.kind}:${ref.id}@${ref.version}`, futureEntry]]);
        const customRegistry = {
            ...registry,
            entries: [futureEntry],
            get: (candidate: typeof ref) =>
                byKey.get(`${candidate.kind}:${candidate.id}@${candidate.version}`),
        } as SourceRegistryV0;
        const result = createEvidenceSnapshotV0({
            registry: customRegistry,
            refs: [ref],
            asOf: registry.scope.reportWindow.asOf,
            budgets: { maxSources: 10, maxExcerptChars: 5000 },
        });
        expect(result.ok).toBe(false);
        if (!result.ok)
            expect(result.issues.some(issue => issue.code === "invalid_source_date")).toBe(true);
    });
});
