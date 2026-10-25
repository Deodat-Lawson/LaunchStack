import { env } from "~/env";
import { requestTranslator } from "~/i18n/server";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { issueCapturePairingCode } from "~/server/call-notes/capture-devices";
import { publicOrigin } from "~/server/public-origin";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
    const t = requestTranslator(request, "errors.api");
    try {
        const workspace = await requireWorkspacePermission("documents.read");
        if (!workspace.success) return workspace.response;
        if (!env.server.CALL_NOTES_CAPTURE_ENABLED) {
            return Response.json({ error: "capture_disabled" }, { status: 503 });
        }
        const code = await issueCapturePairingCode({
            companyId: workspace.data.companyId.toString(),
            userId: workspace.data.authUserId,
        });
        const deepLink = `launchstack-capture://pair?origin=${encodeURIComponent(publicOrigin(request))}&code=${code}`;
        return Response.json(
            { code, deepLink },
            {
                status: 201,
                headers: { "Cache-Control": "private, no-store" },
            }
        );
    } catch {
        return Response.json({ error: t("internal") }, { status: 503 });
    }
}
