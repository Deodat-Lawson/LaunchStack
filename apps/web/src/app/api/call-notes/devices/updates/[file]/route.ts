import { downloadCaptureUpdate } from "~/server/call-notes/capture-app-storage";
import { requireCaptureDevice } from "~/server/call-notes/device-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
    request: Request,
    context: { params: Promise<{ file: string }> }
): Promise<Response> {
    try {
        const device = await requireCaptureDevice(request);
        if (!device.success) return device.response;
        const { file } = await context.params;
        const stream = await downloadCaptureUpdate(file);
        if (!stream) {
            return Response.json({ error: "release_unavailable" }, { status: 404 });
        }
        return new Response(stream, {
            headers: {
                "Content-Type": "application/zip",
                "Content-Disposition": `attachment; filename="${file}"`,
                "Cache-Control": "private, no-store",
            },
        });
    } catch {
        return Response.json({ error: "unavailable" }, { status: 503 });
    }
}
