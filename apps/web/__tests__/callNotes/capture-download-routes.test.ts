import { Readable } from "node:stream";

const mockWorkspacePermission = jest.fn();
const mockRequireCaptureDevice = jest.fn();
const mockIssuePairingCode = jest.fn();
const mockPairingCodeValid = jest.fn();
const mockBlobDownload = jest.fn();
const mockGetBlobClient = jest.fn();
const mockServerEnv: Record<string, unknown> = {
    CALL_NOTES_CAPTURE_ENABLED: true,
    CALL_NOTES_CAPTURE_APP_STORAGE_CONNECTION_STRING: "private-storage-connection",
    CALL_NOTES_CAPTURE_APP_CONTAINER: "capture-app",
};

jest.mock("server-only", () => ({}), { virtual: true });

jest.mock("~/env", () => ({
    get env() {
        return { server: mockServerEnv };
    },
}));

jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspacePermission: (...args: unknown[]): unknown => mockWorkspacePermission(...args),
}));

jest.mock("~/server/call-notes/capture-devices", () => ({
    issueCapturePairingCode: (...args: unknown[]): unknown => mockIssuePairingCode(...args),
    isCapturePairingCodeValid: (...args: unknown[]): unknown => mockPairingCodeValid(...args),
}));

jest.mock("~/server/call-notes/device-auth", () => ({
    requireCaptureDevice: (...args: unknown[]): unknown => mockRequireCaptureDevice(...args),
}));

jest.mock("@azure/storage-blob", () => ({
    BlobServiceClient: {
        fromConnectionString: () => ({
            getContainerClient: () => ({
                getBlobClient: (...args: unknown[]): unknown => mockGetBlobClient(...args),
            }),
        }),
    },
}));

import { POST as createDownload } from "~/app/api/call-notes/capture-app/downloads/route";
import { GET as downloadApp } from "~/app/api/call-notes/capture-app/d/[code]/[filename]/route";
import { GET as getAppcast } from "~/app/api/call-notes/devices/appcast.xml/route";
import { GET as getUpdate } from "~/app/api/call-notes/devices/updates/[file]/route";

const CODE = `lsp_${"p".repeat(32)}`;
const VERSION = "1.2.3";
const DMG_PATH = `releases/${VERSION}/LaunchStack-Capture-${VERSION}-arm64.dmg`;
const DMG_BYTES = Buffer.from([0x00, 0x01, 0xfe, 0xff]);
const mockBlobs = new Map<string, Uint8Array>();
let mockPairingGrant: {
    companyId: string;
    userId: string;
    expiresAt: number;
    consumedAt: number | null;
};
const originalAuthUrl = process.env.BETTER_AUTH_URL;
const originalInternalUrl = process.env.APP_PUBLIC_URL;

function request(path: string, init?: RequestInit): Request {
    return new Request(`http://0.0.0.0:3000${path}`, init);
}

function downloadParams(code = CODE, filename = "LaunchStack-Capture.dmg") {
    return { params: Promise.resolve({ code, filename }) };
}

beforeEach(() => {
    jest.clearAllMocks();
    process.env.BETTER_AUTH_URL = "https://calls.launchstack.example/workspace";
    process.env.APP_PUBLIC_URL = "http://app:3000";
    mockServerEnv.CALL_NOTES_CAPTURE_ENABLED = true;
    mockServerEnv.CALL_NOTES_CAPTURE_APP_STORAGE_CONNECTION_STRING = "private-storage-connection";
    mockWorkspacePermission.mockResolvedValue({
        success: true,
        data: { authUserId: "user-capture", companyId: 42n },
    });
    mockRequireCaptureDevice.mockResolvedValue({
        success: true,
        data: { companyId: "42", userId: "user-capture", deviceId: "device-capture" },
    });
    mockIssuePairingCode.mockResolvedValue(CODE);
    mockPairingGrant = {
        companyId: "42",
        userId: "user-capture",
        expiresAt: Date.now() + 60_000,
        consumedAt: null,
    };
    mockPairingCodeValid.mockImplementation(
        async (code: string, context: { companyId: string; userId: string }) =>
            code === CODE &&
            context.companyId === mockPairingGrant.companyId &&
            context.userId === mockPairingGrant.userId &&
            mockPairingGrant.expiresAt > Date.now() &&
            mockPairingGrant.consumedAt === null
    );
    mockBlobs.clear();
    mockBlobs.set("latest.json", Buffer.from(JSON.stringify({ version: VERSION, dmg: DMG_PATH })));
    mockBlobs.set(DMG_PATH, DMG_BYTES);
    mockGetBlobClient.mockImplementation((path: string) => ({
        download: (...args: unknown[]): unknown => mockBlobDownload(path, ...args),
    }));
    mockBlobDownload.mockImplementation(async (path: string) => {
        const bytes = mockBlobs.get(path);
        if (!bytes) throw Object.assign(new Error("Blob not found"), { statusCode: 404 });
        return { readableStreamBody: Readable.from([bytes.subarray(0, 2), bytes.subarray(2)]) };
    });
});

