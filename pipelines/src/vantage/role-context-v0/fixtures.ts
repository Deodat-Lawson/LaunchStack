import { z } from "zod";
/** Synthetic fixtures only. This store is not a production persistence adapter. */
import type { ContextActorRequestV0 } from "../context-v0/ports";
import type { ContextScopeV0, ContextSourceEntryV0 } from "../proposals/context-v0";
import {
    emptyPersonalContextV0,
    type PersonalContextDependenciesV0,
    type PersonalContextStateV0,
    type PersonalContextStoreV0,
} from "./contracts";
import { createPersonalContextProviderV0 } from "./provider";

export function createMemoryPersonalContextStoreV0(
    seed: PersonalContextStateV0[] = []
): PersonalContextStoreV0 & { snapshot(): PersonalContextStateV0[] } {
    const key = (actor: Pick<ContextScopeV0, "companyId" | "principalRef">) =>
        JSON.stringify([actor.companyId, actor.principalRef, "vantage"]);
    const states = new Map(
        seed
            .filter(s => s.version === "joseph-personal-context-v0" && s.module === "vantage")
            .map(state => [key(state), structuredClone(state)])
    );
    return {
        async read(actor) {
            return structuredClone(states.get(key(actor)) ?? emptyPersonalContextV0(actor));
        },
        async compareAndSwap(actor, expectedRevision, next) {
            if (
                next.companyId !== actor.companyId ||
                next.principalRef !== actor.principalRef ||
                next.module !== "vantage" ||
                next.revision !== expectedRevision + 1 ||
                (states.get(key(actor))?.revision ?? 0) !== expectedRevision
            )
                return false;
            states.set(key(actor), structuredClone(next));
            return true;
        },
        snapshot() {
            return structuredClone([...states.values()]);
        },
    };
}
export const fixtureRequestV0: ContextActorRequestV0 = {
    principalRef: "fixture-joseph",
    companyId: "fixture-company",
    reportWindow: {
        startInclusive: "2026-10-19",
        endExclusive: "2026-10-25T20:00:00Z",
        asOf: "2026-10-25T20:00:00Z",
    },
    budgets: {
        maxSources: 20,
        maxExcerptChars: 12000,
        timeoutMs: 2000,
        maxQueries: 0,
        maxTokens: 4000,
    },
};
export const fixtureDocumentsV0 = [
    {
        id: "101",
        title: "Engineering operating constraints",
        version: "7",
        date: "2026-01-15T12:00:00Z",
        excerpt: "Every release requires a rollback plan and an owner. Unchanged since January.",
        constraints: ["Every release requires a rollback plan and an owner."],
    },
    {
        id: "102",
        title: "Customer discovery notes",
        version: "3",
        date: "2026-10-20T12:00:00Z",
        excerpt:
            "Synthetic interviews identified onboarding friction. Three follow-up interviews are planned.",
        constraints: [],
    },
];
export function createPersonalContextFixtureV0(seed: PersonalContextStateV0[] = []) {
    const store = createMemoryPersonalContextStoreV0(seed);
    const controls = {
        architectureMissing: false,
        revoked: new Set<string>(),
        missing: new Set<string>(),
    };
    const actor: ContextScopeV0 = {
        principalRef: fixtureRequestV0.principalRef,
        companyId: fixtureRequestV0.companyId,
        audience: { kind: "actor", principalRef: fixtureRequestV0.principalRef },
        aclDigest: "fixture-acl-1",
    };
    const architecture = {
        kind: "company" as const,
        id: "fixture-architecture",
        version: "1",
        companyId: actor.companyId,
        canonical: true as const,
        reviewState: "unknowns-marked" as const,
    };
    function entry(
        source: ContextSourceEntryV0["source"],
        excerpt: string,
        sourceDate: string
    ): ContextSourceEntryV0 {
        return {
            source,
            excerpt,
            sourceDate,
            companyId: actor.companyId,
            aclDigest: actor.aclDigest,
            audience: { kind: "company", companyId: actor.companyId },
            access: "allowed",
            checkedAt: "2026-10-25T20:01:00Z",
            excerptOffsets: { start: 0, end: excerpt.length, sourceVersion: source.version },
        };
    }
    const deps: PersonalContextDependenciesV0 = {
        store,
        async resolveAuthenticatedActor(input) {
            if (input.principalRef !== actor.principalRef || input.companyId !== actor.companyId)
                throw new Error("Fixture actor denied");
            return structuredClone(actor);
        },
        async readProfileTitle() {
            return "Founder + Engineering lead";
        },
        async requiredSources() {
            return {
                companyArchitecture: controls.architectureMissing ? null : architecture,
                workspaceMandatoryDocuments: [],
            };
        },
        async readSource(_actor, ref) {
            if (ref.id !== architecture.id) return { status: "missing" };
            return {
                status: "allowed",
                entry: entry(
                    architecture,
                    "Reviewed synthetic company profile. Product scope is known; funding and staffing are marked unknown.",
                    "2026-10-01T12:00:00Z"
                ),
                constraints: ["Unknown staffing and funding must stay explicit."],
            };
        },
        async readDocument(_actor, id) {
            if (controls.revoked.has(id)) return { status: "revoked" };
            const doc = fixtureDocumentsV0.find(item => item.id === id);
            if (!doc || controls.missing.has(id)) return { status: "missing" };
            return {
                status: "allowed",
                entry: entry({ kind: "doc", id, version: doc.version }, doc.excerpt, doc.date),
                constraints: doc.constraints,
            };
        },
        now: () => "2026-10-25T20:01:00Z",
    };
    return { store, controls, actor, deps, provider: createPersonalContextProviderV0(deps) };
}

const fixtureStateSchema = z.object({
    version: z.literal("joseph-personal-context-v0"),
    companyId: z.literal("fixture-company"),
    principalRef: z.literal("fixture-joseph"),
    module: z.literal("vantage"),
    revision: z.number().int().nonnegative(),
    roles: z
        .object({
            roleIds: z.array(z.string()),
            primaryRoleId: z.string().optional(),
            confirmedAt: z.string().datetime(),
        })
        .nullable(),
    stars: z.array(
        z.object({
            documentId: z.string(),
            lastKnownRef: z.object({ kind: z.literal("doc"), id: z.string(), version: z.string() }),
            starredAt: z.string().datetime(),
            updatedAt: z.string().datetime(),
        })
    ),
});
export function parsePersonalContextFixtureSeedV0(value: unknown): PersonalContextStateV0[] {
    const result = z.array(fixtureStateSchema).safeParse(value);
    return result.success ? result.data : [];
}
