import { describe, expect, it, vi } from "vitest";
import { createDecisionExperimentV2, GENERATION_PROMPT_VERSION_V2 } from "./decision-generation-v2";
import historical from "../../../../fixtures/vantage-role-pair-milestone/historical-C02.input.json";
import sources from "../../../../fixtures/vantage-role-pair-milestone/sources.json";
import { createDynamicRetrievalProviderV0 } from "../dynamic-retrieval/retrieve";
import { assembleContextManifestV0 } from "../context-v0/assembler";
import { createSourceRegistryV0 } from "../context-v0/registry";
import type { TrustedContextSourceV0 } from "../context-v0/contracts";
import type { ContextGenerationEnvelopeV0 } from "../context-v0/ports";
import type { RequiredContextBundleV0 } from "../proposals/context-v0";
import { contextSourceKeyV0 } from "../proposals/context-v0";
import { resolveRoleSelectionV0 } from "../role-context-v0/roles";
import {
    buildRolePairPriorityPlan,
    runRoleMilestoneGeneration,
    evaluateRoleMilestoneReport,
    roleMilestoneOutputSize,
    createRoleMilestoneRuntime,
    buildRolePairCompound,
    type RoleMilestoneRefs,
} from "./role-pair-milestone-v1";
const ids = ["partnerships-lead", "security-engineer"];
/** Component-only synthetic assembly. Real auth/current-state/persistence live in the host acceptance suite. */
async function fixture(
    primary: string,
    confirmed = true,
    unknown = false,
    preference = true,
    nativeCopies: "two" | "historical-eight" = "two"
) {
    const old = structuredClone(historical.envelope) as unknown as ContextGenerationEnvelopeV0;
    old.v1Input.data.currentEvidence =
        nativeCopies === "two"
            ? old.v1Input.data.currentEvidence.filter(item => ["D01", "D08"].includes(item.id))
            : old.v1Input.data.currentEvidence;
    const roleContext = resolveRoleSelectionV0({
        principalRef: old.manifest.actor.principalRef,
        values: unknown ? ["unknown title"] : ids,
        primaryRoleId: primary,
        confirmed,
    });
    const catalog = old.manifest.sourceRegistry.map(entry => ({
        ...entry,
        sourceDate: `${sources.documents.find(document => document.logicalKey === entry.source.id)!.sourceDate}T12:00:00.000Z`,
        content: entry.excerpt,
    })) as TrustedContextSourceV0[];
    const sourceRefs = Object.fromEntries(
        catalog.map(entry => [entry.source.id, entry.source])
    ) as RoleMilestoneRefs;
    const company = catalog.find(entry => entry.source.kind === "company")!;
    const required = {
        contractVersion: "v0-proposed",
        actor: old.manifest.actor,
        asOf: old.manifest.reportWindow.asOf,
        companyArchitecture: { ...company, canonical: true, required: true },
        workspaceMandatoryDocuments: [],
        personalVantageStars: [],
        constraints: [],
        coverage: {
            checked: [company.source],
            used: [company.source],
            missing: [],
            revoked: [],
            omitted: [],
        },
        status: "complete",
    } as unknown as RequiredContextBundleV0;
    const budgets = {
        maxSources: 12,
        maxExcerptChars: 16000,
        maxTokens: 16000,
        maxQueries: 2,
        timeoutMs: 5000,
    };
    const input = {
        contractVersion: "v0-proposed" as const,
        actor: old.manifest.actor,
        reportWindow: old.manifest.reportWindow,
        verifiedRoleContext: roleContext,
        sourceCatalog: catalog,
        budgets,
    };
    const metadata = catalog.map(entry => ({
        source: entry.source,
        roleIds: sources.documents.find(d => d.logicalKey === entry.source.id)?.roleIds ?? [],
        changedAt: entry.sourceDate,
    }));
    const ranking = await createDynamicRetrievalProviderV0({
        metadata,
        primaryRolePreference: preference,
    }).retrieve(input);
    const registry = createSourceRegistryV0({
        actor: old.manifest.actor,
        reportWindow: old.manifest.reportWindow,
        trustedCatalog: catalog,
    });
    if (!registry.ok) throw new Error(JSON.stringify(registry.issues));
    const assembled = assembleContextManifestV0({
        runId: old.manifest.runId,
        inputVersion: old.manifest.inputVersion,
        actor: old.manifest.actor,
        reportWindow: old.manifest.reportWindow,
        roleContext,
        roleProfileVersions: Object.fromEntries(
            roleContext.roleIds.map(id => [id, "canonical-test-profile/v1"])
        ),
        required,
        registry: registry.registry,
        retrievalInput: input,
        retrieval: ranking,
        budgets,
    });
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.issues));
    const envelope = {
        v1Input: old.v1Input,
        manifest: assembled.value.manifest,
        evidenceSnapshot: assembled.value.evidenceSnapshot,
        freeze: assembled.value.freeze,
    };
    const missing = Object.values(sourceRefs).filter(
        ref =>
            !envelope.evidenceSnapshot.entries.some(
                entry => contextSourceKeyV0(entry.source) === contextSourceKeyV0(ref)
            )
    );
    if (missing.length)
        throw new Error(
            JSON.stringify({
                unknown,
                missing,
                ranking: ranking.sourceRegistry.map(entry => entry.source),
                omissions: ranking.omissions,
                failures: ranking.failures,
            })
        );
    return { envelope, sourceRefs, roleContext, ranking };
}
describe("role-pair deterministic generation via actual canonical roles and actual ranking (component-only)", () => {
    it("uses the same ten exact source versions and only the primary flip changes actual first rank and first topic", async () => {
        const a = await fixture(ids[0]!),
            b = await fixture(ids[1]!);
        expect(
            a.envelope.evidenceSnapshot.entries.map(e => [
                contextSourceKeyV0(e.source),
                e.contentHash,
            ])
        ).toEqual(
            b.envelope.evidenceSnapshot.entries.map(e => [
                contextSourceKeyV0(e.source),
                e.contentHash,
            ])
        );
        expect([...a.roleContext.roleIds].sort()).toEqual([...b.roleContext.roleIds].sort());
        expect(
            a.ranking.sourceRegistry.find(entry => ["D01", "D08"].includes(entry.source.id))!.source
                .id
        ).toBe("D01");
        expect(
            b.ranking.sourceRegistry.find(entry => ["D01", "D08"].includes(entry.source.id))!.source
                .id
        ).toBe("D08");
        expect(a.ranking.sourceRegistry.map(entry => entry.source.id)).not.toEqual(
            b.ranking.sourceRegistry.map(entry => entry.source.id)
        );
        const A = await runRoleMilestoneGeneration(a),
            B = await runRoleMilestoneGeneration(b);
        expect(A.outcome, JSON.stringify(A)).toBe("v2-first-pass");
        expect(B.outcome, JSON.stringify(B)).toBe("v2-first-pass");
        expect(A.trace.priorityPlan.topics[0]!.logicalKey).toBe("D01");
        expect(B.trace.priorityPlan.topics[0]!.logicalKey).toBe("D08");
        for (const [input, result] of [
            [a, A],
            [b, B],
        ] as const) {
            const frameMessage = result.trace.promptMessages.find(
                message =>
                    message.type === "system" &&
                    typeof message.content === "string" &&
                    message.content.startsWith("M2 trustedPrimary=")
            );
            expect(frameMessage).toBeDefined();
            const frame = JSON.parse(
                (frameMessage!.content as string).split("\n")[0]!.slice("M2 trustedPrimary=".length)
            );
            const primary = input.roleContext.roles.find(
                role => role.roleId === input.roleContext.primaryRoleId
            )!;
            expect(frame).toEqual({
                primaryRoleId: primary.roleId,
                mappingVersion: input.roleContext.mappingVersion,
                description: primary.description,
                responsibilities: primary.responsibilities,
                priorities: primary.priorities,
            });
            expect(result.trace.invocations).toBe(1);
            expect(result.output!.report.topics).toHaveLength(2);
            expect(
                evaluateRoleMilestoneReport(
                    result.output!.report,
                    input.sourceRefs,
                    input.roleContext
                ).passed
            ).toBe(true);
            expect(roleMilestoneOutputSize(result.trace.compound).outputTokens).toBeLessThanOrEqual(
                2400
            );
            expect(result.output!.diagnostics.promptBytes).toBeLessThanOrEqual(23500);
        }
    });
    it.each([
        { confirmed: false, unknown: false },
        { confirmed: false, unknown: true },
    ])(
        "retains both topics with a generic persona for $confirmed/$unknown identity",
        async options => {
            const input = await fixture(ids[1]!, options.confirmed, options.unknown);
            const result = await runRoleMilestoneGeneration(input);
            expect(result.outcome, JSON.stringify(result)).toBe("v2-first-pass");
            expect(result.trace.priorityPlan.persona).toBe("neutral");
            expect(result.trace.priorityPlan.primaryRoleId).toBeNull();
            const marker = result.trace.promptMessages.find(
                message =>
                    message.type === "system" &&
                    typeof message.content === "string" &&
                    message.content.startsWith("M2 trustedPrimary=")
            )!;
            const neutral = JSON.parse(
                (marker.content as string).split("\n")[0]!.slice("M2 trustedPrimary=".length)
            );
            expect(neutral).toEqual({
                primaryRoleId: null,
                mappingVersion: input.roleContext.mappingVersion,
                fallback: true,
                responsibilities: [],
                priorities: [],
            });
            expect(result.output!.report.topics).toHaveLength(2);
            expect(result.output!.report.summary).toContain("confirming business responsibilities");
        }
    );
    it("rejects a mapped-role run if the actual provider primary preference was disabled", async () => {
        const input = await fixture(ids[1]!, true, false, false);
        expect(() => buildRolePairPriorityPlan(input)).toThrow();
    });
    it("rejects a forged role identity and an unregistered source version before transport", async () => {
        const input = await fixture(ids[0]!);
        input.roleContext.authenticatedPrincipalRef = "another-user";
        await expect(runRoleMilestoneGeneration(input)).rejects.toThrow();
        const second = await fixture(ids[0]!);
        second.sourceRefs.D08 = { ...second.sourceRefs.D08, version: "missing-version" };
        await expect(runRoleMilestoneGeneration(second)).rejects.toThrow();
    });
    it("fits the original native projection via M2 compaction while default transport retains its cap rejection", async () => {
        const input = await fixture(ids[0]!, true, false, true, "historical-eight");
        const compound = buildRolePairCompound(input);
        const original = await createDecisionExperimentV2({
            version: GENERATION_PROMPT_VERSION_V2,
            resolvePrimaryRole: () => input.roleContext,
            countTokens: () => 100,
            invoke: async (_model, schema) => ({
                result: schema.parse(compound),
                usage: { outputTokens: 0 },
            }),
        })(input.envelope, createRoleMilestoneRuntime());
        expect(original.outcome).toBe("failed");
        expect("setup" in original ? original.setup?.reason : undefined).toBe("v2-prompt-budget");
        const compact = await runRoleMilestoneGeneration(input);
        expect(compact.outcome).toBe("v2-first-pass");
        expect(compact.attempts[0]!.promptBytes).toBeLessThanOrEqual(23500);
        expect(compact.trace.invocations).toBe(1);
        expect(
            Buffer.byteLength(
                JSON.stringify(compact.trace.promptMessages.map(message => message.content))
            )
        ).toBe(compact.attempts[0]!.promptBytes);
        expect(input.envelope.v1Input.data.currentEvidence.length).toBeGreaterThan(2);
        const actual = await runRoleMilestoneGeneration(await fixture(ids[0]!));
        expect(actual.outcome).toBe("v2-first-pass");
        expect(actual.trace.transportProfile).toBe("role-pair-m2");
        expect(actual.attempts[0]!.promptBytes).toBeLessThanOrEqual(23500);
        expect(
            Buffer.byteLength(
                JSON.stringify(actual.trace.promptMessages.map(message => message.content))
            )
        ).toBe(actual.attempts[0]!.promptBytes);
    });
    it("runs under an external-fetch denial sentinel", async () => {
        const denied = vi.fn(() => {
            throw new Error("External fetch forbidden");
        });
        vi.stubGlobal("fetch", denied);
        try {
            expect((await runRoleMilestoneGeneration(await fixture(ids[0]!))).outcome).toBe(
                "v2-first-pass"
            );
            expect(denied).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
        }
    });
});
