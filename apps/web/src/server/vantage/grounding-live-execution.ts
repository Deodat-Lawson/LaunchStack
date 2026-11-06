/** Dormant real-provider adapter. Approval and all current bindings precede credential access. */
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { M3RequestBudget } from "../../../../../pipelines/src/vantage/evaluation-live/m3-request-budget";
import {
    m3ConfigurationHash,
    m3InputHash,
    M3_PROMPT_SCHEMA_HASH,
    M3_JUDGE_RUBRIC_HASH,
    M3_JUDGE_BUILDER_HASH,
    type M3GroundingOptions,
} from "../../../../../pipelines/src/vantage/experiments/live-grounding-m3";
import {
    assertM3ModelSettings,
    hydrateM3ModelSettings,
    type SerializedM3ModelSettings,
    type M3ModelSettings,
} from "../../../../../pipelines/src/vantage/experiments/live-grounding-m3-transport";
import { fingerprint } from "../../../../../pipelines/src/vantage/validation/input";
import { VantageError } from "@launchstack/pipelines/vantage";
import type { PreparedContextualReport } from "./contextual-host";
export interface GroundingLiveConfiguration {
    version: "vantage-m3-live-runtime/v1";
    project: "vantage-grounding-m3-20261106";
    planHash: string;
    implementationHash: string;
    generation: M3ModelSettings;
    judge: M3ModelSettings;
    pricing: { status: "verified"; evidenceHash: string };
    credentials: { generation: "VANTAGE_M3_GENERATION_API_KEY"; judge: "VANTAGE_M3_JUDGE_API_KEY" };
}
export type GroundingLiveWireConfiguration = Omit<
    GroundingLiveConfiguration,
    "generation" | "judge"
> & { generation: SerializedM3ModelSettings; judge: SerializedM3ModelSettings };
/** Strict credential-free wire boundary. Runtime Maps are reconstructed before any plan check. */
export function parseGroundingLiveConfiguration(raw: unknown): GroundingLiveConfiguration {
    const hash = z.string().regex(/^[a-f0-9]{64}$/);
    const wire = z
        .object({
            version: z.literal("vantage-m3-live-runtime/v1"),
            project: z.literal("vantage-grounding-m3-20261106"),
            planHash: hash,
            implementationHash: hash,
            generation: z.unknown(),
            judge: z.unknown(),
            pricing: z.object({ status: z.literal("verified"), evidenceHash: hash }).strict(),
            credentials: z
                .object({
                    generation: z.literal("VANTAGE_M3_GENERATION_API_KEY"),
                    judge: z.literal("VANTAGE_M3_JUDGE_API_KEY"),
                })
                .strict(),
        })
        .strict()
        .parse(raw);
    return {
        ...wire,
        generation: hydrateM3ModelSettings(wire.generation, "m3-live-unbound-no-credential"),
        judge: hydrateM3ModelSettings(wire.judge, "m3-live-unbound-no-credential"),
    };
}
function deny(): never {
    throw new VantageError(
        "Live grounding requires matching explicit approval and verified current configuration.",
        409,
        "grounding_live_not_approved"
    );
}
export async function resolveApprovedGroundingLive(input: {
    prepared: PreparedContextualReport;
    configuration: GroundingLiveConfiguration;
    implementationHash: string;
    budget: M3RequestBudget;
    assertAuthorized: (snapshot: Awaited<ReturnType<M3RequestBudget["snapshot"]>>) => void;
    readCredential: (name: string) => string | undefined;
    fetch: typeof globalThis.fetch;
}): Promise<M3GroundingOptions> {
    const c = input.configuration;
    if (
        c.version !== "vantage-m3-live-runtime/v1" ||
        c.project !== "vantage-grounding-m3-20261106" ||
        c.implementationHash !== input.implementationHash ||
        c.pricing.status !== "verified" ||
        !/^[a-f0-9]{64}$/.test(c.pricing.evidenceHash) ||
        c.credentials.generation !== "VANTAGE_M3_GENERATION_API_KEY" ||
        c.credentials.judge !== "VANTAGE_M3_JUDGE_API_KEY"
    )
        deny();
    if (
        c.generation.config.endpoint.apiKey !== "m3-live-unbound-no-credential" ||
        c.judge.config.endpoint.apiKey !== "m3-live-unbound-no-credential"
    )
        deny();
    assertM3ModelSettings(c.generation, "live");
    assertM3ModelSettings(c.judge, "live");
    if (c.generation.identity.family === c.judge.identity.family) deny();
    const configHash = m3ConfigurationHash({
            mode: "live",
            generation: c.generation,
            judge: c.judge,
            implementationHash: input.implementationHash,
            pricing: c.pricing,
        }),
        snapshot = await input.budget.snapshot();
    input.assertAuthorized(snapshot);
    const approval = snapshot.approvalManifest;
    if (
        !approval ||
        typeof approval !== "object" ||
        !("expectedBaseline" in approval) ||
        !isDeepStrictEqual(approval.expectedBaseline, input.prepared.baseline)
    )
        deny();
    const b = snapshot.plan.bindings;
    if (
        snapshot.budgetKey !== "finance-live-pilot" ||
        snapshot.plan.mode !== "live" ||
        snapshot.planHash !== c.planHash ||
        snapshot.reserved !== 0 ||
        snapshot.requests.length !== 0 ||
        b.inputHash !== m3InputHash(input.prepared.envelope, input.prepared.roleContext) ||
        b.sourceFreezeHash !== fingerprint(input.prepared.envelope.freeze) ||
        b.configHash !== configHash ||
        b.implementationHash !== input.implementationHash ||
        b.promptSchemaHash !== M3_PROMPT_SCHEMA_HASH ||
        b.judgeRubricHash !== M3_JUDGE_RUBRIC_HASH ||
        b.judgeBuilderHash !== M3_JUDGE_BUILDER_HASH
    )
        deny();
    for (const kind of ["generation", "judge"] as const) {
        const expected = snapshot.plan.models[kind],
            actual = c[kind].identity;
        if (
            expected.modelConfigHash !== actual.modelConfigHash ||
            expected.endpointHash !== actual.endpointHash ||
            expected.wireModelId !== actual.wireModelId ||
            expected.family !== actual.family
        )
            deny();
    }
    // This is the first credential access. No values enter manifests, hashes or diagnostics.
    const generationKey = input.readCredential(c.credentials.generation),
        judgeKey = input.readCredential(c.credentials.judge);
    if (!generationKey || !judgeKey) deny();
    const bind = (settings: M3ModelSettings, key: string): M3ModelSettings => ({
        ...settings,
        config: { ...settings.config, endpoint: { ...settings.config.endpoint, apiKey: key } },
    });
    return {
        mode: "live",
        generation: bind(c.generation, generationKey),
        judge: bind(c.judge, judgeKey),
        planHash: c.planHash,
        configHash,
        implementationHash: input.implementationHash,
        budget: input.budget,
        pricing: c.pricing,
        adapter: { kind: "live-fetch", fetch: input.fetch },
    };
}
