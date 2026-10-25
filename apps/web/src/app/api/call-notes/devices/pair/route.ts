import { z } from "zod";

import { env } from "~/env";
import { requestTranslator } from "~/i18n/server";
import { pairCaptureDevice } from "~/server/call-notes/capture-devices";
import { captureDeviceVersionFailure } from "~/server/call-notes/device-auth";
import { isCaptureVersion } from "~/server/call-notes/capture-version";
import { publicOrigin } from "~/server/public-origin";

export const dynamic = "force-dynamic";

const PairDeviceSchema = z
    .object({
        code: z.string(),
        name: z.string().trim().min(1).max(128),
        appVersion: z.string().min(1).max(32).refine(isCaptureVersion),
        os: z.string().trim().min(1).max(32),
        arch: z.string().trim().min(1).max(16),
    })
    .strict();

export async function POST(request: Request): Promise<Response> {
    const t = requestTranslator(request, "errors.api");
    if (!env.server.CALL_NOTES_CAPTURE_ENABLED) {
        return Response.json({ error: "capture_disabled" }, { status: 503 });
    }
    try {
        let body: unknown;
        try {
            body = await request.json();
        } catch {
            return Response.json({ error: t("invalidJsonBody") }, { status: 400 });
        }
        const parsed = PairDeviceSchema.safeParse(body);
        if (!parsed.success) {
            return Response.json({ error: t("invalidRequest") }, { status: 400 });
        }
        const versionFailure = captureDeviceVersionFailure(parsed.data.appVersion);
        if (versionFailure) return versionFailure;
        const pairing = await pairCaptureDevice(parsed.data);
        if (!pairing) {
            return Response.json({ error: "pairing_code_invalid" }, { status: 410 });
        }
        return Response.json(
            { ...pairing, origin: publicOrigin(request) },
            {
                status: 201,
                headers: { "Cache-Control": "private, no-store" },
            }
        );
    } catch {
        return Response.json({ error: t("internal") }, { status: 503 });
    }
}
