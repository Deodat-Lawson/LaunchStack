import { describe, expect, it } from "vitest";
import normalFixture from "../../../../fixtures/vantage-context-v0/normal.json";
import {
    contextSourceKeyV0,
    type ContextScopeV0,
    type ContextSourceEntryV0,
} from "../proposals/context-v0";
import { createSourceRegistryV0 } from "./registry";
import type { TrustedContextSourceV0 } from "./contracts";

const clone = <T>(value: T): T => structuredClone(value);
const fixtureCatalog = () =>
    clone(normalFixture.retrievalInput.sourceCatalog) as TrustedContextSourceV0[];
const scope = clone(normalFixture.requiredBundle.actor) as unknown as ContextScopeV0;
const reportWindow = clone(normalFixture.retrievalBundle.reportWindow);

describe("Vantage V0 source registry", () => {
    it("builds an immutable canonical registry and resolves selections against it", () => {
        const built = createSourceRegistryV0({
            actor: scope,
            reportWindow,
            trustedCatalog: fixtureCatalog(),
        });
        expect(built.ok).toBe(true);
        if (!built.ok) return;
        const source = built.registry.get({
            kind: "doc",
            id: "doc-weekly-plan",
            version: "doc-v7",
        });
        expect(source?.aclDigest).toBe("acl-tilde-company-1");
        expect(Object.isFrozen(built.registry.entries)).toBe(true);
        const selected = built.registry.resolve({
            ...(source as ContextSourceEntryV0),
            aclDigest: "attacker-acl",
        });
        expect(selected.ok).toBe(false);
        expect(selected.ok ? "" : selected.issues[0]?.code).toBe("selection_metadata_mismatch");
    });

    it("deduplicates identical exact refs but rejects conflicting metadata", () => {
        const catalog = fixtureCatalog();
        const duplicate = clone(catalog[0]!);
        const same = createSourceRegistryV0({
            actor: scope,
            reportWindow,
            trustedCatalog: [...catalog, duplicate],
        });
        expect(same.ok).toBe(true);
        if (!same.ok) return;
        expect(
            same.registry.entries.filter(
                entry => contextSourceKeyV0(entry.source) === contextSourceKeyV0(catalog[0]!.source)
            )
        ).toHaveLength(1);
        const conflict = createSourceRegistryV0({
            actor: scope,
            reportWindow,
            trustedCatalog: [...catalog, { ...duplicate, aclDigest: "different-acl" }],
        });
        expect(conflict.ok).toBe(false);
        expect(
            conflict.ok
                ? ""
                : conflict.issues.some(item => item.code === "conflicting_source_metadata")
        ).toBe(true);
    });

    it("rejects cross-actor, cross-company, public relabeling, and future catalog records", () => {
        const catalog = fixtureCatalog();
        const privateEntry = catalog.find(entry => entry.source.kind === "doc")!;
        const crossActor = {
            ...privateEntry,
            audience: { kind: "actor" as const, principalRef: "other-user" },
        };
        const crossCompany = { ...privateEntry, companyId: "other-company" };
        const relabeled = { ...privateEntry, audience: { kind: "public" as const } };
        const future = { ...privateEntry, sourceDate: "2027-01-01T00:00:00Z" };
        for (const entry of [crossActor, crossCompany, relabeled, future]) {
            const result = createSourceRegistryV0({
                actor: scope,
                reportWindow,
                trustedCatalog: [entry],
            });
            expect(result.ok).toBe(false);
        }
    });

    it("keeps old unchanged source versions valid while rejecting revoked selections", () => {
        const catalog = fixtureCatalog();
        const old = {
            ...catalog.find(entry => entry.source.id === "doc-starred-roadmap")!,
            source: { kind: "doc" as const, id: "doc-starred-roadmap", version: "doc-v1" },
        };
        const built = createSourceRegistryV0({
            actor: scope,
            reportWindow,
            trustedCatalog: [...catalog, old],
        });
        expect(built.ok).toBe(true);
        if (!built.ok) return;
        expect(built.registry.resolve(old).ok).toBe(true);
        const revoked = { ...old, access: "revoked" as const, excerpt: "" };
        const revokedRegistry = createSourceRegistryV0({
            actor: scope,
            reportWindow,
            trustedCatalog: [revoked],
        });
        expect(revokedRegistry.ok).toBe(true);
        if (!revokedRegistry.ok) return;
        expect(revokedRegistry.registry.resolve(old).ok).toBe(false);
    });
});
