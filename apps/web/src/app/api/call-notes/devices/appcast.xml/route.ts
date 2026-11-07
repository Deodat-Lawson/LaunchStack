import { readCaptureAppcast } from "~/server/call-notes/capture-app-storage";
import { requireCaptureDevice } from "~/server/call-notes/device-auth";
import { publicOrigin } from "~/server/public-origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function escapeXml(value: string): string {
    return value.replace(/[&<>"']/g, character => {
        switch (character) {
            case "&":
                return "&amp;";
            case "<":
                return "&lt;";
            case ">":
                return "&gt;";
            case '"':
                return "&quot;";
            case "'":
                return "&apos;";
            default:
                return character;
        }
    });
}

export async function GET(request: Request): Promise<Response> {
    try {
        const device = await requireCaptureDevice(request, "update");
        if (!device.success) return device.response;
        const appcast = await readCaptureAppcast();
        if (appcast === null) {
            return Response.json({ error: "release_unavailable" }, { status: 404 });
        }
        const body = appcast.replaceAll("__LAUNCHSTACK_ORIGIN__", escapeXml(publicOrigin(request)));
        return new Response(body, {
            headers: {
                "Content-Type": "application/xml; charset=utf-8",
                "Cache-Control": "private, no-store",
            },
        });
    } catch {
        return Response.json({ error: "unavailable" }, { status: 503 });
    }
}
