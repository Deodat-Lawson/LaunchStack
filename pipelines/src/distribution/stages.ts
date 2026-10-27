/**
 * The deal stage machine (design §4.3 "Stages"): one table of allowed moves
 * and the fields each stage requires. Pure — the db layer applies it and
 * writes the event and the stage history; the route reports its errors.
 *
 * Forward is lead → qualified → contacted → meeting → proposal →
 * negotiating → won, one step at a time, with two shortcuts a real sales
 * motion takes: a lead may be contacted before anyone formally qualifies it,
 * and an accepted proposal may close without a negotiation. Every live stage
 * may step back one and may leave for lost or nurture.
 */
import type { RelationshipStage } from "./types";
import { RELATIONSHIP_STAGES, TERMINAL_STAGES } from "./types";

const FORWARD: RelationshipStage[] = [
    "lead",
    "qualified",
    "contacted",
    "meeting",
    "proposal",
    "negotiating",
    "won",
];

const ORDER = new Map<RelationshipStage, number>(FORWARD.map((stage, i) => [stage, i]));

/** Moves allowed from each stage. Side-exits are allowed from any live stage. */
export const ALLOWED_TRANSITIONS: Readonly<
    Record<RelationshipStage, readonly RelationshipStage[]>
> = {
    lead: ["qualified", "contacted", "lost", "nurture"],
    qualified: ["contacted", "lead", "lost", "nurture"],
    contacted: ["meeting", "qualified", "lost", "nurture"],
    meeting: ["proposal", "contacted", "lost", "nurture"],
    proposal: ["negotiating", "won", "meeting", "lost", "nurture"],
    negotiating: ["won", "proposal", "lost", "nurture"],
    won: ["nurture", "negotiating"],
    lost: ["lead", "qualified"],
    nurture: ["lead", "contacted", "meeting", "proposal", "won"],
};

export interface StageRequirementContext {
    ownerUserId: string | null;
    nextAction: string | null;
    hasAgreement: boolean;
}

export type StageRequirementCode = "owner_required" | "next_action_required" | "agreement_required";

export interface StageRequirementError {
    code: StageRequirementCode;
    /** The stage being entered; with `code`, what a reader's language words the message from. */
    target: RelationshipStage;
    message: string;
}

/** Fields a deal must carry to *enter* a stage. */
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
            target,
            message: `An owner is required from "contacted" onward (entering "${target}").`,
        });
    }
    if (rank >= ORDER.get("meeting")! && rank < ORDER.get("won")! && !context.nextAction) {
        errors.push({
            code: "next_action_required",
            target,
            message: `A next action is required from "meeting" onward (entering "${target}").`,
        });
    }
    if (rank >= ORDER.get("won")! && !context.hasAgreement) {
        errors.push({
            code: "agreement_required",
            target,
            message: `An agreement is required to enter "${target}".`,
        });
    }
    return errors;
}

/**
 * What a refused move was, as values beside the English `message`, so the app
 * can say it in the reader's language: the stages involved, the moves that
 * were allowed, and every requirement the target stage is missing.
 */
export interface StageTransitionDetails {
    from?: RelationshipStage;
    to: string;
    allowed?: readonly RelationshipStage[];
    missing?: StageRequirementError[];
}

export class StageTransitionError extends Error {
    readonly code: string;
    readonly status = 409;
    readonly details: StageTransitionDetails | null;
    constructor(code: string, message: string, details: StageTransitionDetails | null = null) {
        super(message);
        this.name = "StageTransitionError";
        this.code = code;
        this.details = details;
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
        throw new StageTransitionError("unknown_stage", `Unknown stage "${to}".`, { from, to });
    }
    if (from === to) {
        throw new StageTransitionError("same_stage", `Relationship is already "${to}".`, {
            from,
            to,
        });
    }
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
        throw new StageTransitionError(
            "transition_not_allowed",
            `Cannot move from "${from}" to "${to}". Allowed: ${ALLOWED_TRANSITIONS[from].join(", ")}.`,
            { from, to, allowed: ALLOWED_TRANSITIONS[from] }
        );
    }
    const missing = stageRequirements(to, context);
    if (missing.length > 0) {
        throw new StageTransitionError(missing[0]!.code, missing.map(m => m.message).join(" "), {
            from,
            to,
            missing,
        });
    }
}

export function isTerminalStage(stage: RelationshipStage): boolean {
    return TERMINAL_STAGES.has(stage);
}

/** Someone has reached out: the company is engaged and discovery must not propose it again. */
export function isPastCandidate(stage: RelationshipStage): boolean {
    const rank = ORDER.get(stage);
    return rank !== undefined && rank >= ORDER.get("contacted")!;
}

/** Stages that count as "in pipeline" for the dashboard: past lead and not terminal. */
export function isInPipeline(stage: RelationshipStage): boolean {
    return stage !== "lead" && !TERMINAL_STAGES.has(stage);
}

/** Being worked right now: outreach sent, not yet closed. */
export const IN_MOTION_STAGES: readonly RelationshipStage[] = [
    "contacted",
    "meeting",
    "proposal",
    "negotiating",
];

export const STAGE_ORDER = FORWARD;

/** Default days without activity before a live deal counts as stale. */
export const STALE_AFTER_DAYS: Readonly<Record<RelationshipStage, number | null>> = {
    lead: null,
    qualified: 14,
    contacted: 14,
    meeting: 14,
    proposal: 21,
    negotiating: 21,
    won: 90,
    lost: null,
    nurture: null,
};
