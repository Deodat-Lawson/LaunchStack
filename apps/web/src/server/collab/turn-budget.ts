/**
 * What one meeting turn may spend on the model, reasoning and reply together.
 *
 * Endpoints such as OpenRouter count a model's reasoning against the request's
 * `max_tokens`. A meeting turn used to send no reasoning setting, so the model
 * thought at its own default, and an 800-token cap: the thinking spent most of
 * the cap and turns stopped after a sentence or two, mid-word.
 *
 * A meeting turn is one chat message grounded in the room's context, not a
 * proof, so it asks for the lowest effort the model offers and keeps a cap
 * that leaves room for a full reply on top of it. Pure, so scripts can use the
 * same numbers without the deployment's configuration.
 */

import type { ChatModelBehavior, ReasoningControl } from "@launchstack/llm";

/**
 * Output-token cap for one turn: low-effort reasoning plus a complete reply.
 * Measured on the default model at low effort: reasoning is usually nil but
 * reached 2,559 tokens on an opening turn, and replies ran to ~1,200 tokens.
 * The cap only bounds outliers; a turn is billed for what it uses.
 */
export const MEETING_TURN_MAX_OUTPUT_TOKENS = 4_000;

/**
 * Effort a turn asks of an effort-mode model, in order of preference. Never
 * `none`: some endpoints refuse it for models that always reason.
 */
export const MEETING_TURN_EFFORTS = ["low", "minimal"] as const;

/** Thinking budget for a budget-mode model, clamped to what it accepts. */
export const MEETING_TURN_REASONING_BUDGET = 1_024;

/**
 * The reasoning request for a meeting turn on a model with this behavior, or
 * undefined to leave the model's own setting alone: a toggle model already
 * turns reasoning off when nobody asks for it, and a model that always reasons
 * or never does has nothing to choose.
 */
export function meetingTurnReasoning(behavior: ChatModelBehavior): ReasoningControl | undefined {
    const reasoning = behavior.reasoning;
    if (reasoning.mode === "effort") {
        const effort = MEETING_TURN_EFFORTS.find(level => level in reasoning.levels);
        return effort ? { enabled: true, effort } : undefined;
    }
    if (reasoning.mode === "budget") {
        const budgetTokens = Math.min(
            reasoning.max,
            Math.max(reasoning.min, MEETING_TURN_REASONING_BUDGET)
        );
        return { enabled: true, budgetTokens };
    }
    return undefined;
}
