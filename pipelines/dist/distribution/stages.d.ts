/**
 * The relationship stage machine (design §4.3 "Stages"): one table of
 * allowed moves and the fields each stage requires. Pure — the db layer
 * applies it and writes the event; the route reports its errors.
 */
import type { RelationshipStage } from "./types.js";
/** Moves allowed from each stage. Side-exits are allowed from any live stage. */
export declare const ALLOWED_TRANSITIONS: Readonly<Record<RelationshipStage, readonly RelationshipStage[]>>;
export interface StageRequirementContext {
    ownerUserId: string | null;
    nextAction: string | null;
    hasAgreement: boolean;
}
export type StageRequirementCode = "owner_required" | "next_action_required" | "agreement_required";
export interface StageRequirementError {
    code: StageRequirementCode;
    message: string;
}
/** Fields a relationship must carry to *enter* a stage. */
export declare function stageRequirements(target: RelationshipStage, context: StageRequirementContext): StageRequirementError[];
export declare class StageTransitionError extends Error {
    readonly code: string;
    readonly status = 409;
    constructor(code: string, message: string);
}
export interface TransitionRequest {
    from: RelationshipStage;
    to: RelationshipStage;
    context: StageRequirementContext;
}
/** Throws StageTransitionError when the move is not allowed or the target's requirements are unmet. */
export declare function assertTransition(request: TransitionRequest): void;
export declare function isTerminalStage(stage: RelationshipStage): boolean;
export declare function isPastCandidate(stage: RelationshipStage): boolean;
/** Stages that count as "in pipeline" for the dashboard: past candidate and not terminal. */
export declare function isInPipeline(stage: RelationshipStage): boolean;
export declare const STAGE_ORDER: ("active" | "candidate" | "researched" | "contacted" | "in_conversation" | "qualified" | "negotiating" | "contracted" | "declined" | "dormant")[];
/** Default days without activity before a live relationship counts as stale. */
export declare const STALE_AFTER_DAYS: Readonly<Record<RelationshipStage, number | null>>;
//# sourceMappingURL=stages.d.ts.map