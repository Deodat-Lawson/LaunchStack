import { env } from "~/env";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { downloadLatestCaptureApp } from "~/server/call-notes/capture-app-storage";
import { isCapturePairingCodeValid } from "~/server/call-notes/capture-devices";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
    _request: Request,
    context: { params: Promise<{ code: string; filename: string }> }
): Promise<Response> {
    try {
        const workspace = await requireWorkspacePermission("documents.read");
        if (!workspace.success) return workspace.response;
        if (!env.server.CALL_NOTES_CAPTURE_ENABLED) {
            return Response.json({ error: "capture_disabled" }, { status: 503 });
        }
        const { code, filename } = await context.params;
        if (filename !== "LaunchStack-Capture.dmg") {
            return Response.json({ error: "release_unavailable" }, { status: 404 });
        }
        const valid = await isCapturePairingCodeValid(code, {
            companyId: workspace.data.companyId.toString(),
            userId: workspace.data.authUserId,
        });
        if (!valid) {
            return Response.json({ error: "pairing_code_invalid" }, { status: 410 });
        }
        const stream = await downloadLatestCaptureApp();
        if (!stream) {
            return Response.json({ error: "release_unavailable" }, { status: 404 });
        }
        return new Response(stream, {
            headers: {
                "Content-Type": "application/x-apple-diskimage",
                "Content-Disposition": 'attachment; filename="LaunchStack-Capture.dmg"',
                "Cache-Control": "private, no-store",
            },
        });
    } catch {
        return Response.json({ error: "unavailable" }, { status: 503 });
    }
}
