/** Task-owned offline execution registry. No request can select a provider or budget. */
import inventoryPolicy from "../../../../../scripts/dev/vantage-grounding-live-policy.cjs";
import { readFile, writeFile, realpath } from "node:fs/promises";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import { z } from "zod";
import type { SqlClient } from "@launchstack/store/client";
import { VantageError } from "@launchstack/pipelines/vantage";
import { contextSourceKeyV0 } from "@launchstack/pipelines/vantage/context-v0";
import {
    buildM3OfflinePlan,
    M3_JUDGE_RUBRIC_HASH,
    M3_JUDGE_BUILDER_HASH,
    M3_SCENARIO_ID,
    m3InputHash,
    type M3GroundingOptions,
} from "../../../../../pipelines/src/vantage/experiments/live-grounding-m3";
import {
    assertM3ModelSettings,
    hydrateM3ModelSettings,
} from "../../../../../pipelines/src/vantage/experiments/live-grounding-m3-transport";
import {
    assertM3BudgetAuthorized,
    initializeM3Budget,
    createPgM3RequestBudget,
    M3_PROJECT,
} from "../../../../../pipelines/src/vantage/evaluation-live/m3-request-budget";
import {
    resolveApprovedGroundingLive,
    parseGroundingLiveConfiguration,
} from "./grounding-live-execution";
import type { PreparedContextualReport } from "./contextual-host";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const registrySchema = z
    .object({
        version: z.literal("vantage-m3-offline-runtime/v1"),
        project: z.literal(M3_PROJECT),
        caseKey: z.string().regex(/^offline-[a-z0-9][a-z0-9-]{0,95}$/),
        respondUrl: z.string().url(),
        generation: z.unknown(),
        judge: z.unknown(),
        implementationHash: hash,
        judgeRubricHash: hash,
        judgeBuilderHash: hash,
        inputPath: z.string(),
        variant: z.string(),
    })
    .strict();
