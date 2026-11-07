const mockReadAppcast = jest.fn();
const mockDownloadUpdate = jest.fn();
jest.mock("~/server/call-notes/capture-app-storage", () => ({
    readCaptureAppcast: (): unknown => mockReadAppcast(),
    downloadCaptureUpdate: (...args: unknown[]): unknown => mockDownloadUpdate(...args),
}));
const mockGetEngine = jest.fn();
const mockFindDevice = jest.fn();
const mockServerEnv: Record<string, unknown> = { CALL_NOTES_CAPTURE_ENABLED: true };

jest.mock("~/server/engine", () => ({
    getEngine: (): unknown => mockGetEngine(),
}));
jest.mock("~/env", () => ({
    get env() {
        return { server: mockServerEnv };
    },
}));

import { requireCaptureDevice } from "~/server/call-notes/device-auth";
import { compareCaptureVersions, isCaptureVersion } from "~/server/call-notes/capture-version";
import { GET as getAppcast } from "~/app/api/call-notes/devices/appcast.xml/route";
import { GET as getUpdate } from "~/app/api/call-notes/devices/updates/[file]/route";

describe("Capture application semantic versions", () => {
    it.each([
        "1.0.0",
        "0.0.0",
        "1.2.3-alpha.1",
        "1.2.3-rc.1+build.001",
        "1.2.3+arm64",
        "9007199254740993.0.0",
    ])("accepts the strict SemVer version %s", version => {
        expect(isCaptureVersion(version)).toBe(true);
    });

    it.each([
        "",
        "1",
        "1.2",
        "v1.2.3",
        "1.2.3.4",
        "01.2.3",
        "1.02.3",
        "1.2.03",
        "1.2.3-01",
        "1.2.3-alpha..1",
        "1.2.3-",
        "1.2.3+",
        "1.2.3+build..1",
        "1.2.3\n",
        " 1.2.3",
        "1.2.3 ",
    ])("rejects the non-SemVer version %j", version => {
        expect(isCaptureVersion(version)).toBe(false);
        expect(compareCaptureVersions(version, "1.0.0")).toBeNull();
    });

    it("compares numeric components numerically and follows SemVer prerelease precedence", () => {
        const ordered = [
            "1.0.0-alpha",
            "1.0.0-alpha.1",
            "1.0.0-alpha.beta",
            "1.0.0-beta",
            "1.0.0-beta.2",
            "1.0.0-beta.11",
            "1.0.0-rc.1",
            "1.0.0",
            "1.2.0",
            "1.10.0",
            "2.0.0",
        ];
        for (let index = 0; index < ordered.length - 1; index += 1) {
            expect(compareCaptureVersions(ordered[index]!, ordered[index + 1]!)).toBeLessThan(0);
            expect(compareCaptureVersions(ordered[index + 1]!, ordered[index]!)).toBeGreaterThan(0);
        }
        expect(compareCaptureVersions("1.2.3+build.1", "1.2.3+build.2")).toBe(0);
        expect(
            compareCaptureVersions("9007199254740993.0.0", "9007199254740992.0.0")
        ).toBeGreaterThan(0);
        expect(
            compareCaptureVersions("1.0.0-9007199254740993", "1.0.0-9007199254740992")
        ).toBeGreaterThan(0);
    });
});

