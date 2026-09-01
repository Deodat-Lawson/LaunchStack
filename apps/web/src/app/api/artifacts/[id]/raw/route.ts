/**
 * Download an artifact's body as a file.
 *
 * Always `Content-Disposition: attachment`: an imported artifact is untrusted
 * HTML, and serving it inline from this origin would run its scripts with the
 * user's session. In-app preview instead renders through a sandboxed iframe
 * (`srcDoc` without `allow-same-origin`, so scripts run in an opaque origin).
 * The `sandbox` CSP is a second lock on the same door for anything that
 * ignores the disposition.
 */

import { NextResponse } from "next/server";

import { artifactFileExtension, type ArtifactType } from "~/lib/artifact-content";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { serverError } from "~/lib/validation";
import { getArtifact } from "~/server/artifacts/repository";

const CONTENT_TYPE_BY_ARTIFACT: Record<string, string> = {
    html: "text/html; charset=utf-8",
    svg: "image/svg+xml; charset=utf-8",
    markdown: "text/markdown; charset=utf-8",
    mermaid: "text/plain; charset=utf-8",
    react: "text/plain; charset=utf-8",
    code: "text/plain; charset=utf-8",
};

function sanitizeForFilename(value: string): string {
    return (
        value
            .replace(/[^a-zA-Z0-9._-]/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 80) || "artifact"
    );
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const id = Number.parseInt((await params).id, 10);
        if (!Number.isInteger(id) || id <= 0) {
            return NextResponse.json({ error: "Invalid id" }, { status: 400 });
        }

        const row = await getArtifact(id, ctx.data.companyId);
        if (!row) return NextResponse.json({ error: "Artifact not found" }, { status: 404 });

        const extension = artifactFileExtension(row.artifactType as ArtifactType);
        const filename = `${sanitizeForFilename(row.title)}.${extension}`;

        return new NextResponse(row.content, {
            status: 200,
            headers: {
                "Content-Type":
                    CONTENT_TYPE_BY_ARTIFACT[row.artifactType] ?? "text/plain; charset=utf-8",
                "Content-Disposition": `attachment; filename="${filename}"`,
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "sandbox",
                "Cache-Control": "private, no-store",
            },
        });
    } catch (error) {
        console.error("[artifacts] download failed:", error);
        return serverError("Failed to download artifact");
    }
}
