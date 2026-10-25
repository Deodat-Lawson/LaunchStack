import { Readable } from "node:stream";

const mockBlobDownload = jest.fn();
const mockGetBlobClient = jest.fn();
const mockGetContainerClient = jest.fn();
const mockFromConnectionString = jest.fn();
const mockServerEnv: Record<string, unknown> = {
    CALL_NOTES_CAPTURE_APP_STORAGE_CONNECTION_STRING: "private-storage-connection",
    CALL_NOTES_CAPTURE_APP_CONTAINER: "capture-app",
};

jest.mock("server-only", () => ({}), { virtual: true });

jest.mock("~/env", () => ({
    get env() {
        return { server: mockServerEnv };
    },
}));

jest.mock("@azure/storage-blob", () => ({
    BlobServiceClient: {
        fromConnectionString: (...args: unknown[]): unknown => mockFromConnectionString(...args),
    },
}));

import {
    downloadLatestCaptureApp,
    getLatestCaptureRelease,
} from "~/server/call-notes/capture-app-storage";

const VERSION = "1.2.3";
const DMG_PATH = `releases/${VERSION}/LaunchStack-Capture-${VERSION}-arm64.dmg`;
const mockBlobs = new Map<string, Uint8Array>();

beforeEach(() => {
    jest.clearAllMocks();
    mockServerEnv.CALL_NOTES_CAPTURE_APP_STORAGE_CONNECTION_STRING = "private-storage-connection";
    mockBlobs.clear();
    mockBlobs.set("latest.json", Buffer.from(JSON.stringify({ version: VERSION, dmg: DMG_PATH })));
    mockBlobs.set(DMG_PATH, Buffer.from([0x00, 0x01, 0xfe, 0xff]));
    mockFromConnectionString.mockReturnValue({ getContainerClient: mockGetContainerClient });
    mockGetContainerClient.mockReturnValue({ getBlobClient: mockGetBlobClient });
    mockGetBlobClient.mockImplementation((path: string) => ({
        download: (...args: unknown[]): unknown => mockBlobDownload(path, ...args),
    }));
    mockBlobDownload.mockImplementation(async (path: string) => {
        const bytes = mockBlobs.get(path);
        if (!bytes) throw Object.assign(new Error("Blob not found"), { statusCode: 404 });
        return { readableStreamBody: Readable.from([bytes]) };
    });
});

describe("private Capture app release storage", () => {
    it("reads the published manifest and streams the DMG bytes through the Azure client", async () => {
        expect(await getLatestCaptureRelease()).toEqual({ version: VERSION, dmg: DMG_PATH });

        const stream = await downloadLatestCaptureApp();
        expect(stream).not.toBeNull();
        expect(Array.from(new Uint8Array(await new Response(stream).arrayBuffer()))).toEqual([
            0x00, 0x01, 0xfe, 0xff,
        ]);
        expect(mockFromConnectionString).toHaveBeenCalledWith("private-storage-connection");
        expect(mockGetContainerClient).toHaveBeenCalledWith("capture-app");
        expect(mockBlobDownload).toHaveBeenCalledWith(DMG_PATH, 0);
    });
});

describe("Capture release manifest validation", () => {
    it.each([
        { version: "01.2.3", dmg: "releases/01.2.3/LaunchStack-Capture-01.2.3-arm64.dmg" },
        { version: "1.2", dmg: DMG_PATH },
        { version: "../1.2.3", dmg: DMG_PATH },
        { version: VERSION },
        { version: VERSION, dmg: "https://public.example/capture.dmg" },
        { version: VERSION, dmg: "../LaunchStack-Capture.dmg" },
        { version: VERSION, dmg: "releases/2.0.0/LaunchStack-Capture-2.0.0-arm64.dmg" },
        { version: VERSION, dmg: `releases/${VERSION}/other.dmg` },
        { version: VERSION, dmg: `${DMG_PATH}/../private` },
        { version: VERSION, dmg: DMG_PATH.replace(".dmg", ".zip") },
    ])("does not open an invalid manifest's DMG path: %j", async manifest => {
        mockBlobs.set("latest.json", Buffer.from(JSON.stringify(manifest)));

        expect(await downloadLatestCaptureApp()).toBeNull();
        expect(mockGetBlobClient).toHaveBeenCalledTimes(1);
        expect(mockGetBlobClient).toHaveBeenCalledWith("latest.json");
    });

    it("accepts strict SemVer prerelease and build identifiers in the canonical release path", async () => {
        const version = "2.0.0-rc.1+build.7";
        const dmg = `releases/${version}/LaunchStack-Capture-${version}-arm64.dmg`;
        mockBlobs.set("latest.json", Buffer.from(JSON.stringify({ version, dmg })));
        mockBlobs.set(dmg, Buffer.from("prerelease-dmg"));

        const stream = await downloadLatestCaptureApp();
        expect(await new Response(stream).text()).toBe("prerelease-dmg");
        expect(mockGetBlobClient).toHaveBeenCalledWith(dmg);
    });

    it("treats an unpublished latest manifest as unavailable", async () => {
        mockBlobs.delete("latest.json");

        expect(await getLatestCaptureRelease()).toBeNull();
    });

    it("treats a missing DMG as unavailable", async () => {
        mockBlobs.delete(DMG_PATH);

        expect(await downloadLatestCaptureApp()).toBeNull();
    });

    it("treats malformed manifest JSON as unavailable", async () => {
        mockBlobs.set("latest.json", Buffer.from("{"));

        expect(await getLatestCaptureRelease()).toBeNull();
    });

    it("does not contact Azure when private storage is not configured", async () => {
        mockServerEnv.CALL_NOTES_CAPTURE_APP_STORAGE_CONNECTION_STRING = undefined;

        expect(await downloadLatestCaptureApp()).toBeNull();
        expect(mockGetBlobClient).not.toHaveBeenCalled();
    });

    it("preserves Azure failures other than a missing blob", async () => {
        const error = Object.assign(new Error("Storage unavailable"), { statusCode: 503 });
        mockBlobDownload.mockRejectedValue(error);

        await expect(getLatestCaptureRelease()).rejects.toBe(error);
    });
});