afterAll(() => {
    if (originalAuthUrl === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = originalAuthUrl;
    if (originalInternalUrl === undefined) delete process.env.APP_PUBLIC_URL;
    else process.env.APP_PUBLIC_URL = originalInternalUrl;
});

describe("Capture app session downloads", () => {
    it("issues a session-owned public-origin URL and streams the private DMG without a redirect", async () => {
        const issued = await createDownload(
            request("/api/call-notes/capture-app/downloads", {
                method: "POST",
                body: JSON.stringify({ companyId: "999", userId: "attacker" }),
            })
        );

        expect(issued.status).toBe(201);
        expect(await issued.json()).toEqual({
            code: CODE,
            downloadUrl: `https://calls.launchstack.example/api/call-notes/capture-app/d/${CODE}/LaunchStack-Capture.dmg`,
        });
        expect(mockIssuePairingCode).toHaveBeenCalledWith({
            companyId: "42",
            userId: "user-capture",
        });
        expect(mockWorkspacePermission).toHaveBeenCalledWith("documents.read");

        const response = await downloadApp(
            request(
                `/api/call-notes/capture-app/d/${CODE}/LaunchStack-Capture.dmg?companyId=999&userId=attacker`
            ),
            downloadParams()
        );

        expect(response.status).toBe(200);
        expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(
            Array.from(DMG_BYTES)
        );
        expect(response.headers.get("Content-Type")).toBe("application/x-apple-diskimage");
        expect(response.headers.get("Content-Disposition")).toBe(
            'attachment; filename="LaunchStack-Capture.dmg"'
        );
        expect(response.headers.get("Cache-Control")).toBe("private, no-store");
        expect(response.headers.get("Location")).toBeNull();
        expect(mockPairingCodeValid).toHaveBeenCalledWith(CODE, {
            companyId: "42",
            userId: "user-capture",
        });
        expect(mockBlobDownload).toHaveBeenCalledWith(DMG_PATH, 0);
        expect(mockPairingGrant.consumedAt).toBeNull();
    });
});

describe("Capture download ownership and availability", () => {
    it.each([401, 403])(
        "returns the session gate's %i response before issuing or reading a release",
        async status => {
            mockWorkspacePermission.mockImplementation(async () => ({
                success: false,
                response: Response.json({ error: "session_denied" }, { status }),
            }));

            expect(
                (
                    await createDownload(
                        request("/api/call-notes/capture-app/downloads", { method: "POST" })
                    )
                ).status
            ).toBe(status);
            expect((await downloadApp(request("/download"), downloadParams())).status).toBe(status);
            expect(mockIssuePairingCode).not.toHaveBeenCalled();
            expect(mockPairingCodeValid).not.toHaveBeenCalled();
            expect(mockGetBlobClient).not.toHaveBeenCalled();
        }
    );

    it.each([
        { name: "a different user", grant: { userId: "another-user" } },
        { name: "a different company", grant: { companyId: "999" } },
        { name: "an expired code", grant: { expiresAt: 0 } },
        { name: "a consumed code", grant: { consumedAt: 1 } },
    ])("denies $name without accessing Azure", async ({ grant }) => {
        Object.assign(mockPairingGrant, grant);

        const response = await downloadApp(request("/download"), downloadParams());

        expect(response.status).toBe(410);
        expect(await response.json()).toEqual({ error: "pairing_code_invalid" });
        expect(mockPairingCodeValid).toHaveBeenCalledWith(CODE, {
            companyId: "42",
            userId: "user-capture",
        });
        expect(mockGetBlobClient).not.toHaveBeenCalled();
    });

    it("denies an unknown pairing code without accessing Azure", async () => {
        const response = await downloadApp(request("/download"), downloadParams("lsp_unknown"));

        expect(response.status).toBe(410);
        expect(mockGetBlobClient).not.toHaveBeenCalled();
    });

    it("does not issue a pairing code when no release has been published", async () => {
        mockBlobs.delete("latest.json");

        const response = await createDownload(request("/downloads", { method: "POST" }));

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: "release_unavailable" });
        expect(mockIssuePairingCode).not.toHaveBeenCalled();
    });

    it.each(["latest.json", DMG_PATH])(
        "returns 404 instead of redirecting when %s is missing",
        async path => {
            mockBlobs.delete(path);

            const response = await downloadApp(request("/download"), downloadParams());

            expect(response.status).toBe(404);
            expect(response.headers.get("Location")).toBeNull();
        }
    );

    it("returns 404 for a malformed release manifest", async () => {
        mockBlobs.set(
            "latest.json",
            Buffer.from(
                JSON.stringify({
                    version: VERSION,
                    dmg: "../private.dmg",
                })
            )
        );

        const response = await downloadApp(request("/download"), downloadParams());

        expect(response.status).toBe(404);
        expect(mockGetBlobClient).toHaveBeenCalledTimes(1);
        expect(mockGetBlobClient).toHaveBeenCalledWith("latest.json");
    });

    it("only serves the canonical downloaded filename", async () => {
        const response = await downloadApp(request("/download"), downloadParams(CODE, "other.dmg"));

        expect(response.status).toBe(404);
        expect(mockPairingCodeValid).not.toHaveBeenCalled();
        expect(mockGetBlobClient).not.toHaveBeenCalled();
    });

    it("does not issue codes or expose release bytes while Capture is disabled", async () => {
        mockServerEnv.CALL_NOTES_CAPTURE_ENABLED = false;

        expect((await createDownload(request("/downloads", { method: "POST" }))).status).toBe(503);
        expect((await downloadApp(request("/download"), downloadParams())).status).toBe(503);
        expect(mockIssuePairingCode).not.toHaveBeenCalled();
        expect(mockGetBlobClient).not.toHaveBeenCalled();
    });
});

