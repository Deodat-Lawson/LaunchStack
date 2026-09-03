/**
 * Claude artifacts collection endpoint — list and import.
 *
 * Artifacts are workspace-scoped, not user-scoped: anyone in the company can
 * open an artifact a colleague imported, matching how Sources behave.
 *
 * Import accepts the body directly (paste or file upload) or fetches it from a
 * public URL through the SSRF guard. claude.ai share links are refused with a
 * structured 422: those pages render the artifact client-side behind bot
 * protection, so a server fetch would only ever capture an empty app shell —
 * the dialog tells the user to paste or upload the artifact instead.
 */

import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import {
    artifactSearchText,
    deriveArtifactTitle,
    detectArtifactType,
    isClaudeHostedUrl,
    MAX_ARTIFACT_BYTES,
    type ArtifactType,
} from "~/lib/artifact-content";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { ImportArtifactSchema, serverError, validateRequestBody } from "~/lib/validation";
import { db } from "~/server/db";
import { claudeArtifacts } from "~/server/db/schema";
import { assertPublicHttpUrl, fetchPublicUrl, UrlGuardError } from "~/server/security/url-guard";
import { listArtifacts, listFolders, toDetail } from "~/server/artifacts/repository";

const FETCH_TIMEOUT_MS = 30_000;

/** Content types an artifact URL may serve; anything else is not an artifact. */
const TEXT_CONTENT_TYPES = /(text\/|application\/(xhtml\+xml|xml|json|javascript)|image\/svg)/i;

/** Trimmed value, or `undefined` when missing or blank (`??` can't do blank). */
function nonEmpty(value: string | null | undefined): string | undefined {
    const trimmed = value?.trim();
    if (trimmed === undefined || trimmed === "") return undefined;
    return trimmed;
}

/**
 * Fetch an artifact body with timeout, size cap, and content-type check.
 * Guard rejections are rethrown so the route answers 400, not a generic 502.
 */
async function fetchArtifactBody(url: string): Promise<string | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const response = await fetchPublicUrl(url, {
            signal: controller.signal,
            headers: {
                "User-Agent": "Mozilla/5.0 (compatible; LaunchStack-ArtifactImport/1.0)",
                Accept: "text/html,image/svg+xml,text/markdown,text/plain;q=0.9,*/*;q=0.8",
            },
        });
        clearTimeout(timeout);

        if (!response.ok) return null;
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType && !TEXT_CONTENT_TYPES.test(contentType)) return null;

        const arrayBuf = await response.arrayBuffer();
        if (arrayBuf.byteLength > MAX_ARTIFACT_BYTES) return null;

        return Buffer.from(arrayBuf).toString("utf-8");
    } catch (err) {
        clearTimeout(timeout);
        if (err instanceof UrlGuardError) throw err;
        return null;
    }
}

export async function GET(request: Request) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const { searchParams } = new URL(request.url);
        const scope = searchParams.get("scope") === "trash" ? "trash" : "active";

        const [items, folders] = await Promise.all([
            listArtifacts({
                companyId: ctx.data.companyId,
                scope,
                folder: searchParams.get("folder") ?? undefined,
                search: nonEmpty(searchParams.get("q")),
                starredOnly: searchParams.get("starred") === "1",
                limit: Number(searchParams.get("limit")) || undefined,
            }),
            listFolders(ctx.data.companyId),
        ]);

        return NextResponse.json({ artifacts: items, folders }, { status: 200 });
    } catch (error) {
        console.error("[artifacts] list failed:", error);
        return serverError("Failed to load artifacts");
    }
}

export async function POST(request: Request) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    // The strict preset because the URL path makes an outbound fetch.
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const validation = await validateRequestBody(request, ImportArtifactSchema);
            if (!validation.success) return validation.response;
            const body = validation.data;

            let content = body.content;
            let importMethod: "paste" | "upload" | "url" = body.fetchFromUrl ? "url" : "paste";

            if (content === undefined) {
                // fetchFromUrl mode — the schema guarantees sourceUrl is set.
                const sourceUrl = body.sourceUrl!;
                if (isClaudeHostedUrl(sourceUrl)) {
                    return NextResponse.json(
                        {
                            error: "claude.ai pages can't be fetched server-side — they render the artifact in the browser behind bot protection. Copy the artifact's code (or download it) in Claude and paste or upload it here; the link is kept as the source.",
                            code: "claude_share_link",
                        },
                        { status: 422 }
                    );
                }

                let parsedUrl: URL;
                try {
                    parsedUrl = await assertPublicHttpUrl(sourceUrl);
                } catch (err) {
                    if (err instanceof UrlGuardError) {
                        return NextResponse.json({ error: err.message }, { status: 400 });
                    }
                    throw err;
                }

                const fetched = await fetchArtifactBody(parsedUrl.href);
                if (!fetched?.trim()) {
                    return NextResponse.json(
                        { error: "Couldn't fetch that URL, or it didn't return text content" },
                        { status: 502 }
                    );
                }
                content = fetched;
            } else {
                importMethod = body.importMethod ?? "paste";
            }

            const artifactType: ArtifactType = body.artifactType ?? detectArtifactType(content);
            const title =
                nonEmpty(body.title) ??
                deriveArtifactTitle(content, artifactType) ??
                "Untitled artifact";

            const [row] = await db
                .insert(claudeArtifacts)
                .values({
                    companyId: ctx.data.companyId,
                    createdByUserId: ctx.data.authUserId,
                    updatedByUserId: ctx.data.authUserId,
                    title,
                    description: body.description ?? null,
                    folder: nonEmpty(body.folder) ?? "Unfiled",
                    artifactType,
                    sourceUrl: body.sourceUrl ?? null,
                    importMethod,
                    content,
                    sizeBytes: Buffer.byteLength(content, "utf-8"),
                    contentHash: createHash("sha256").update(content).digest("hex"),
                    searchText: artifactSearchText(content),
                    openedAt: new Date(),
                })
                .returning();

            if (!row) return serverError("Failed to import artifact");
            return NextResponse.json({ artifact: toDetail(row) }, { status: 201 });
        } catch (error) {
            console.error("[artifacts] import failed:", error);
            return serverError("Failed to import artifact");
        }
    });
}
