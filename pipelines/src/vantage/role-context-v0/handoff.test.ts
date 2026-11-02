import { describe, expect, it } from "vitest";
import { createPersonalContextFixtureV0, fixtureRequestV0 as input } from "./fixtures";
import { assembleContextManifestV0 } from "../context-v0/assembler";
import { createSourceRegistryV0 } from "../context-v0/registry";

describe("Joseph provider → TL immutable manifest", () => {
    it("assembles multi-role required context against an independently resolved fixture catalog", async () => {
        const f = createPersonalContextFixtureV0();
        await f.provider.setStar(input, { documentId: "101", starred: true, expectedRevision: 0 });
        const roleContext = await f.provider.resolveBusinessRoles(input);
        const required = await f.provider.resolveRequiredContext({ ...input, roleContext });
        // Catalog reads are independent of the provider result. Production wiring belongs to TL.
        const inventory = await f.deps.requiredSources(f.actor, input.reportWindow);
        const company = await f.deps.readSource(
            f.actor,
            inventory.companyArchitecture!,
            input.reportWindow
        );
        const doc = await f.deps.readDocument(f.actor, "101", input.reportWindow);
        if (company.status !== "allowed" || doc.status !== "allowed")
            throw new Error("Fixture catalog unavailable");
        const sourceCatalog = [company.entry, { ...doc.entry, audience: f.actor.audience }];
        const registry = createSourceRegistryV0({
            actor: f.actor,
            reportWindow: input.reportWindow,
            trustedCatalog: sourceCatalog,
        });
        expect(registry.ok).toBe(true);
        if (!registry.ok) return;
        const result = assembleContextManifestV0({
            runId: "joseph-handoff",
            actor: f.actor,
            reportWindow: input.reportWindow,
            roleContext,
            roleProfileVersions: { founder: "fixture-0", engineering: "fixture-0" },
            required,
            registry: registry.registry,
            budgets: input.budgets,
            retrievalInput: {
                contractVersion: "v0-proposed",
                actor: f.actor,
                verifiedRoleContext: roleContext,
                reportWindow: input.reportWindow,
                sourceCatalog,
                budgets: input.budgets,
            },
            retrieval: {
                contractVersion: "v0-proposed",
                actor: f.actor,
                reportWindow: input.reportWindow,
                roleMatches: [],
                recentChanges: [],
                unresolvedOlderItems: [],
                sourceRegistry: [],
                deduped: [],
                omissions: [],
                failures: [],
                status: "complete",
            },
        });
        expect(result.ok, result.ok ? undefined : JSON.stringify(result.issues)).toBe(true);
        if (result.ok) {
            expect(result.value.manifest.roleIds).toEqual(["engineering", "founder"]);
            expect(result.value.evidenceSnapshot.entries).toHaveLength(2);
        }
    });
});
