import { requestTranslator } from "~/i18n/server";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { listCaptureDevices } from "~/server/call-notes/capture-devices";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
    const t = requestTranslator(request, "errors.api");
    try {
        const workspace = await requireWorkspacePermission("documents.read");
        if (!workspace.success) return workspace.response;
        const devices = await listCaptureDevices({
            companyId: workspace.data.companyId.toString(),
            userId: workspace.data.authUserId,
        });
        return Response.json({ devices }, { headers: { "Cache-Control": "private, no-store" } });
    } catch {
        return Response.json({ error: t("internal") }, { status: 503 });
    }
}
