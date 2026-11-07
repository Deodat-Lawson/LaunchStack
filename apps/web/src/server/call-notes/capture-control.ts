import { and, eq } from "drizzle-orm";

import {
    CallNotesApplicationError,
    callNotesCaptures,
    type CallNotesCommand,
    type CallSnapshot,
} from "@launchstack/pipelines/call-notes";

import { getEngine } from "~/server/engine";
import { wakeCaptureDevice } from "./capture-wake";
import type { CaptureDeviceContext } from "./device-auth";

export async function assertCaptureDeviceCall(
    context: CaptureDeviceContext,
    callId: string
): Promise<void> {
    const [capture] = await getEngine()
        .db.select({
            userId: callNotesCaptures.captureUserId,
            deviceId: callNotesCaptures.targetDeviceId,
        })
        .from(callNotesCaptures)
        .where(
            and(
                eq(callNotesCaptures.companyId, BigInt(context.companyId)),
                eq(callNotesCaptures.callId, callId)
            )
        )
        .limit(1);
    if (
        !capture ||
        capture.userId !== context.userId ||
        (capture.deviceId !== null && capture.deviceId !== context.deviceId)
    ) {
        throw new CallNotesApplicationError("forbidden", "Capture belongs to another device");
    }
}

export async function wakeCaptureCommand(
    command: CallNotesCommand,
    snapshot: CallSnapshot | null
): Promise<void> {
    if (
        !snapshot ||
        !["start_capture", "resume_capture", "pause_capture", "stop_capture"].includes(command.kind)
    ) {
        return;
    }
    const [capture] = await getEngine()
        .db.select({ deviceId: callNotesCaptures.targetDeviceId })
        .from(callNotesCaptures)
        .where(
            and(
                eq(callNotesCaptures.companyId, BigInt(command.companyId)),
                eq(callNotesCaptures.callId, snapshot.id)
            )
        )
        .limit(1);
    if (capture?.deviceId) wakeCaptureDevice(capture.deviceId);
}
