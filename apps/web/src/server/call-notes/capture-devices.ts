import type { CaptureDeviceSummary } from "@launchstack/pipelines/call-notes/contracts";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { company } from "@launchstack/store/schema";
import {
    callNotesCaptureDevices,
    callNotesCapturePairingCodes,
} from "@launchstack/pipelines/call-notes";

import { getEngine } from "~/server/engine";
import { users, userCompanyMemberships } from "~/server/db/schema/identity";

type CaptureOwner = { companyId: string; userId: string };

export async function issueCapturePairingCode(context: CaptureOwner): Promise<string> {
    const code = `lsp_${randomBytes(24).toString("base64url")}`;
    await getEngine()
        .db.insert(callNotesCapturePairingCodes)
        .values({
            codeHash: createHash("sha256").update(code).digest("hex"),
            companyId: BigInt(context.companyId),
            userId: context.userId,
            expiresAt: sql`CURRENT_TIMESTAMP + INTERVAL '24 hours'`,
        });
    return code;
}

export async function isCapturePairingCodeValid(
    code: string,
    context: CaptureOwner
): Promise<boolean> {
    if (!/^lsp_[A-Za-z0-9_-]{32}$/.test(code)) return false;
    const [row] = await getEngine()
        .db.select({ codeHash: callNotesCapturePairingCodes.codeHash })
        .from(callNotesCapturePairingCodes)
        .where(
            and(
                eq(
                    callNotesCapturePairingCodes.codeHash,
                    createHash("sha256").update(code).digest("hex")
                ),
                eq(callNotesCapturePairingCodes.companyId, BigInt(context.companyId)),
                eq(callNotesCapturePairingCodes.userId, context.userId),
                isNull(callNotesCapturePairingCodes.consumedAt),
                gt(callNotesCapturePairingCodes.expiresAt, sql`clock_timestamp()`)
            )
        )
        .limit(1);
    return row !== undefined;
}

export type CaptureDevicePairing = {
    deviceId: string;
    token: string;
    user: { id: string; name: string | null; email: string };
    company: { id: string; name: string };
};

export async function pairCaptureDevice(input: {
    code: string;
    name: string;
    appVersion: string;
    os: string;
    arch: string;
}): Promise<CaptureDevicePairing | null> {
    if (!/^lsp_[A-Za-z0-9_-]{32}$/.test(input.code)) return null;
    const codeHash = createHash("sha256").update(input.code).digest("hex");
    return getEngine().db.transaction(async tx => {
        const [identity] = await tx
            .select({
                companyId: callNotesCapturePairingCodes.companyId,
                userId: callNotesCapturePairingCodes.userId,
                userName: users.name,
                userEmail: users.email,
                companyName: company.name,
            })
            .from(callNotesCapturePairingCodes)
            .innerJoin(users, eq(users.userId, callNotesCapturePairingCodes.userId))
            .innerJoin(
                userCompanyMemberships,
                and(
                    eq(userCompanyMemberships.userId, users.id),
                    eq(userCompanyMemberships.companyId, callNotesCapturePairingCodes.companyId),
                    eq(userCompanyMemberships.status, "active")
                )
            )
            .innerJoin(company, eq(company.id, callNotesCapturePairingCodes.companyId))
            .where(
                and(
                    eq(callNotesCapturePairingCodes.codeHash, codeHash),
                    isNull(callNotesCapturePairingCodes.consumedAt),
                    gt(callNotesCapturePairingCodes.expiresAt, sql`clock_timestamp()`)
                )
            )
            .limit(1)
            // Keep removal or suspension from racing the single-use consume.
            // Lock the membership only: locking the code here would deadlock
            // two concurrent consumers upgrading a shared lock to an update.
            .for("share", { of: userCompanyMemberships });
        if (!identity) return null;

        const deviceId = `capdev_${randomUUID()}`;
        const [consumed] = await tx
            .update(callNotesCapturePairingCodes)
            .set({ consumedAt: sql`clock_timestamp()`, consumedDeviceId: deviceId })
            .where(
                and(
                    eq(callNotesCapturePairingCodes.codeHash, codeHash),
                    isNull(callNotesCapturePairingCodes.consumedAt),
                    gt(callNotesCapturePairingCodes.expiresAt, sql`clock_timestamp()`)
                )
            )
            .returning({ codeHash: callNotesCapturePairingCodes.codeHash });
        if (!consumed) return null;

        const token = `lsc_${randomBytes(32).toString("base64url")}`;
        await tx.insert(callNotesCaptureDevices).values({
            id: deviceId,
            companyId: identity.companyId,
            userId: identity.userId,
            name: input.name,
            tokenHash: createHash("sha256").update(token).digest("hex"),
            appVersion: input.appVersion,
            os: input.os,
            arch: input.arch,
        });
        return {
            deviceId,
            token,
            user: { id: identity.userId, name: identity.userName, email: identity.userEmail },
            company: { id: identity.companyId.toString(), name: identity.companyName },
        };
    });
}

export async function listCaptureDevices(context: CaptureOwner): Promise<CaptureDeviceSummary[]> {
    const rows = await getEngine()
        .db.select({
            id: callNotesCaptureDevices.id,
            name: callNotesCaptureDevices.name,
            appVersion: callNotesCaptureDevices.appVersion,
            os: callNotesCaptureDevices.os,
            arch: callNotesCaptureDevices.arch,
            lastSeenAt: callNotesCaptureDevices.lastSeenAt,
            createdAt: callNotesCaptureDevices.createdAt,
        })
        .from(callNotesCaptureDevices)
        .where(
            and(
                eq(callNotesCaptureDevices.companyId, BigInt(context.companyId)),
                eq(callNotesCaptureDevices.userId, context.userId),
                isNull(callNotesCaptureDevices.revokedAt)
            )
        )
        .orderBy(desc(callNotesCaptureDevices.createdAt), desc(callNotesCaptureDevices.id));
    const onlineSince = Date.now() - 60_000;
    return rows.map(row => ({
        ...row,
        online: row.lastSeenAt !== null && row.lastSeenAt.getTime() > onlineSince,
        lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
    }));
}

export async function revokeCaptureDevice(
    deviceId: string,
    context: CaptureOwner & { role: string }
): Promise<"revoked" | "not_found" | "forbidden"> {
    const db = getEngine().db;
    const deviceScope = and(
        eq(callNotesCaptureDevices.id, deviceId),
        eq(callNotesCaptureDevices.companyId, BigInt(context.companyId))
    );
    const [device] = await db
        .select({ userId: callNotesCaptureDevices.userId })
        .from(callNotesCaptureDevices)
        .where(deviceScope)
        .limit(1);
    if (!device) return "not_found";
    if (device.userId !== context.userId && context.role !== "owner" && context.role !== "admin") {
        return "forbidden";
    }
    await db
        .update(callNotesCaptureDevices)
        .set({ revokedAt: sql`coalesce(${callNotesCaptureDevices.revokedAt}, clock_timestamp())` })
        .where(deviceScope);
    return "revoked";
}
