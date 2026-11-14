/**
 * Where a v2 run is, for progress labels: the stage of its next unfinished
 * unit. v1 runs keep `stageOf` (step-based) in ../types.
 */
import type { ScenarioStage, ScenarioStatus } from "../types";
import type { UnitKind } from "./contracts";

const STAGE_OF_UNIT: Record<UnitKind, ScenarioStage> = {
    sources: "gathering",
    brief: "gathering",
    ontology: "grounding",
    graph_prepare: "grounding",
    graph_ingest: "grounding",
    graph_freeze: "grounding",
    cast_plan: "casting",
    actor_context: "casting",
    cast_batch: "casting",
    world_freeze: "casting",
    round: "simulating",
    report: "reporting",
};

export function stageOfV2(status: ScenarioStatus, nextUnit: UnitKind | null): ScenarioStage {
    if (status === "done") return "done";
    if (!nextUnit) return status === "queued" ? "gathering" : "reporting";
    return STAGE_OF_UNIT[nextUnit];
}
