/**
 * What the v2 engine runs on in this app: the Postgres store with the
 * workspace ledger behind its holds, the scenario model over
 * `@launchstack/llm`, and the access recheck every unit starts with.
 *
 * The stages are the generation pipeline (pipelines/src/scenarios/v2/stages);
 * they read sources through the v2 collector and the graph service when one
 * is configured.
 */
import { createLlmSimulationModel, type ScenarioRunRecord } from "@launchstack/pipelines/scenarios";
import { createV2Store, sourceManifestDocumentIds } from "@launchstack/pipelines/scenarios/v2/db";
import { V2_STAGES } from "@launchstack/pipelines/scenarios/v2/stages";
import { AccessRevokedError, type EngineDeps } from "@launchstack/pipelines/scenarios/v2/engine";

import { resolveMemberContext } from "~/lib/require-workspace-context";
import { visibleDocumentIds } from "~/server/scenarios/evidence";
import { readScenariosConcurrency } from "~/server/scenarios/executor";

import { createAppScenarioCredits } from "./credits";
import { scenarioGraphPort } from "./graph";
import { collectScenarioSources } from "./sources";

/**
 * Recheck, before every unit, that the run's creator is still an active
 * member and can still open every file the run reads: the files they picked
 * and, once the sources unit has committed, every file behind its captured
 * evidence. The thrown message stays in logs; the run shows a generic one.
 */
export async function authorizeScenarioRun(run: ScenarioRunRecord): Promise<void> {
    const member = await resolveMemberContext(run.createdByUserId, run.companyId);
    if (!member) throw new AccessRevokedError("The run's creator is no longer an active member");
    const captured = (await sourceManifestDocumentIds(run.id, run.generation)) ?? [];
    const needed = [...new Set([...run.sources.documentIds, ...captured])];
    if (needed.length === 0) return;
    const scope = await member.documentScope();
    const visible = await visibleDocumentIds(run.companyId, scope, needed);
    const missing = needed.filter(id => !visible.has(id));
    if (missing.length > 0)
        throw new AccessRevokedError(
            `The run's creator can no longer open ${missing.length} file(s)`
        );
}

const log = (message: string, meta?: Record<string, unknown>) =>
    console.warn(`[scenarios:v2] ${message}`, meta ?? {});

export function createEngineDeps(overrides: Partial<EngineDeps> = {}): EngineDeps {
    const now = () => new Date();
    return {
        store: createV2Store({ credits: createAppScenarioCredits(), log }),
        model: createLlmSimulationModel(),
        stages: V2_STAGES,
        stagePorts: {
            collectSources: collectScenarioSources,
            graph: scenarioGraphPort(),
            now,
            log,
        },
        authorize: authorizeScenarioRun,
        now,
        log,
        concurrency: readScenariosConcurrency(),
        ...overrides,
    };
}