describe("Capture Sparkle appcast", () => {
    it("authenticates a device and replaces every origin placeholder with the public origin", async () => {
        const appcast =
            '<?xml version="1.0"?><rss><channel><link>__LAUNCHSTACK_ORIGIN__</link><enclosure url="__LAUNCHSTACK_ORIGIN__/api/call-notes/devices/updates/LaunchStack-Capture-1.2.3-arm64.zip" /></channel></rss>';
        mockBlobs.set("appcast.xml", Buffer.from(appcast));
        const incoming = request("/api/call-notes/devices/appcast.xml", {
            headers: {
                Authorization: "Bearer lsc_device-token",
                "X-LaunchStack-Capture-Version": VERSION,
            },
        });

        const response = await getAppcast(incoming);

        expect(response.status).toBe(200);
        expect(await response.text()).toBe(
            appcast.replaceAll("__LAUNCHSTACK_ORIGIN__", "https://calls.launchstack.example")
        );
        expect(response.headers.get("Content-Type")).toBe("application/xml; charset=utf-8");
        expect(response.headers.get("Cache-Control")).toBe("private, no-store");
        expect(mockRequireCaptureDevice).toHaveBeenCalledWith(incoming);
        expect(mockWorkspacePermission).not.toHaveBeenCalled();
        expect(mockGetBlobClient).toHaveBeenCalledWith("appcast.xml");
    });

    it("escapes XML special characters in the substituted origin", async () => {
        process.env.BETTER_AUTH_URL = "https://calls&notes.example";
        mockBlobs.set(
            "appcast.xml",
            Buffer.from('<enclosure url="__LAUNCHSTACK_ORIGIN__/update.zip" />')
        );

        const response = await getAppcast(request("/appcast.xml"));

        expect(response.status).toBe(200);
        expect(await response.text()).toBe(
            '<enclosure url="https://calls&amp;notes.example/update.zip" />'
        );
    });

    it.each([401, 426, 503])(
        "passes through device auth's %i without contacting Azure",
        async status => {
            const denied = Response.json(
                { error: status === 426 ? "upgrade_required" : "unauthorized" },
                { status }
            );
            mockRequireCaptureDevice.mockResolvedValue({ success: false, response: denied });

            expect(await getAppcast(request("/appcast.xml"))).toBe(denied);
            expect(mockGetBlobClient).not.toHaveBeenCalled();
        }
    );

    it("returns 404 when no appcast has been published", async () => {
        const response = await getAppcast(request("/appcast.xml"));

        expect(response.status).toBe(404);
    });
});

