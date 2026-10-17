/**
 * Shared bits for `/api/vantage/*`: the workspace context in the shape the
 * service wants, JSON helpers, and the error mapping. `VantageError` carries
 * its own status and code; anything else is a 500 with a log line.
 */
import { type NextResponse } from "next/server";

import { VantageError } from "@launchstack/pipelines/vantage";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import type { Permission } from "~/lib/authz/permissions";
import { error, json } from "~/server/distribution/http";
import { canUseVantage, VANTAGE_FOUNDER_ONLY } from "~/server/vantage/access";

export { error, json };

export interface VantageCtx {
    companyId: bigint;
    userId: string;
    can: (permission: Permission) => boolean;
}

export async function vantageContext(): Promise<
    { ok: true; ctx: VantageCtx } | { ok: false; response: NextResponse }
> {
    const result = await requireWorkspaceContext();
    if (!result.success) return { ok: false, response: result.response };
    if (!canUseVantage(result.data)) {
        return {
            ok: false,
            response: error(VANTAGE_FOUNDER_ONLY, 403, { code: "pilot_access_denied" }),
        };
    }
    return {
        ok: true,
        ctx: {
            companyId: result.data.companyId,
            userId: result.data.authUserId,
            can: permission => result.data.can(permission),
        },
    };
}

export function handleVantageError(scope: string, err: unknown): NextResponse {
    if (err instanceof VantageError) return error(err.message, err.status, { code: err.code });
    // Database/provider errors can contain SQL parameters or source bodies.
    // Keep those objects out of logs and return a stable public message.
    console.error(`[vantage] ${scope} failed unexpectedly.`);
    return error("Internal server error", 500);
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
    let parsed: unknown;
    try {
        parsed = await request.json();
    } catch {
        throw new VantageError("Provide a valid JSON object.", 400, "validation_error");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new VantageError("Provide a valid JSON object.", 400, "validation_error");
    return parsed as Record<string, unknown>;
}

/** A Zod failure as one sentence the form can show next to the control. */
export function firstIssue(issues: { path: (string | number)[]; message: string }[]): string {
    const issue = issues[0];
    if (!issue) return "Check the form and try again.";
    const field = issue.path.join(".");
    return field ? `${field}: ${issue.message}` : issue.message;
}
