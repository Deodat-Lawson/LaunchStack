import { RELATIONSHIP_STAGES, TERMINAL_STAGES } from "./types.js";
const FORWARD = [
    "candidate",
    "researched",
    "contacted",
    "in_conversation",
    "qualified",
    "negotiating",
    "contracted",
    "active",
];
const ORDER = new Map(FORWARD.map((stage, i) => [stage, i]));
/** Moves allowed from each stage. Side-exits are allowed from any live stage. */
export const ALLOWED_TRANSITIONS = {
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
/** Fields a relationship must carry to *enter* a stage. */
export function stageRequirements(target, context) {
    const errors = [];
    const rank = ORDER.get(target);
    if (rank === undefined)
        return errors; // side-exits require nothing
    if (rank >= ORDER.get("contacted") && !context.ownerUserId) {
        errors.push({
            code: "owner_required",
            message: `An owner is required from "contacted" onward (entering "${target}").`,
        });
    }
    if (rank >= ORDER.get("in_conversation") &&
        rank < ORDER.get("contracted") &&
        !context.nextAction) {
        errors.push({
            code: "next_action_required",
            message: `A next action is required from "in_conversation" onward (entering "${target}").`,
        });
    }
    if (rank >= ORDER.get("contracted") && !context.hasAgreement) {
        errors.push({
            code: "agreement_required",
            message: `An agreement is required to enter "${target}".`,
        });
    }
    return errors;
}
export class StageTransitionError extends Error {
    code;
    status = 409;
    constructor(code, message) {
        super(message);
        this.name = "StageTransitionError";
        this.code = code;
    }
}
/** Throws StageTransitionError when the move is not allowed or the target's requirements are unmet. */
export function assertTransition(request) {
    const { from, to, context } = request;
    if (!RELATIONSHIP_STAGES.includes(to)) {
        throw new StageTransitionError("unknown_stage", `Unknown stage "${to}".`);
    }
    if (from === to) {
        throw new StageTransitionError("same_stage", `Relationship is already "${to}".`);
    }
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
        throw new StageTransitionError("transition_not_allowed", `Cannot move from "${from}" to "${to}". Allowed: ${ALLOWED_TRANSITIONS[from].join(", ")}.`);
    }
    const missing = stageRequirements(to, context);
    if (missing.length > 0) {
        throw new StageTransitionError(missing[0].code, missing.map(m => m.message).join(" "));
    }
}
export function isTerminalStage(stage) {
    return TERMINAL_STAGES.has(stage);
}
export function isPastCandidate(stage) {
    const rank = ORDER.get(stage);
    return rank !== undefined && rank >= ORDER.get("contacted");
}
/** Stages that count as "in pipeline" for the dashboard: past candidate and not terminal. */
export function isInPipeline(stage) {
    return stage !== "candidate" && stage !== "researched" && !TERMINAL_STAGES.has(stage);
}
export const STAGE_ORDER = FORWARD;
/** Default days without activity before a live relationship counts as stale. */
export const STALE_AFTER_DAYS = {
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
//# sourceMappingURL=stages.js.map