describe("Capture Sparkle update archives", () => {
    it.each(["1.2.3", "2.0.0-rc.1", "2.0.0+build.7"])(
        "streams version %s from only its canonical private release path",
        async version => {
            const file = `LaunchStack-Capture-${version}-arm64.zip`;
            const path = `releases/${version}/${file}`;
            const bytes = Buffer.from([0x50, 0x4b, 0x00, 0xff]);
            mockBlobs.set(path, bytes);
            const incoming = request(`/api/call-notes/devices/updates/${file}`, {
                headers: {
                    Authorization: "Bearer lsc_device-token",
                    "X-LaunchStack-Capture-Version": VERSION,
                },
            });

            const response = await getUpdate(incoming, { params: Promise.resolve({ file }) });

            expect(response.status).toBe(200);
            expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(
                Array.from(bytes)
            );
            expect(response.headers.get("Content-Type")).toBe("application/zip");
            expect(response.headers.get("Content-Disposition")).toBe(
                `attachment; filename="${file}"`
            );
            expect(response.headers.get("Cache-Control")).toBe("private, no-store");
            expect(response.headers.get("Location")).toBeNull();
            expect(mockRequireCaptureDevice).toHaveBeenCalledWith(incoming);
            expect(mockWorkspacePermission).not.toHaveBeenCalled();
            expect(mockGetBlobClient).toHaveBeenCalledTimes(1);
            expect(mockGetBlobClient).toHaveBeenCalledWith(path);
            expect(mockBlobDownload).toHaveBeenCalledWith(path, 0);
        }
    );

    it.each([401, 426, 503])(
        "passes through device auth's %i before accessing an archive",
        async status => {
            const denied = Response.json(
                { error: status === 426 ? "upgrade_required" : "unauthorized" },
                { status }
            );
            mockRequireCaptureDevice.mockResolvedValue({ success: false, response: denied });

            const response = await getUpdate(request("/update.zip"), {
                params: Promise.resolve({ file: "LaunchStack-Capture-1.2.3-arm64.zip" }),
            });

            expect(response).toBe(denied);
            expect(mockGetBlobClient).not.toHaveBeenCalled();
        }
    );

    it.each([
        "../LaunchStack-Capture-1.2.3-arm64.zip",
        "releases/1.2.3/LaunchStack-Capture-1.2.3-arm64.zip",
        "LaunchStack-Capture-../1.2.3-arm64.zip",
        "LaunchStack-Capture-..\\1.2.3-arm64.zip",
        "LaunchStack-Capture-1.2.3%2f..-arm64.zip",
        "LaunchStack-Capture-1.2.3-arm64.zip/..",
        "LaunchStack-Capture-1.2-arm64.zip",
        "LaunchStack-Capture-v1.2.3-arm64.zip",
        "LaunchStack-Capture-01.2.3-arm64.zip",
        "LaunchStack-Capture-1.2.3-01-arm64.zip",
        "LaunchStack-Capture-1.2.3+-arm64.zip",
        "LaunchStack-Capture-1.2.3-arm64.dmg",
        "LaunchStack-Capture-1.2.3-x64.zip",
        "LaunchStack-Capture-1.2.3-arm64.zip\n",
        "appcast.xml",
        "latest.json",
    ])(
        "rejects the non-canonical or invalid archive filename %j without reading a blob",
        async file => {
            const response = await getUpdate(request("/update.zip"), {
                params: Promise.resolve({ file }),
            });

            expect(response.status).toBe(404);
            expect(mockGetBlobClient).not.toHaveBeenCalled();
        }
    );

    it("returns 404 for a valid archive filename whose release has not been published", async () => {
        const file = "LaunchStack-Capture-9.9.9-arm64.zip";

        const response = await getUpdate(request("/update.zip"), {
            params: Promise.resolve({ file }),
        });

        expect(response.status).toBe(404);
        expect(mockGetBlobClient).toHaveBeenCalledWith(`releases/9.9.9/${file}`);
    });
});
