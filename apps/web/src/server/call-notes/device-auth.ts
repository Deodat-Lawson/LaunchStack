import { createHash } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";
import { callNotesCaptureDevices } from "@launchstack/pipelines/call-notes";

import { env } from "~/env";
import { getEngine } from "~/server/engine";
import { users, userCompanyMemberships } from "~/server/db/schema/identity";
import { compareCaptureVersions, isCaptureVersion } from "./capture-version";

export type CaptureDeviceContext = { companyId: string; userId: string; deviceId: string };

type CaptureDeviceAuthentication =
    | { success: true; data: CaptureDeviceContext }
    | { success: false; response: Response };

export function captureDeviceVersionFailure(
    version: string | null,
    enforceMinimum = true
): Response | null {
    const minVersion = enforceMinimum ? env.server.CALL_NOTES_MIN_APP_VERSION : undefined;
    if (minVersion) {
        const comparison = version === null ? null : compareCaptureVersions(version, minVersion);
        if (comparison === null || comparison < 0) {
            return Response.json({ error: "upgrade_required", minVersion }, { status: 426 });
        }
    } else if (version === null || !isCaptureVersion(version)) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    return null;
}

export async function requireCaptureDevice(
    request: Request,
    purpose: "capture" | "update" = "capture"
): Promise<CaptureDeviceAuthentication> {
    if (purpose === "capture" && !env.server.CALL_NOTES_CAPTURE_ENABLED) {
        return {
            success: false,
            response: Response.json({ error: "capture_disabled" }, { status: 503 }),
        };
    }
    const token = /^Bearer (lsc_[A-Za-z0-9_-]{43})$/i.exec(
        request.headers.get("authorization") ?? ""
    )?.[1];
    if (!token) {
        return {
            success: false,
            response: Response.json({ error: "unauthorized" }, { status: 401 }),
        };
    }
    const [device] = await getEngine()
        .db.select({
            companyId: callNotesCaptureDevices.companyId,
            userId: callNotesCaptureDevices.userId,
            deviceId: callNotesCaptureDevices.id,
        })
        .from(callNotesCaptureDevices)
        .innerJoin(users, eq(users.userId, callNotesCaptureDevices.userId))
        .innerJoin(
            userCompanyMemberships,
            and(
                eq(userCompanyMemberships.userId, users.id),
                eq(userCompanyMemberships.companyId, callNotesCaptureDevices.companyId),
                eq(userCompanyMemberships.status, "active")
            )
        )
        .where(
            and(
                eq(
                    callNotesCaptureDevices.tokenHash,
                    createHash("sha256").update(token).digest("hex")
                ),
                isNull(callNotesCaptureDevices.revokedAt)
            )
        )
        .limit(1);
    if (!device) {
        return {
            success: false,
            response: Response.json({ error: "unauthorized" }, { status: 401 }),
        };
    }
    const versionFailure = captureDeviceVersionFailure(
        request.headers.get("X-LaunchStack-Capture-Version"),
        purpose === "capture"
    );
    if (versionFailure) return { success: false, response: versionFailure };
    return {
        success: true,
        data: {
            companyId: device.companyId.toString(),
            userId: device.userId,
            deviceId: device.deviceId,
        },
    };
}