describe("Capture device bearer authentication", () => {
    const token = `lsc_${"A".repeat(43)}`;

    function deviceRequest(
        version: string | null = "1.2.3",
        authorization = `Bearer ${token}`
    ): Request {
        const headers = new Headers({ Authorization: authorization });
        if (version !== null) headers.set("X-LaunchStack-Capture-Version", version);
        return new Request("https://capture.example.test/api/internal/call-notes/local", {
            headers,
        });
    }

    beforeEach(() => {
        jest.clearAllMocks();
        mockServerEnv.CALL_NOTES_CAPTURE_ENABLED = true;
        delete mockServerEnv.CALL_NOTES_MIN_APP_VERSION;
        const query = {
            from: jest.fn().mockReturnThis(),
            innerJoin: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            limit: (...args: unknown[]): unknown => mockFindDevice(...args),
        };
        mockGetEngine.mockReturnValue({ db: { select: () => query } });
        mockFindDevice.mockResolvedValue([
            { companyId: 42n, userId: "user_capture", deviceId: "device-1" },
        ]);
    });

    it("returns a string-id identity from the active device membership", async () => {
        expect(await requireCaptureDevice(deviceRequest())).toEqual({
            success: true,
            data: { companyId: "42", userId: "user_capture", deviceId: "device-1" },
        });
    });

    it.each([
        "",
        "Basic ignored",
        "Bearer plain-token",
        "Bearer lsc_short",
        "Bearer lsp_wrong-kind",
    ])("rejects malformed credentials without reading the database: %j", async authorization => {
        const result = await requireCaptureDevice(deviceRequest("1.2.3", authorization));
        expect(result.success).toBe(false);
        if (result.success) throw new Error("Expected authentication to fail");
        expect(result.response.status).toBe(401);
        expect(await result.response.json()).toEqual({ error: "unauthorized" });
        expect(mockGetEngine).not.toHaveBeenCalled();
    });

    it("rejects a credential with no active device membership", async () => {
        mockFindDevice.mockResolvedValue([]);
        const result = await requireCaptureDevice(deviceRequest());
        if (result.success) throw new Error("Expected unknown device to be rejected");
        expect(result.response.status).toBe(401);
        expect(await result.response.json()).toEqual({ error: "unauthorized" });
    });

    it("rejects capture while disabled before consulting credentials", async () => {
        mockServerEnv.CALL_NOTES_CAPTURE_ENABLED = false;
        const result = await requireCaptureDevice(deviceRequest());
        if (result.success) throw new Error("Expected disabled capture to fail");
        expect(result.response.status).toBe(503);
        expect(await result.response.json()).toEqual({ error: "capture_disabled" });
        expect(mockGetEngine).not.toHaveBeenCalled();
    });

    it.each(["1.2.2", "1.2.3-rc.1", "not-semver", null])(
        "requires an upgrade when a configured minimum is not met by %j",
        async version => {
            mockServerEnv.CALL_NOTES_MIN_APP_VERSION = "1.2.3";
            const result = await requireCaptureDevice(deviceRequest(version));
            if (result.success) throw new Error("Expected an upgrade requirement");
            expect(result.response.status).toBe(426);
            expect(await result.response.json()).toEqual({
                error: "upgrade_required",
                minVersion: "1.2.3",
            });
        }
    );

    it.each(["1.2.3", "1.2.3+arm64", "1.10.0", "2.0.0"])(
        "accepts a current or newer application version %s",
        async version => {
            mockServerEnv.CALL_NOTES_MIN_APP_VERSION = "1.2.3";
            expect((await requireCaptureDevice(deviceRequest(version))).success).toBe(true);
        }
    );

    it("does not disclose version requirements for an unknown token", async () => {
        mockServerEnv.CALL_NOTES_MIN_APP_VERSION = "2.0.0";
        mockFindDevice.mockResolvedValue([]);
        const result = await requireCaptureDevice(deviceRequest("1.0.0"));
        if (result.success) throw new Error("Expected an unknown token to fail");
        expect(result.response.status).toBe(401);
    });

    it("serves update artifacts to an outdated app while its capture requests require upgrade", async () => {
        mockServerEnv.CALL_NOTES_MIN_APP_VERSION = "2.0.0";
        const request = deviceRequest("1.0.0");
        mockReadAppcast.mockResolvedValue("<rss><channel/></rss>");
        mockDownloadUpdate.mockImplementation(() => new Response("signed update archive").body);
        const appcast = await getAppcast(request);
        expect(appcast.status).toBe(200);
        expect(await appcast.text()).toBe("<rss><channel/></rss>");
        const archive = await getUpdate(request, {
            params: Promise.resolve({ file: "LaunchStack-Capture-2.0.0-arm64.zip" }),
        });
        expect(archive.status).toBe(200);
        expect(await archive.text()).toBe("signed update archive");
        const capture = await requireCaptureDevice(request);
        if (capture.success) throw new Error("Expected capture to require an upgrade");
        expect(capture.response.status).toBe(426);
        mockFindDevice.mockResolvedValue([]);
        expect((await getAppcast(request)).status).toBe(401);
        expect(
            (
                await getUpdate(request, {
                    params: Promise.resolve({ file: "LaunchStack-Capture-2.0.0-arm64.zip" }),
                })
            ).status
        ).toBe(401);
    });

    it("keeps updates available when capture is disabled, but never bypasses device revocation", async () => {
        mockServerEnv.CALL_NOTES_CAPTURE_ENABLED = false;
        expect((await requireCaptureDevice(deviceRequest(), "update")).success).toBe(true);
        mockFindDevice.mockResolvedValue([]);
        const revoked = await requireCaptureDevice(deviceRequest(), "update");
        if (revoked.success) throw new Error("Expected a revoked device to fail");
        expect(revoked.response.status).toBe(401);
    });

    it.each([null, "not-semver"])(
        "still rejects malformed update-client versions: %j",
        async version => {
            const result = await requireCaptureDevice(deviceRequest(version), "update");
            if (result.success) throw new Error("Expected an invalid update client to fail");
            expect(result.response.status).toBe(401);
        }
    );

    it.each([null, "1.2", "v1.2.3"])(
        "requires the version header even without a configured minimum: %j",
        async version => {
            const result = await requireCaptureDevice(deviceRequest(version));
            if (result.success) throw new Error("Expected the version header to be required");
            expect(result.response.status).toBe(401);
            expect(await result.response.json()).toEqual({ error: "unauthorized" });
        }
    );
});
