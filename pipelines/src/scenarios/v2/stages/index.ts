/**
 * The generation stages of a v2 run, one per unit kind. The durable engine
 * (`../engine.ts`) leases a unit, builds its StageContext and commits what
 * the stage returns; see `../stage.ts` for the seam.
 *
 *   sources → brief → [ontology → graph:prepare → graph:ingest:NN → graph:freeze]
 *     → cast:plan → actor-context:NN → cast:batch:NN → world:freeze
 *     → round:NN … → report
 */
import type { UnitKind } from "../contracts";
import type { Stage } from "../stage";
import { actorContextStage } from "./actor-context";
import { briefStage } from "./brief";
import { castBatchStage } from "./cast-batch";
import { castPlanStage } from "./cast-plan";
import { graphFreezeStage, graphIngestStage, graphPrepareStage } from "./graph";
import { ontologyStage } from "./ontology";
import { reportStage } from "./report";
import { roundStage } from "./round";
import { sourcesStage } from "./sources";
import { worldFreezeStage } from "./world";

export const V2_STAGES: Record<UnitKind, Stage> = {
    sources: sourcesStage,
    brief: briefStage,
    ontology: ontologyStage,
    graph_prepare: graphPrepareStage,
    graph_ingest: graphIngestStage,
    graph_freeze: graphFreezeStage,
    cast_plan: castPlanStage,
    actor_context: actorContextStage,
    cast_batch: castBatchStage,
    world_freeze: worldFreezeStage,
    round: roundStage,
    report: reportStage,
};

export {
    actorContextStage,
    briefStage,
    castBatchStage,
    castPlanStage,
    graphFreezeStage,
    graphIngestStage,
    graphPrepareStage,
    ontologyStage,
    reportStage,
    roundStage,
    sourcesStage,
    worldFreezeStage,
};
export { finalizeManifest, rankSections, omittedSourceCount } from "./sources";
export { validateOntology, type OntologyValidation } from "./ontology";
export { freezeGraph, graphIdentity, episodeFor, type GraphIdentity } from "./graph";
export { stanceTargets, parseCastPlan } from "./cast-plan";
export {
    buildActorContext,
    supportedHits,
    PASSAGE_MAX_TOKENS,
    MAX_CONTEXT_FACTS,
    GRAPH_SEARCH_LIMIT,
    type ActorContextInput,
} from "./actor-context";
export { validateMember, parseCastBatch, knownFacts, type MemberValidation } from "./cast-batch";
export { seatCast, MIN_CAST } from "./world";
export { recordingModel, turnsInAgentOrder, agentForRequest } from "./round";
export {
    buildOntologyRequest,
    buildCastPlanRequest,
    buildCastBatchRequest,
    buildCastRepairRequest,
    ONTOLOGY_SCHEMA,
    CAST_PLAN_SCHEMA,
    CAST_V2_SCHEMA,
} from "./prompts";
export {
    episodeUuid,
    graphBuildKey,
    graphGroupId,
    SCENARIO_AUDIENCE,
    toStoredEvidence,
} from "./common";
export { replayRun } from "../replay";