function blocked(): never {
    throw new VantageError(
        "Grounding execution is disabled or its trusted plan is incomplete.",
        409,
        "grounding_execution_disabled"
    );
}
async function ownedPath(path: string, root: string) {
    const full = await realpath(path),
        rel = relative(root, full);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) blocked();
    return full;
}
export function createGroundingExecutionResolver(client: SqlClient) {
    return async (prepared: PreparedContextualReport): Promise<M3GroundingOptions> => {
        if (process.env.VANTAGE_GROUNDING_M3_ENABLED !== "true") blocked();
        const root = await realpath(
            resolve(process.cwd(), "../../test-output/vantage-grounding-m3-20261106")
        );
        if (process.env.VANTAGE_GROUNDING_M3_LIVE === "true") {
            const livePath = process.env.VANTAGE_GROUNDING_M3_LIVE_CONFIG;
            if (!livePath) blocked();
            const configuration = parseGroundingLiveConfiguration(
                JSON.parse(await readFile(await ownedPath(livePath, root), "utf8"))
            );
            if (!/^[a-f0-9]{64}$/.test(configuration.planHash)) blocked();
            const budget = createPgM3RequestBudget(client, {
                budgetKey: "finance-live-pilot",
                expectedPlanHash: configuration.planHash,
                mode: "live",
            });
            return resolveApprovedGroundingLive({
                prepared,
                configuration,
                implementationHash: await groundingImplementationHash(),
                budget,
                assertAuthorized: assertM3BudgetAuthorized,
                readCredential: name => process.env[name],
                fetch: globalThis.fetch,
            });
        }
        if (process.env.VANTAGE_GROUNDING_M3_LIVE !== "false") blocked();
        const path = process.env.VANTAGE_GROUNDING_M3_OFFLINE_CONFIG;
        if (!path) blocked();
        const registry = registrySchema.parse(
            JSON.parse(await readFile(await ownedPath(path, root), "utf8"))
        );
        const url = new URL(registry.respondUrl);
        if (
            url.protocol !== "http:" ||
            url.hostname !== "127.0.0.1" ||
            !url.port ||
            url.pathname !== "/respond" ||
            url.username ||
            url.password ||
            url.search ||
            url.hash
        )
            blocked();
        const generation = hydrateM3ModelSettings(
                registry.generation,
                "m3-offline-no-provider-key"
            ),
            judge = hydrateM3ModelSettings(registry.judge, "m3-offline-no-provider-key");
        for (const [kind, settings] of [
            ["generation", generation],
            ["judge", judge],
        ] as const) {
            const endpoint = new URL(settings.config.endpoint.baseUrl);
            if (
                endpoint.origin !== url.origin ||
                endpoint.pathname !== `/${kind}/v1` ||
                endpoint.search ||
                endpoint.hash
            )
                blocked();
        }
        assertM3ModelSettings(generation, "offline");
        assertM3ModelSettings(judge, "offline");
        if (generation.identity.family === judge.identity.family) blocked();
        const inputHash = m3InputHash(prepared.envelope, prepared.roleContext);
        const implementationHash = await groundingImplementationHash();
        if (
            registry.implementationHash !== implementationHash ||
            registry.judgeRubricHash !== M3_JUDGE_RUBRIC_HASH ||
            registry.judgeBuilderHash !== M3_JUDGE_BUILDER_HASH
        )
            blocked();
        const plan = buildM3OfflinePlan(
            {
                envelope: prepared.envelope,
                sourceRefs: prepared.sourceRefs,
                roleContext: prepared.roleContext,
            },
            { generation, judge, implementationHash }
        );
        const configHash = plan.bindings.configHash!;
        const planHash = await initializeM3Budget(client, { budgetKey: registry.caseKey, plan });
        const inputDir = await realpath(dirname(registry.inputPath));
        if (inputDir !== root) blocked();
        await writeFile(
            registry.inputPath,
            JSON.stringify({
                envelope: prepared.envelope,
                sourceRefs: prepared.sourceRefs,
                roleContext: prepared.roleContext,
                nativeSourceBindings: prepared.nativeSourceBindings,
                closedInventory: {
                    scope: "closed-synthetic-scenario",
                    scenarioId: M3_SCENARIO_ID,
                    generationInputFingerprint: inputHash,
                    manifestFingerprint: prepared.envelope.manifest.contextFingerprint,
                    asOf: prepared.envelope.evidenceSnapshot.asOf,
                    researchRequirement: "not-required-for-closed-scenario",
                    sourceContentHashes: Object.fromEntries(
                        prepared.records.map(record => [
                            contextSourceKeyV0(record.source),
                            record.contentHash!,
                        ])
                    ),
                },
            })
        );
        return {
            mode: "offline",
            generation,
            judge,
            planHash,
            configHash,
            implementationHash,
            budget: createPgM3RequestBudget(client, {
                budgetKey: registry.caseKey,
                expectedPlanHash: planHash,
                mode: "offline",
            }),
            pricing: { status: "missing" },
            adapter: { kind: "offline-loopback-fetch", fetch: globalThis.fetch },
        };
    };
}

/** Shared exact source inventory used by the app and future approval CLI. */
export function groundingSourceInventory() {
    return inventoryPolicy.sourceInventory(resolve(process.cwd(), "../.."));
}
export async function groundingImplementationHash() {
    return groundingSourceInventory().inventoryHash;
}
export async function groundingExecutionIdentity() {
    const executionMode =
        process.env.VANTAGE_GROUNDING_M3_LIVE === "true" ? ("live" as const) : ("offline" as const);
    if (executionMode !== "live") return { executionMode, livePlanHash: null };
    try {
        const root = await realpath(
            resolve(process.cwd(), "../../test-output/vantage-grounding-m3-20261106")
        );
        const path = process.env.VANTAGE_GROUNDING_M3_LIVE_CONFIG;
        if (!path) return { executionMode, livePlanHash: null };
        const c = z
            .object({
                version: z.literal("vantage-m3-live-runtime/v1"),
                project: z.literal(M3_PROJECT),
                planHash: hash,
            })
            .passthrough()
            .parse(JSON.parse(await readFile(await ownedPath(path, root), "utf8")));
        return {
            executionMode,
            livePlanHash:
                c.version === "vantage-m3-live-runtime/v1" &&
                c.project === M3_PROJECT &&
                /^[a-f0-9]{64}$/.test(c.planHash)
                    ? c.planHash
                    : null,
        };
    } catch {
        return { executionMode, livePlanHash: null };
    }
}
