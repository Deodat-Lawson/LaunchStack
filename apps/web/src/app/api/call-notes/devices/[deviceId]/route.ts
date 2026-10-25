import { requestTranslator } from "~/i18n/server";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { revokeCaptureDevice } from "~/server/call-notes/capture-devices";

export const dynamic = "force-dynamic";

export async function DELETE(
    request: Request,
    context: { params: Promise<{ deviceId: string }> }
): Promise<Response> {
    const t = requestTranslator(request, "errors.api");
    try {
        const workspace = await requireWorkspacePermission("documents.read");
        if (!workspace.success) return workspace.response;
        const { deviceId } = await context.params;
        const result = await revokeCaptureDevice(deviceId, {
            companyId: workspace.data.companyId.toString(),
            userId: workspace.data.authUserId,
            role: workspace.data.role,
        });
        if (result === "not_found") {
            return Response.json({ error: t("notFound") }, { status: 404 });
        }
        if (result === "forbidden") {
            return Response.json({ error: t("forbidden") }, { status: 403 });
        }
        return new Response(null, { status: 204 });
    } catch {
        return Response.json({ error: t("internal") }, { status: 503 });
    }
}
