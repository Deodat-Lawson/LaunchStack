/**
 * PUT /api/mcp/uploads/<token> — where a CLI assistant (Claude Code, Codex)
 * sends a file from the person's machine, after `start_upload` opened the
 * slot:
 *
 *   curl -T ./plan.pdf https://…/api/mcp/uploads/<token>
 *
 * There is no session or bearer token on this request: the CLI's shell has
 * neither. The secret in the path is the authorisation. It is random, works
 * once, for 15 minutes, and only fills that one slot; filing the file still
 * takes an authenticated `add_document` call from the person's own
 * connection. POST is accepted too (`curl --data-binary @file`).
 */
import { NextResponse } from "next/server";

import { withRateLimit } from "~/lib/rate-limit-middleware";
import type { RateLimitConfig } from "~/lib/rate-limiter";
import { isMcpEnabled } from "~/server/mcp/config";
import { MAX_STAGED_BYTES, StagingError, receiveUpload } from "~/server/mcp/staging";

export const runtime = "nodejs";

/**
 * Per IP (the CLI's shell has no session). Above start_upload's own 30 per
 * 15 minutes per person, so a CLI filing many files never hits this first.
 */
const UPLOAD_LIMIT: Pick<RateLimitConfig, "maxRequests" | "windowMs"> = {
    maxRequests: 60,
    windowMs: 15 * 60 * 1000,
};
export const dynamic = "force-dynamic";

const STATUS_BY_CODE: Record<StagingError["code"], number> = {
    not_found: 404,
    gone: 404,
    used: 409,
    expired: 410,
    too_large: 413,
    empty: 400,
};

function declaredLength(request: Request): number | null {
    const raw = request.headers.get("content-length");
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
}

async function handle(request: Request, params: Promise<{ token: string }>) {
    if (!isMcpEnabled()) {
        return NextResponse.json({ error: "The MCP server is turned off." }, { status: 404 });
    }
    const { token } = await params;
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) {
        return NextResponse.json({ error: "This upload link is not valid." }, { status: 404 });
    }
    return withRateLimit(request, UPLOAD_LIMIT, async () => {
        try {
            const received = await receiveUpload(token, request.body, declaredLength(request));
            return NextResponse.json(
                {
                    ok: true,
                    uploadId: received.id,
                    filename: received.filename,
                    sizeBytes: received.sizeBytes,
                    message:
                        "Upload received. Tell the assistant it finished; it will file it with add_document.",
                },
                { status: 201 }
            );
        } catch (error) {
            if (error instanceof StagingError) {
                return NextResponse.json(
                    {
                        error: error.message,
                        code: error.code,
                        ...(error.code === "too_large" ? { maxBytes: MAX_STAGED_BYTES } : {}),
                    },
                    { status: STATUS_BY_CODE[error.code] }
                );
            }
            console.error("[mcp] upload failed", error);
            return NextResponse.json(
                {
                    error: "The upload failed on LaunchStack's side. Ask the assistant for a new link.",
                },
                { status: 500 }
            );
        }
    });
}

export function PUT(request: Request, context: { params: Promise<{ token: string }> }) {
    return handle(request, context.params);
}

export function POST(request: Request, context: { params: Promise<{ token: string }> }) {
    return handle(request, context.params);
}
