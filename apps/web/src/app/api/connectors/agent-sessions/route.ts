/**
 * Agent-sessions connector endpoint.
 *
 * GET  — preview which session transcripts a sync would import (stats only).
 * POST — parse, render and push them through the normal ingestion pipeline.
 *
 * The connector reads this server's filesystem, so both verbs are gated on
 * `AGENT_SESSIONS_CONNECTOR_ENABLED` and on the caller owning the workspace.
 */

import { getServerSession } from "~/server/auth";
import { eq } from "drizzle-orm";
import type { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { env } from "~/env";
import { resolveActiveCompanyForUser } from "~/lib/active-workspace";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import {
    createForbiddenError,
    createUnauthorizedError,
    createValidationError,
    createSuccessResponse,
    handleApiError,
} from "~/lib/api-utils";
import {
    previewAgentSessionsDetailed,
    runAgentSessionsSync,
} from "~/server/services/agent-sessions-connector";
import {
    isAgentSessionsConnectorEnabled,
    isValidProjectSlug,
} from "~/server/services/agent-sessions-policy";

export const runtime = "nodejs";
export const maxDuration = 300;

const TOOLS = ["claude-code", "codex"] as const;

const ProjectSlugSchema = z
    .string()
    .min(1)
    .max(255)
    .refine(isValidProjectSlug, "Not a project directory name.");

const SourceIdSchema = z
    .string()
    .min(1)
    .max(512)
    .refine(id => id.startsWith("agent-sessions://"), "Not an agent-sessions source id.");

const SyncRequestSchema = z.object({
    tools: z.array(z.enum(TOOLS)).min(1).optional(),
    /** Claude Code project slugs (directory names under ~/.claude/projects). */
    projects: z.array(ProjectSlugSchema).optional(),
    /** Import exactly these sessions (ids from a GET preview). */
    sourceIds: z.array(SourceIdSchema).min(1).max(200).optional(),
    includeArchived: z.boolean().optional(),
    force: z.boolean().optional(),
    category: z.string().min(1).max(120).optional(),
    concurrency: z.number().int().min(1).max(16).optional(),
    maxSessions: z.number().int().min(1).max(2000).optional(),
});

interface Caller {
    readonly userId: string;
    readonly companyId: bigint;
}

type CallerResult = { ok: true; caller: Caller } | { ok: false; response: NextResponse };

async function resolveCaller(): Promise<CallerResult> {
    const session = await getServerSession();
    const userId = session?.user.id;
    if (!userId) {
        return { ok: false, response: createUnauthorizedError("Authentication required.") };
    }

    const [userInfo] = await db
        .select({
            id: users.id,
            role: users.role,
            companyId: users.companyId,
            status: users.status,
        })
        .from(users)
        .where(eq(users.userId, userId));

    if (!userInfo) {
        return { ok: false, response: createValidationError("Invalid user.") };
    }
    // Imported sessions land in the shared company knowledge base, so this is
    // a workspace-administration action, not a per-employee one.
    if (userInfo.role !== "employer" && userInfo.role !== "owner") {
        return { ok: false, response: createForbiddenError("Employer access required.") };
    }

    const companyId = await resolveActiveCompanyForUser(
        userInfo.id,
        userInfo.companyId,
        userInfo.status
    );
    // Null means the user holds no membership in the resolved workspace —
    // importing into a company the caller has left would leak their local
    // session transcripts into someone else's knowledge base.
    if (companyId === null) {
        return { ok: false, response: createForbiddenError("No active workspace membership.") };
    }

    return {
        ok: true,
        caller: {
            userId,
            companyId,
        },
    };
}

function disabledResponse(): NextResponse {
    return createForbiddenError(
        "The agent-sessions connector is disabled. Set AGENT_SESSIONS_CONNECTOR_ENABLED=true on the server that hosts your Claude Code / Codex folders."
    );
}

/**
 * "Sync everything with the defaults" is the common call, so an empty body is
 * valid input rather than malformed JSON.
 */
async function parseSyncBody(
    request: Request
): Promise<z.SafeParseReturnType<unknown, z.infer<typeof SyncRequestSchema>> | null> {
    const raw = await request.text();
    if (raw.trim().length === 0) return SyncRequestSchema.safeParse({});
    try {
        return SyncRequestSchema.safeParse(JSON.parse(raw));
    } catch {
        return null;
    }
}

function parseListParam(value: string | null): string[] | undefined {
    if (!value) return undefined;
    const parts = value
        .split(",")
        .map(part => part.trim())
        .filter(part => part.length > 0);
    return parts.length > 0 ? parts : undefined;
}

export async function GET(request: Request) {
    return withRateLimit(request, RateLimitPresets.permissive, async () => {
        try {
            const enabled = isAgentSessionsConnectorEnabled(
                env.server.AGENT_SESSIONS_CONNECTOR_ENABLED
            );
            const callerResult = await resolveCaller();
            if (!callerResult.ok) return callerResult.response;
            if (!enabled) return disabledResponse();

            const { searchParams } = new URL(request.url);
            const projects = parseListParam(searchParams.get("projects"));
            if (projects?.some(slug => !isValidProjectSlug(slug))) {
                return createValidationError("Invalid project slug.");
            }
            const maxSessionsRaw = searchParams.get("maxSessions");
            const maxSessions = maxSessionsRaw ? Number.parseInt(maxSessionsRaw, 10) : undefined;
            if (maxSessions !== undefined && (!Number.isFinite(maxSessions) || maxSessions < 1)) {
                return createValidationError("Invalid maxSessions.");
            }

            const preview = await previewAgentSessionsDetailed(callerResult.caller.companyId, {
                tools: parseListParam(searchParams.get("tools")) as
                    | (typeof TOOLS)[number][]
                    | undefined,
                projects,
                includeArchived: searchParams.get("includeArchived") !== "false",
                maxSessions: maxSessions === undefined ? undefined : Math.min(maxSessions, 2000),
            });

            return createSuccessResponse({
                enabled: true,
                roots: preview.roots,
                truncated: preview.truncated,
                items: preview.items,
                skipped: preview.skipped,
            });
        } catch (error) {
            return handleApiError(error);
        }
    });
}

export async function POST(request: Request) {
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const enabled = isAgentSessionsConnectorEnabled(
                env.server.AGENT_SESSIONS_CONNECTOR_ENABLED
            );
            const callerResult = await resolveCaller();
            if (!callerResult.ok) return callerResult.response;
            if (!enabled) return disabledResponse();

            const parsed = await parseSyncBody(request);
            if (!parsed) return createValidationError("Invalid JSON body.");
            if (!parsed.success) {
                return createValidationError(
                    `Invalid request data: ${parsed.error.errors
                        .map(issue => `${issue.path.join(".")}: ${issue.message}`)
                        .join(", ")}`
                );
            }

            const body = parsed.data;
            const report = await runAgentSessionsSync({
                companyId: callerResult.caller.companyId,
                userId: callerResult.caller.userId,
                tools: body.tools,
                projects: body.projects,
                sourceIds: body.sourceIds,
                includeArchived: body.includeArchived,
                maxSessions: body.maxSessions,
                category: body.category,
                concurrency: body.concurrency,
                force: body.force,
                requestUrl: request.url,
            });

            // A selected id that produced no outcome names a session that no
            // longer exists on this machine — the browser list was stale.
            const seen = new Set([
                ...report.stored.map(entry => entry.sourceId),
                ...report.skipped.map(entry => entry.sourceId),
                ...report.failed.map(entry => entry.sourceId),
            ]);
            const missing = body.sourceIds?.filter(id => !seen.has(id)) ?? [];

            return createSuccessResponse(
                {
                    connectorId: report.connectorId,
                    startedAt: report.startedAt,
                    finishedAt: report.finishedAt,
                    durationMs: report.durationMs,
                    truncated: report.truncated,
                    roots: report.scan.roots,
                    counts: {
                        discovered: report.discovered,
                        stored: report.stored.length,
                        created: report.stored.filter(entry => !entry.revised).length,
                        revised: report.stored.filter(entry => entry.revised).length,
                        skipped: report.skipped.length,
                        failed: report.failed.length,
                    },
                    stored: report.stored,
                    skipped: report.skipped,
                    failed: report.failed,
                    missing,
                },
                `Imported ${report.stored.length} of ${report.discovered} sessions.`,
                202
            );
        } catch (error) {
            return handleApiError(error);
        }
    });
}
