/**
 * Agent-knowledge connector endpoint.
 *
 * GET  — preview what a sync would pick up (stats only, no file contents).
 * POST — read it and push it through the normal ingestion pipeline.
 *
 * The connector reads this server's filesystem, so both verbs are gated on
 * `AGENT_KNOWLEDGE_CONNECTOR_ENABLED` and on the caller holding
 * `connectors.manage` in the workspace.
 */

import type { NextResponse } from "next/server";
import { z } from "zod";

import { env } from "~/env";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import {
    createForbiddenError,
    createValidationError,
    createSuccessResponse,
    handleApiError,
} from "~/lib/api-utils";
import { requireConnectorAdmin } from "~/server/services/connectors/workspace-guard";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import {
    previewAgentKnowledge,
    runAgentKnowledgeSync,
} from "~/server/services/agent-knowledge-connector";
import {
    configuredProjectRoots,
    isAgentKnowledgeConnectorEnabled,
    resolveProjectRoots,
} from "~/server/services/agent-knowledge-policy";

export const runtime = "nodejs";
export const maxDuration = 300;

const TOOLS = ["claude-code", "codex"] as const;
const SCOPES = ["global", "project"] as const;

const SyncRequestSchema = z.object({
    tools: z.array(z.enum(TOOLS)).min(1).optional(),
    scopes: z.array(z.enum(SCOPES)).min(1).optional(),
    /** Project directories to scan. Must sit inside AGENT_KNOWLEDGE_PROJECT_ROOTS. */
    projects: z.array(z.string().min(1)).optional(),
    includeConfig: z.boolean().optional(),
    force: z.boolean().optional(),
    category: z.string().min(1).max(120).optional(),
    concurrency: z.number().int().min(1).max(16).optional(),
    maxItems: z.number().int().min(1).max(5000).optional(),
});

interface Caller {
    readonly userId: string;
    readonly companyId: bigint;
    readonly documentScope: WorkspaceContext["documentScope"];
}

type CallerResult = { ok: true; caller: Caller } | { ok: false; response: NextResponse };

/**
 * Imported content lands in the shared company knowledge base, so this is a
 * workspace-administration action: `connectors.manage` in an active
 * membership of the resolved workspace. The guard refuses rather than falls
 * back when there is no membership — importing into a company the caller has
 * left would leak their local agent folders into someone else's knowledge
 * base.
 */
async function resolveCaller(): Promise<CallerResult> {
    const admin = await requireConnectorAdmin();
    if (!admin.ok) return admin;
    return {
        ok: true,
        caller: {
            userId: admin.ctx.authUserId,
            companyId: admin.ctx.companyId,
            documentScope: () => admin.ctx.documentScope(),
        },
    };
}

function disabledResponse(): NextResponse {
    return createForbiddenError(
        "The agent-knowledge connector is disabled. Set AGENT_KNOWLEDGE_CONNECTOR_ENABLED=true on the server that hosts your Claude Code / Codex folders."
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
            const enabled = isAgentKnowledgeConnectorEnabled(
                env.server.AGENT_KNOWLEDGE_CONNECTOR_ENABLED
            );
            const callerResult = await resolveCaller();
            if (!callerResult.ok) return callerResult.response;
            if (!enabled) return disabledResponse();

            const { searchParams } = new URL(request.url);
            const roots = configuredProjectRoots(env.server.AGENT_KNOWLEDGE_PROJECT_ROOTS);
            const decision = resolveProjectRoots(
                parseListParam(searchParams.get("projects")),
                roots
            );

            const scan = await previewAgentKnowledge({
                tools: parseListParam(searchParams.get("tools")) as
                    | (typeof TOOLS)[number][]
                    | undefined,
                scopes: parseListParam(searchParams.get("scopes")) as
                    | (typeof SCOPES)[number][]
                    | undefined,
                projects: decision.allowed.map(dir => ({ dir })),
                includeConfig: searchParams.get("includeConfig") === "true",
            });

            return createSuccessResponse({
                enabled: true,
                configuredProjectRoots: roots,
                rejectedProjects: decision.rejected,
                roots: scan.roots,
                truncated: scan.truncated,
                items: scan.items.map(item => ({
                    sourceId: item.sourceId,
                    title: item.title,
                    kind: item.kind,
                    bytes: item.bytes,
                    modifiedAt: item.modifiedAt,
                    relativePath: item.location.relativePath,
                })),
                skipped: scan.skipped,
            });
        } catch (error) {
            return handleApiError(error);
        }
    });
}

export async function POST(request: Request) {
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const enabled = isAgentKnowledgeConnectorEnabled(
                env.server.AGENT_KNOWLEDGE_CONNECTOR_ENABLED
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
            const roots = configuredProjectRoots(env.server.AGENT_KNOWLEDGE_PROJECT_ROOTS);
            const decision = resolveProjectRoots(body.projects, roots);

            if (decision.rejected.length > 0) {
                return createForbiddenError(
                    `Project directories outside AGENT_KNOWLEDGE_PROJECT_ROOTS: ${decision.rejected.join(", ")}`
                );
            }

            const report = await runAgentKnowledgeSync({
                companyId: callerResult.caller.companyId,
                userId: callerResult.caller.userId,
                tools: body.tools,
                scopes: body.scopes,
                projects: decision.allowed.map(dir => ({ dir })),
                includeConfig: body.includeConfig,
                maxItems: body.maxItems,
                category: body.category,
                concurrency: body.concurrency,
                force: body.force,
                requestUrl: request.url,
            });

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
                },
                `Synced ${report.stored.length} of ${report.discovered} knowledge files.`,
                202
            );
        } catch (error) {
            return handleApiError(error);
        }
    });
}
