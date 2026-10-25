import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { company } from "@launchstack/store/schema";
import {
    callNotesCaptureDevices,
    callNotesCapturePairingCodes,
} from "@launchstack/pipelines/call-notes";

const mockGetEngine = jest.fn();
const mockWorkspacePermission = jest.fn();
const mockServerEnv: Record<string, unknown> = {
    CALL_NOTES_CAPTURE_ENABLED: true,
};

jest.mock("~/server/engine", () => ({
    getEngine: (): unknown => mockGetEngine(),
}));
jest.mock("~/env", () => ({
    get env() {
        return { server: mockServerEnv };
    },
}));
jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspacePermission: (...args: unknown[]): unknown => mockWorkspacePermission(...args),
}));

import { POST as pairDevice } from "~/app/api/call-notes/devices/pair/route";
import { POST as createConnectCode } from "~/app/api/call-notes/capture-app/connect-codes/route";
import { GET as listDevices } from "~/app/api/call-notes/devices/route";
import { DELETE as revokeDevice } from "~/app/api/call-notes/devices/[deviceId]/route";
import { users, userCompanyMemberships } from "~/server/db/schema/identity";
import {
    issueCapturePairingCode,
    isCapturePairingCodeValid,
} from "~/server/call-notes/capture-devices";
import { requireCaptureDevice } from "~/server/call-notes/device-auth";

import { createCallNotesTestDatabase, type CallNotesTestDatabase } from "./testDb";

const describeIfDatabase =
    (process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL)
        ? describe
        : describe.skip;
const PAIR_BODY = {
    name: "Kien's Mac",
    appVersion: "1.2.3",
    os: "macos",
    arch: "arm64",
};

function pairRequest(code: string, extra: Record<string, unknown> = {}): Request {
    return new Request("http://internal:3000/api/call-notes/devices/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...PAIR_BODY, code, ...extra }),
    });
}

function hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

