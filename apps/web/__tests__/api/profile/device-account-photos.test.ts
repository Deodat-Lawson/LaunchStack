/**
 * The account menu shows each signed-in account's own profile photo. The
 * accounts come from the browser's signed session cookies (Better Auth
 * verifies them); nothing the client sends picks whose photos it gets.
 */
jest.mock("~/server/db", () => ({
    db: jest.requireActual("../../helpers/fake-db").fakeDb.db,
}));
const mockDeviceAccounts = jest.fn<Promise<string[]>, [Headers]>();
jest.mock("~/server/auth", () => ({
    deviceAccountUserIds: (headers: Headers) => mockDeviceAccounts(headers),
}));
const mockIdentity = jest.fn();
jest.mock("~/lib/require-workspace-context", () => ({
    requireAuthIdentity: () => mockIdentity(),
}));
const mockGlobalPhotos = jest.fn();
const mockReadImage = jest.fn();
const mockCanView = jest.fn();
const mockAuthUserIdOf = jest.fn();
jest.mock("~/server/profile/store", () => ({
    globalPhotoUrls: (ids: string[]) => mockGlobalPhotos(ids),
    readProfileImage: (id: string) => mockReadImage(id),
    canViewProfileImage: (...args: unknown[]) => mockCanView(...args),
    authUserIdOf: (pk: bigint) => mockAuthUserIdOf(pk),
}));

import { GET as PHOTOS } from "~/app/api/profile/device-photos/route";
import { GET as IMAGE } from "~/app/api/profile-images/[id]/route";
import { users } from "~/server/db/schema";

import { fakeDb } from "../../helpers/fake-db";

const IMAGE_ID = "abcdefghijklmnopqrstuv";

beforeEach(() => {
    fakeDb.reset();
    jest.clearAllMocks();
    mockIdentity.mockResolvedValue({ success: true, data: { authUserId: "auth-ann" } });
});

describe("GET /api/profile/device-photos", () => {
    it("answers for the accounts in this browser's cookies, and only those", async () => {
        mockDeviceAccounts.mockResolvedValue(["auth-ann", "auth-bob"]);
        mockGlobalPhotos.mockResolvedValue(
            new Map([
                ["auth-ann", "/api/profile-images/ann"],
                ["auth-bob", null],
            ])
        );

        const res = await PHOTOS(
            new Request("http://localhost/api/profile/device-photos?user=auth-eve", {
                headers: { cookie: "better-auth.session_token=x" },
            })
        );

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({
            photos: { "auth-ann": "/api/profile-images/ann", "auth-bob": null },
        });
        // The query string named someone else; it was never consulted.
        expect(mockGlobalPhotos).toHaveBeenCalledWith(["auth-ann", "auth-bob"]);
        expect(mockDeviceAccounts.mock.calls[0]![0].get("cookie")).toContain("session_token");
    });

    it("answers 401 to a browser with no signed-in accounts", async () => {
        mockDeviceAccounts.mockResolvedValue([]);

        const res = await PHOTOS(new Request("http://localhost/api/profile/device-photos"));

        expect(res.status).toBe(401);
        expect(mockGlobalPhotos).not.toHaveBeenCalled();
    });
});

describe("GET /api/profile-images/[id] for another account in this browser", () => {
    const params = { params: Promise.resolve({ id: IMAGE_ID }) };
    const request = () => new Request(`http://localhost/api/profile-images/${IMAGE_ID}`);

    beforeEach(() => {
        fakeDb.onSelect(users, [{ id: 1 }]);
        mockCanView.mockResolvedValue(false);
        mockAuthUserIdOf.mockResolvedValue("auth-bob");
    });

    it("shows someone's own photo when they are signed in here too", async () => {
        mockReadImage.mockResolvedValue({
            id: IMAGE_ID,
            userId: 2n,
            companyId: null,
            mimeType: "image/webp",
            data: Buffer.from("img"),
        });
        mockDeviceAccounts.mockResolvedValue(["auth-ann", "auth-bob"]);

        const res = await IMAGE(request(), params);

        expect(res.status).toBe(200);
    });

    it("still hides it from a browser where they aren't signed in", async () => {
        mockReadImage.mockResolvedValue({
            id: IMAGE_ID,
            userId: 2n,
            companyId: null,
            mimeType: "image/webp",
            data: Buffer.from("img"),
        });
        mockDeviceAccounts.mockResolvedValue(["auth-ann"]);

        const res = await IMAGE(request(), params);

        expect(res.status).toBe(404);
    });

    it("never extends to a workspace photo", async () => {
        mockReadImage.mockResolvedValue({
            id: IMAGE_ID,
            userId: 2n,
            companyId: 50n,
            mimeType: "image/webp",
            data: Buffer.from("img"),
        });
        mockDeviceAccounts.mockResolvedValue(["auth-ann", "auth-bob"]);

        const res = await IMAGE(request(), params);

        expect(res.status).toBe(404);
        expect(mockDeviceAccounts).not.toHaveBeenCalled();
    });
});
