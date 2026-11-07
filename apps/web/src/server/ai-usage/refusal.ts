/**
 * Answering "you're at your AI allowance" before any work starts.
 *
 * withWorkspaceChatModels already refuses inside the scope — every model
 * resolution throws — so nothing that forgets this check can run past a
 * limit. Routes call it anyway, first thing, so the person gets a 429 with a
 * sentence instead of whatever the feature's generic failure says, and so a
 * route that starts a background run refuses before queuing it.
 */

import { NextResponse } from "next/server";

import type { Locale } from "~/i18n/locales";
import { loadAiAllowance } from "~/server/workspace-models/scope";

import { AiAllowanceExceededError } from "./errors";
import type { AiAllowance } from "./quota";
import { describeAllowanceReached } from "./words";

export { describeAllowanceReached };

/** The body a refused request answers with. `error` and `message` carry the same sentence. */
export interface AiAllowanceRefusal {
    success: false;
    code: "ai_allowance_reached";
    error: string;
    message: string;
    allowance: AiAllowance;
}

export function allowanceRefusalBody(allowance: AiAllowance, locale: Locale): AiAllowanceRefusal {
    const message = describeAllowanceReached(allowance, locale);
    return { success: false, code: "ai_allowance_reached", error: message, message, allowance };
}

/**
 * A 429 when `userId` is at an AI limit in the workspace, else null. A failed
 * read answers null: see allowanceError in withWorkspaceChatModels.
 */
export async function refuseAtAiAllowance(
    companyId: bigint | number | string,
    userId: string | null | undefined,
    locale: Locale
): Promise<NextResponse<AiAllowanceRefusal> | null> {
    if (!userId) return null;
    let allowance: AiAllowance;
    try {
        allowance = await loadAiAllowance(companyId, userId);
    } catch (error) {
        console.warn(
            `[ai-usage] could not read the AI allowance of ${userId}; letting the request run:`,
            error instanceof Error ? error.message : error
        );
        return null;
    }
    if (!allowance.blocked) return null;
    return NextResponse.json(allowanceRefusalBody(allowance, locale), { status: 429 });
}

/**
 * For services that start work: throw {@link AiAllowanceExceededError} when
 * `userId` is at an AI limit. The shared route error handlers answer it with
 * the same 429 as {@link refuseAtAiAllowance}. A failed read lets it run.
 */
export async function assertWithinAiAllowance(
    companyId: bigint | number | string,
    userId: string | null | undefined
): Promise<void> {
    if (!userId) return;
    let allowance: AiAllowance;
    try {
        allowance = await loadAiAllowance(companyId, userId);
    } catch (error) {
        console.warn(
            `[ai-usage] could not read the AI allowance of ${userId}; letting the work run:`,
            error instanceof Error ? error.message : error
        );
        return;
    }
    if (allowance.blocked) throw new AiAllowanceExceededError(allowance);
}