describeIfDatabase("Capture device pairing against the migrated database", () => {
    let database: CallNotesTestDatabase;
    let companyId: bigint;
    let otherCompanyId: bigint;
    let userPk: bigint;
    let otherUserPk: bigint;
    const userId = "capture_pairing_owner";
    const teammateId = "capture_pairing_teammate";
    const originalOrigin = process.env.BETTER_AUTH_URL;

    beforeAll(async () => {
        database = await createCallNotesTestDatabase();
        const [workspace, otherWorkspace] = await database.db
            .insert(company)
            .values([
                { name: "Capture pairing workspace", numberOfEmployees: "2" },
                { name: "Other capture workspace", numberOfEmployees: "2" },
            ])
            .returning({ id: company.id });
        companyId = BigInt(workspace!.id);
        otherCompanyId = BigInt(otherWorkspace!.id);
        const [owner, teammate] = await database.db
            .insert(users)
            .values([
                {
                    name: "Capture Owner",
                    email: "capture-owner@example.test",
                    userId,
                    companyId,
                },
                {
                    name: "Capture Teammate",
                    email: "capture-teammate@example.test",
                    userId: teammateId,
                    companyId,
                },
            ])
            .returning({ id: users.id });
        userPk = BigInt(owner!.id);
        otherUserPk = BigInt(teammate!.id);
        await database.db.insert(userCompanyMemberships).values([
            { userId: userPk, companyId, role: "owner" },
            { userId: otherUserPk, companyId, role: "member" },
        ]);
    }, 120_000);

    beforeEach(async () => {
        jest.clearAllMocks();
        mockGetEngine.mockReturnValue({ db: database.db });
        mockServerEnv.CALL_NOTES_CAPTURE_ENABLED = true;
        delete mockServerEnv.CALL_NOTES_MIN_APP_VERSION;
        process.env.BETTER_AUTH_URL = "https://capture.example.test/auth";
        await database.db
            .delete(callNotesCaptureDevices)
            .where(eq(callNotesCaptureDevices.companyId, companyId));
        await database.db
            .delete(callNotesCapturePairingCodes)
            .where(eq(callNotesCapturePairingCodes.companyId, companyId));
        await database.db
            .insert(userCompanyMemberships)
            .values({ userId: userPk, companyId, status: "active", role: "owner" })
            .onConflictDoUpdate({
                target: [userCompanyMemberships.userId, userCompanyMemberships.companyId],
                set: { status: "active", role: "owner" },
            });
        mockWorkspacePermission.mockResolvedValue({
            success: true,
            data: { authUserId: userId, companyId, role: "owner" },
        });
    });

    afterAll(async () => {
        if (originalOrigin === undefined) delete process.env.BETTER_AUTH_URL;
        else process.env.BETTER_AUTH_URL = originalOrigin;
        await database?.close();
    });

    it("issues a 24-hour hashed code and pairs its bound identity with a hashed device token", async () => {
        const code = await issueCapturePairingCode({ companyId: companyId.toString(), userId });
        expect(code).toMatch(/^lsp_[A-Za-z0-9_-]{32}$/);
        const [storedCode] = await database.db.select().from(callNotesCapturePairingCodes);
        expect(storedCode).toMatchObject({
            codeHash: hash(code),
            companyId,
            userId,
            consumedAt: null,
        });
        expect(storedCode!.expiresAt.getTime() - storedCode!.createdAt.getTime()).toBe(
            24 * 60 * 60 * 1_000
        );
        expect(
            await isCapturePairingCodeValid(code, { companyId: companyId.toString(), userId })
        ).toBe(true);

        const response = await pairDevice(pairRequest(code));
        expect(response.status).toBe(201);
        const body = await response.json();
        expect(body).toEqual({
            deviceId: expect.any(String),
            token: expect.stringMatching(/^lsc_[A-Za-z0-9_-]{43}$/),
            origin: "https://capture.example.test",
            user: { id: userId, name: "Capture Owner", email: "capture-owner@example.test" },
            company: { id: companyId.toString(), name: "Capture pairing workspace" },
        });
        const [storedDevice] = await database.db.select().from(callNotesCaptureDevices);
        expect(storedDevice).toMatchObject({
            id: body.deviceId,
            companyId,
            userId,
            tokenHash: hash(body.token),
            ...PAIR_BODY,
        });
        expect(storedDevice).not.toHaveProperty("token");
        expect(storedCode).not.toHaveProperty("code");
        expect(
            await isCapturePairingCodeValid(code, { companyId: companyId.toString(), userId })
        ).toBe(false);
        expect(mockWorkspacePermission).not.toHaveBeenCalled();
    });

    it("rejects unknown, expired, and malformed pairing codes without registering a device", async () => {
        const code = await issueCapturePairingCode({ companyId: companyId.toString(), userId });
        await database.db
            .update(callNotesCapturePairingCodes)
            .set({ expiresAt: new Date(Date.now() - 1_000) })
            .where(eq(callNotesCapturePairingCodes.codeHash, hash(code)));
        expect(
            await isCapturePairingCodeValid(code, { companyId: companyId.toString(), userId })
        ).toBe(false);
        for (const invalidCode of [code, `lsp_${"X".repeat(32)}`, "not-a-code"]) {
            const response = await pairDevice(pairRequest(invalidCode));
            expect(response.status).toBe(410);
            expect(await response.json()).toEqual({ error: "pairing_code_invalid" });
        }
        expect(await database.db.select().from(callNotesCaptureDevices)).toHaveLength(0);
    });

    it("validates pairing codes against both the session user and workspace", async () => {
        const code = await issueCapturePairingCode({ companyId: companyId.toString(), userId });
        expect(
            await isCapturePairingCodeValid(code, {
                companyId: companyId.toString(),
                userId: teammateId,
            })
        ).toBe(false);
        expect(
            await isCapturePairingCodeValid(code, { companyId: otherCompanyId.toString(), userId })
        ).toBe(false);
        expect(
            await isCapturePairingCodeValid(code, { companyId: companyId.toString(), userId })
        ).toBe(true);
        const spoofed = await pairDevice(
            pairRequest(code, { userId: teammateId, companyId: otherCompanyId.toString() })
        );
        expect(spoofed.status).toBe(400);
        expect(
            await isCapturePairingCodeValid(code, { companyId: companyId.toString(), userId })
        ).toBe(true);
    });

    it("atomically consumes a pairing code once when two database sessions race", async () => {
        const code = await issueCapturePairingCode({ companyId: companyId.toString(), userId });
        const first = await database.createSession();
        const second = await database.createSession();
        try {
            mockGetEngine
                .mockReturnValueOnce({ db: first.db })
                .mockReturnValueOnce({ db: second.db });
            const responses = await Promise.all([
                pairDevice(pairRequest(code, { name: "First Mac" })),
                pairDevice(pairRequest(code, { name: "Second Mac" })),
            ]);
            expect(responses.map(response => response.status).sort()).toEqual([201, 410]);
            const winner = await responses.find(response => response.status === 201)!.json();
            const [consumed] = await database.db.select().from(callNotesCapturePairingCodes);
            expect(consumed).toMatchObject({
                consumedDeviceId: winner.deviceId,
                consumedAt: expect.any(Date),
            });
            expect(await database.db.select().from(callNotesCaptureDevices)).toHaveLength(1);
            expect((await pairDevice(pairRequest(code))).status).toBe(410);
        } finally {
            await Promise.all([first.close(), second.close()]);
        }
    });

    it.each(["suspended", "pending", "removed"])(
        "rechecks active membership before consuming a code for a %s member",
        async status => {
            const code = await issueCapturePairingCode({ companyId: companyId.toString(), userId });
            const membership = and(
                eq(userCompanyMemberships.userId, userPk),
                eq(userCompanyMemberships.companyId, companyId)
            );
            if (status === "removed") {
                await database.db.delete(userCompanyMemberships).where(membership);
            } else {
                await database.db.update(userCompanyMemberships).set({ status }).where(membership);
            }
            const response = await pairDevice(pairRequest(code));
            expect(response.status).toBe(410);
            const [storedCode] = await database.db.select().from(callNotesCapturePairingCodes);
            expect(storedCode!.consumedAt).toBeNull();
            expect(await database.db.select().from(callNotesCaptureDevices)).toHaveLength(0);
        }
    );

    it("rejects an old app or disabled capture without consuming the pairing code", async () => {
        const code = await issueCapturePairingCode({ companyId: companyId.toString(), userId });
        mockServerEnv.CALL_NOTES_MIN_APP_VERSION = "2.0.0";
        const upgrade = await pairDevice(pairRequest(code));
        expect(upgrade.status).toBe(426);
        expect(await upgrade.json()).toEqual({ error: "upgrade_required", minVersion: "2.0.0" });
        mockServerEnv.CALL_NOTES_CAPTURE_ENABLED = false;
        expect((await pairDevice(pairRequest(code))).status).toBe(503);
        const [storedCode] = await database.db.select().from(callNotesCapturePairingCodes);
        expect(storedCode!.consumedAt).toBeNull();
    });

    it("authenticates only a current token with an active membership and no revocation", async () => {
        const code = await issueCapturePairingCode({ companyId: companyId.toString(), userId });
        const paired = await pairDevice(pairRequest(code));
        const { deviceId, token } = await paired.json();
        const request = new Request("https://capture.example.test/api/internal/call-notes/local", {
            headers: { Authorization: `Bearer ${token}`, "X-LaunchStack-Capture-Version": "1.2.3" },
        });
        expect(await requireCaptureDevice(request)).toEqual({
            success: true,
            data: { companyId: companyId.toString(), userId, deviceId },
        });
        await database.db
            .update(callNotesCaptureDevices)
            .set({ revokedAt: new Date() })
            .where(eq(callNotesCaptureDevices.id, deviceId));
        const revoked = await requireCaptureDevice(request);
        if (revoked.success) throw new Error("Expected a revoked token to be rejected");
        expect(revoked.response.status).toBe(401);
        expect(await revoked.response.json()).toEqual({ error: "unauthorized" });
        await database.db
            .update(callNotesCaptureDevices)
            .set({ revokedAt: null })
            .where(eq(callNotesCaptureDevices.id, deviceId));
        await database.db
            .delete(userCompanyMemberships)
            .where(
                and(
                    eq(userCompanyMemberships.userId, userPk),
                    eq(userCompanyMemberships.companyId, companyId)
                )
            );
        const removed = await requireCaptureDevice(request);
        if (removed.success) throw new Error("Expected a removed member's token to be rejected");
        expect(removed.response.status).toBe(401);
        expect(await removed.response.json()).toEqual({ error: "unauthorized" });
    });

    it("issues a session-bound connect code and a deep link using the public deployment origin", async () => {
        const response = await createConnectCode(
            new Request("http://app:3000/api/call-notes/capture-app/connect-codes", {
                method: "POST",
                body: JSON.stringify({ companyId: otherCompanyId.toString(), userId: teammateId }),
            })
        );
        expect(response.status).toBe(201);
        const { code, deepLink } = await response.json();
        expect(code).toMatch(/^lsp_[A-Za-z0-9_-]{32}$/);
        const url = new URL(deepLink);
        expect(url.protocol).toBe("launchstack-capture:");
        expect(url.hostname).toBe("pair");
        expect(url.searchParams.get("origin")).toBe("https://capture.example.test");
        expect(url.searchParams.get("code")).toBe(code);
        expect(
            await isCapturePairingCodeValid(code, { companyId: companyId.toString(), userId })
        ).toBe(true);
        expect(mockWorkspacePermission).toHaveBeenCalledWith("documents.read");
        expect(response.headers.get("cache-control")).toBe("private, no-store");
    });

    it("does not issue connect codes when capture is disabled or the workspace guard refuses", async () => {
        const request = new Request(
            "https://capture.example.test/api/call-notes/capture-app/connect-codes",
            { method: "POST" }
        );
        mockServerEnv.CALL_NOTES_CAPTURE_ENABLED = false;
        expect((await createConnectCode(request)).status).toBe(503);
        mockServerEnv.CALL_NOTES_CAPTURE_ENABLED = true;
        mockWorkspacePermission.mockResolvedValue({
            success: false,
            response: Response.json({ error: "Unauthorized" }, { status: 401 }),
        });
        expect((await createConnectCode(request)).status).toBe(401);
        expect(await database.db.select().from(callNotesCapturePairingCodes)).toHaveLength(0);
    });

    async function registerDevice(
        ownerId = userId,
        name = PAIR_BODY.name
    ): Promise<{ deviceId: string; token: string }> {
        const code = await issueCapturePairingCode({
            companyId: companyId.toString(),
            userId: ownerId,
        });
        const response = await pairDevice(pairRequest(code, { name }));
        expect(response.status).toBe(201);
        return response.json();
    }

    it("lists only the session user's non-revoked devices with accurate online state and no credentials", async () => {
        const online = await registerDevice(userId, "Online Mac");
        const neverSeen = await registerDevice(userId, "Never seen Mac");
        const stale = await registerDevice(userId, "Offline Mac");
        const revoked = await registerDevice(userId, "Revoked Mac");
        await registerDevice(teammateId, "Teammate Mac");
        const lastSeenAt = new Date(Date.now() - 5_000);
        await database.db
            .update(callNotesCaptureDevices)
            .set({ lastSeenAt })
            .where(eq(callNotesCaptureDevices.id, online.deviceId));
        await database.db
            .update(callNotesCaptureDevices)
            .set({ lastSeenAt: new Date(Date.now() - 61_000) })
            .where(eq(callNotesCaptureDevices.id, stale.deviceId));
        await database.db
            .update(callNotesCaptureDevices)
            .set({ revokedAt: new Date(), lastSeenAt })
            .where(eq(callNotesCaptureDevices.id, revoked.deviceId));
        const response = await listDevices(
            new Request("https://capture.example.test/api/call-notes/devices?userId=attacker")
        );
        expect(response.status).toBe(200);
        const { devices } = await response.json();
        expect(devices).toHaveLength(3);
        expect(devices.find((device: { id: string }) => device.id === online.deviceId)).toEqual({
            id: online.deviceId,
            name: "Online Mac",
            appVersion: PAIR_BODY.appVersion,
            os: PAIR_BODY.os,
            arch: PAIR_BODY.arch,
            online: true,
            lastSeenAt: lastSeenAt.toISOString(),
            createdAt: expect.any(String),
        });
        expect(
            devices.find((device: { id: string }) => device.id === neverSeen.deviceId)
        ).toMatchObject({ online: false, lastSeenAt: null });
        expect(
            devices.find((device: { id: string }) => device.id === stale.deviceId)
        ).toMatchObject({ online: false });
        for (const device of devices) {
            expect(device).not.toHaveProperty("token");
            expect(device).not.toHaveProperty("tokenHash");
            expect(device).not.toHaveProperty("companyId");
            expect(device).not.toHaveProperty("userId");
        }
        expect(mockWorkspacePermission).toHaveBeenCalledWith("documents.read");
    });

    it("does not list devices when the session workspace guard refuses", async () => {
        mockWorkspacePermission.mockResolvedValue({
            success: false,
            response: Response.json({ error: "Forbidden" }, { status: 403 }),
        });
        const response = await listDevices(
            new Request("https://capture.example.test/api/call-notes/devices")
        );
        expect(response.status).toBe(403);
        expect(mockGetEngine).not.toHaveBeenCalled();
    });

    it("allows a member to revoke their own device and immediately invalidates its token", async () => {
        const paired = await registerDevice();
        mockWorkspacePermission.mockResolvedValue({
            success: true,
            data: { authUserId: userId, companyId, role: "member" },
        });
        const request = new Request(
            `https://capture.example.test/api/call-notes/devices/${paired.deviceId}`,
            { method: "DELETE" }
        );
        const params = { params: Promise.resolve({ deviceId: paired.deviceId }) };
        const response = await revokeDevice(request, params);
        expect(response.status).toBe(204);
        expect(await response.text()).toBe("");
        expect((await revokeDevice(request, params)).status).toBe(204);
        const authenticated = await requireCaptureDevice(
            new Request("https://capture.example.test/api/internal/call-notes/local", {
                headers: {
                    Authorization: `Bearer ${paired.token}`,
                    "X-LaunchStack-Capture-Version": "1.2.3",
                },
            })
        );
        if (authenticated.success)
            throw new Error("Expected revocation to invalidate the device token");
        expect(authenticated.response.status).toBe(401);
        const listed = await listDevices(
            new Request("https://capture.example.test/api/call-notes/devices")
        );
        expect(await listed.json()).toEqual({ devices: [] });
    });

    it.each(["owner", "admin"])(
        "allows a workspace %s to revoke another member's device",
        async role => {
            const paired = await registerDevice(teammateId);
            mockWorkspacePermission.mockResolvedValue({
                success: true,
                data: { authUserId: userId, companyId, role },
            });
            const response = await revokeDevice(
                new Request(
                    `https://capture.example.test/api/call-notes/devices/${paired.deviceId}`,
                    { method: "DELETE" }
                ),
                { params: Promise.resolve({ deviceId: paired.deviceId }) }
            );
            expect(response.status).toBe(204);
            const [stored] = await database.db
                .select()
                .from(callNotesCaptureDevices)
                .where(eq(callNotesCaptureDevices.id, paired.deviceId));
            expect(stored!.revokedAt).toBeInstanceOf(Date);
        }
    );

    it("denies another ordinary member without revoking the device", async () => {
        const paired = await registerDevice(teammateId);
        mockWorkspacePermission.mockResolvedValue({
            success: true,
            data: { authUserId: userId, companyId, role: "member" },
        });
        const response = await revokeDevice(
            new Request(`https://capture.example.test/api/call-notes/devices/${paired.deviceId}`, {
                method: "DELETE",
            }),
            { params: Promise.resolve({ deviceId: paired.deviceId }) }
        );
        expect(response.status).toBe(403);
        const [stored] = await database.db
            .select()
            .from(callNotesCaptureDevices)
            .where(eq(callNotesCaptureDevices.id, paired.deviceId));
        expect(stored!.revokedAt).toBeNull();
    });

    it("does not expose or revoke a device from another workspace, even to an owner", async () => {
        const paired = await registerDevice();
        mockWorkspacePermission.mockResolvedValue({
            success: true,
            data: { authUserId: userId, companyId: otherCompanyId, role: "owner" },
        });
        const response = await revokeDevice(
            new Request(`https://capture.example.test/api/call-notes/devices/${paired.deviceId}`, {
                method: "DELETE",
            }),
            { params: Promise.resolve({ deviceId: paired.deviceId }) }
        );
        expect(response.status).toBe(404);
        const [stored] = await database.db
            .select()
            .from(callNotesCaptureDevices)
            .where(eq(callNotesCaptureDevices.id, paired.deviceId));
        expect(stored!.revokedAt).toBeNull();
    });

    it("returns the session guard's denial before attempting device revocation", async () => {
        mockWorkspacePermission.mockResolvedValue({
            success: false,
            response: Response.json({ error: "Unauthorized" }, { status: 401 }),
        });
        const response = await revokeDevice(
            new Request("https://capture.example.test/api/call-notes/devices/missing", {
                method: "DELETE",
            }),
            { params: Promise.resolve({ deviceId: "missing" }) }
        );
        expect(response.status).toBe(401);
        expect(mockGetEngine).not.toHaveBeenCalled();
    });

    it("applies unknown-token, upgrade, and disabled responses to a real registered device", async () => {
        const paired = await registerDevice();
        const request = (token: string, version: string) =>
            new Request("https://capture.example.test/api/internal/call-notes/local", {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "X-LaunchStack-Capture-Version": version,
                },
            });
        const unknown = await requireCaptureDevice(request(`lsc_${"Z".repeat(43)}`, "1.2.3"));
        if (unknown.success) throw new Error("Expected an unknown token to be rejected");
        expect(unknown.response.status).toBe(401);
        expect(await unknown.response.json()).toEqual({ error: "unauthorized" });
        mockServerEnv.CALL_NOTES_MIN_APP_VERSION = "1.10.0";
        const upgrade = await requireCaptureDevice(request(paired.token, "1.2.3"));
        if (upgrade.success) throw new Error("Expected a below-minimum version to be rejected");
        expect(upgrade.response.status).toBe(426);
        expect(await upgrade.response.json()).toEqual({
            error: "upgrade_required",
            minVersion: "1.10.0",
        });
        expect((await requireCaptureDevice(request(paired.token, "1.10.0+arm64"))).success).toBe(
            true
        );
        mockServerEnv.CALL_NOTES_CAPTURE_ENABLED = false;
        const disabled = await requireCaptureDevice(request(paired.token, "1.10.0"));
        if (disabled.success) throw new Error("Expected disabled capture to reject the device");
        expect(disabled.response.status).toBe(503);
        expect(await disabled.response.json()).toEqual({ error: "capture_disabled" });
    });
});
