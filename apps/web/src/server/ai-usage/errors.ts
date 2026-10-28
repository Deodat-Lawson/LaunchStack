/**
 * The error a scope refuses with when its person is at an AI limit. Kept
 * apart from ./quota (which reads the database) so error handlers and route
 * helpers can recognise it without loading the meter.
 */

import { ChatScopeUnavailableError } from "@launchstack/llm";

import type { AiAllowance } from "./quota";

/**
 * Thrown by model resolution inside a scope whose person is at a limit. It is
 * a scope error so it fails closed everywhere a model is resolved, and so
 * `describeChatResolutionFailure` can word it for the screen.
 */
export class AiAllowanceExceededError extends ChatScopeUnavailableError {
    override readonly status = 429;
    readonly code = "ai_allowance_reached" as const;

    constructor(readonly allowance: AiAllowance) {
        super(
            allowance.binding === "server"
                ? `This person has used this server's monthly AI allowance; it resets ${allowance.resetsAt}.`
                : `This person has used their AI allowance for this workspace this month; it resets ${allowance.resetsAt}.`
        );
    }
}

export function isAiAllowanceExceededError(error: unknown): error is AiAllowanceExceededError {
    return error instanceof AiAllowanceExceededError;
}
