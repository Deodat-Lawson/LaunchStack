import { env } from "~/env";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { getLatestCaptureRelease } from "~/server/call-notes/capture-app-storage";
import { issueCapturePairingCode } from "~/server/call-notes/capture-devices";
import { publicOrigin } from "~/server/public-origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
    try {
        const workspace = await requireWorkspacePermission("documents.read");
        if (!workspace.success) return workspace.response;
        if (!env.server.CALL_NOTES_CAPTURE_ENABLED) {
            return Response.json({ error: "capture_disabled" }, { status: 503 });
        }
        if (!(await getLatestCaptureRelease())) {
            return Response.json({ error: "release_unavailable" }, { status: 404 });
        }
        const code = await issueCapturePairingCode({
            companyId: workspace.data.companyId.toString(),
            userId: workspace.data.authUserId,
        });
        return Response.json(
            {
                code,
                downloadUrl: `${publicOrigin(request)}/api/call-notes/capture-app/d/${encodeURIComponent(code)}/LaunchStack-Capture.dmg`,
            },
            { status: 201, headers: { "Cache-Control": "private, no-store" } }
        );
    } catch {
        return Response.json({ error: "unavailable" }, { status: 503 });
    }
}
