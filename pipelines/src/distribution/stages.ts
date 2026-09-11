/**
 * The relationship stage machine (design §4.3 "Stages"): one table of
 * allowed moves and the fields each stage requires. Pure — the db layer
 * applies it and writes the event; the route reports its errors.
 */
import type { RelationshipStage } from "./types";
import { RELATIONSHIP_STAGES, TERMINAL_STAGES } from "./types";

const FORWARD: RelationshipStage[] = [
    "candidate",
    "researched",
    "contacted",
    "in_conversation",
    "qualified",
    "negotiating",
    "contracted",
    "active",
];

const ORDER = new Map<RelationshipStage, number>(FORWARD.map((stage, i) => [stage, i]));

/** Moves allowed from each stage. Side-exits are allowed from any live stage. */
export const ALLOWED_TRANSITIONS: Readonly<
    Record<RelationshipStage, readonly RelationshipStage[]>
> = {
    candidate: ["researched", "contacted", "declined", "dormant"],
    researched: ["contacted", "candidate", "declined", "dormant"],
    contacted: ["in_conversation", "researched", "declined", "dormant"],
    in_conversation: ["qualified", "contacted", "declined", "dormant"],
    qualified: ["negotiating", "in_conversation", "declined", "dormant"],
    negotiating: ["contracted", "qualified", "declined", "dormant"],
    contracted: ["active", "negotiating", "dormant"],
    active: ["dormant", "negotiating"],
    declined: ["candidate", "researched"],
    dormant: ["candidate", "contacted", "in_conversation", "qualified", "active"],
};

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
export function stageRequirements(
    target: RelationshipStage,
    context: StageRequirementContext
): StageRequirementError[] {
    const errors: StageRequirementError[] = [];
    const rank = ORDER.get(target);
    if (rank === undefined) return errors; // side-exits require nothing
    if (rank >= ORDER.get("contacted")! && !context.ownerUserId) {
        errors.push({
            code: "owner_required",
            message: `An owner is required from "contacted" onward (entering "${target}").`,
        });
    }
    if (
        rank >= ORDER.get("in_conversation")! &&
        rank < ORDER.get("contracted")! &&
        !context.nextAction
    ) {
        errors.push({
            code: "next_action_required",
            message: `A next action is required from "in_conversation" onward (entering "${target}").`,
        });
    }
    if (rank >= ORDER.get("contracted")! && !context.hasAgreement) {
        errors.push({
            code: "agreement_required",
            message: `An agreement is required to enter "${target}".`,
        });
    }
    return errors;
}

export class StageTransitionError extends Error {
    readonly code: string;
    readonly status = 409;
    constructor(code: string, message: string) {
        super(message);
        this.name = "StageTransitionError";
        this.code = code;
    }
}

export interface TransitionRequest {
    from: RelationshipStage;
    to: RelationshipStage;
    context: StageRequirementContext;
}

/** Throws StageTransitionError when the move is not allowed or the target's requirements are unmet. */
export function assertTransition(request: TransitionRequest): void {
    const { from, to, context } = request;
    if (!RELATIONSHIP_STAGES.includes(to)) {
        throw new StageTransitionError("unknown_stage", `Unknown stage "${to}".`);
    }
    if (from === to) {
        throw new StageTransitionError("same_stage", `Relationship is already "${to}".`);
    }
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
        throw new StageTransitionError(
            "transition_not_allowed",
            `Cannot move from "${from}" to "${to}". Allowed: ${ALLOWED_TRANSITIONS[from].join(", ")}.`
        );
    }
    const missing = stageRequirements(to, context);
    if (missing.length > 0) {
        throw new StageTransitionError(missing[0]!.code, missing.map(m => m.message).join(" "));
    }
}

export function isTerminalStage(stage: RelationshipStage): boolean {
    return TERMINAL_STAGES.has(stage);
}

export function isPastCandidate(stage: RelationshipStage): boolean {
    const rank = ORDER.get(stage);
    return rank !== undefined && rank >= ORDER.get("contacted")!;
}

/** Stages that count as "in pipeline" for the dashboard: past candidate and not terminal. */
export function isInPipeline(stage: RelationshipStage): boolean {
    return stage !== "candidate" && stage !== "researched" && !TERMINAL_STAGES.has(stage);
}

export const STAGE_ORDER = FORWARD;

/** Default days without activity before a live relationship counts as stale. */
export const STALE_AFTER_DAYS: Readonly<Record<RelationshipStage, number | null>> = {
    candidate: null,
    researched: null,
    contacted: 14,
    in_conversation: 14,
    qualified: 21,
    negotiating: 21,
    contracted: 45,
    active: 90,
    declined: null,
    dormant: null,
};
