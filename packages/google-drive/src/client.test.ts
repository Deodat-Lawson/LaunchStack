import { afterEach, describe, expect, it, vi } from "vitest";

import {
    GoogleAuthError,
    GoogleDriveError,
    buildAuthorizationUrl,
    createFileMultipart,
    decodeIdTokenClaims,
    downloadFileContent,
    ensureFolder,
    exchangeAuthorizationCode,
    getFileMetadata,
    refreshAccessToken,
    updateFileMedia,
} from "./client";

const APP = { clientId: "cid", clientSecret: "secret" };

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function mockFetch(...responses: Response[]) {
    const fn = vi.fn();
    for (const res of responses) fn.mockResolvedValueOnce(res);
    vi.stubGlobal("fetch", fn);
    return fn;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("token endpoints", () => {
    it("exchanges an authorization code as form-encoded POST", async () => {
        const fetchMock = mockFetch(
            jsonResponse({ access_token: "at", expires_in: 3599, refresh_token: "rt" })
        );

        const token = await exchangeAuthorizationCode({
            app: APP,
            code: "the-code",
            redirectUri: "https://app.example/cb",
        });

        expect(token.access_token).toBe("at");
        expect(token.refresh_token).toBe("rt");
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://oauth2.googleapis.com/token");
        const body = init.body as string;
        expect(body).toContain("grant_type=authorization_code");
        expect(body).toContain("code=the-code");
    });

    it("flags invalid_grant as a revoked connection", async () => {
        mockFetch(
            jsonResponse({ error: "invalid_grant", error_description: "Token revoked" }, 400)
        );

        const err = await refreshAccessToken({ app: APP, refreshToken: "rt" }).catch(e => e);
        expect(err).toBeInstanceOf(GoogleAuthError);
        expect((err as GoogleAuthError).invalidGrant).toBe(true);
        expect((err as GoogleAuthError).detail).toContain("Token revoked");
    });

    it("does not flag transient token failures as revocation", async () => {
        mockFetch(jsonResponse({ error: "internal_failure" }, 500));

        const err = await refreshAccessToken({ app: APP, refreshToken: "rt" }).catch(e => e);
        expect(err).toBeInstanceOf(GoogleAuthError);
        expect((err as GoogleAuthError).invalidGrant).toBe(false);
        expect((err as GoogleAuthError).isRetryable).toBe(true);
    });
});

describe("decodeIdTokenClaims", () => {
    it("reads sub and email from the payload segment", () => {
        const payload = Buffer.from(
            JSON.stringify({ sub: "108", email: "founder@example.com" })
        ).toString("base64url");
        expect(decodeIdTokenClaims(`h.${payload}.s`)).toEqual({
            sub: "108",
            email: "founder@example.com",
        });
    });

    it("returns empty claims for garbage input", () => {
        expect(decodeIdTokenClaims("not-a-jwt")).toEqual({});
    });
});

describe("drive files", () => {
    it("requests the sync pipeline's metadata fields", async () => {
        const fetchMock = mockFetch(
            jsonResponse({
                id: "f1",
                mimeType: "application/pdf",
                headRevisionId: "rev9",
                version: "42",
                trashed: false,
            })
        );

        const meta = await getFileMetadata({ accessToken: "at", fileId: "f1" });
        expect(meta.headRevisionId).toBe("rev9");
        const [url] = fetchMock.mock.calls[0] as [string];
        expect(url).toContain("/drive/v3/files/f1?fields=");
        expect(decodeURIComponent(url)).toContain("headRevisionId");
        expect(decodeURIComponent(url)).toContain("md5Checksum");
    });

    it("maps 404 to isNotFound for the orphan flow", async () => {
        mockFetch(jsonResponse({ error: { code: 404, message: "File not found" } }, 404));

        const err = await getFileMetadata({ accessToken: "at", fileId: "gone" }).catch(e => e);
        expect(err).toBeInstanceOf(GoogleDriveError);
        expect((err as GoogleDriveError).isNotFound).toBe(true);
        expect((err as GoogleDriveError).isRetryable).toBe(false);
    });

    it("marks 429 as retryable for the reconciler", async () => {
        mockFetch(jsonResponse({ error: { code: 429, message: "Rate limited" } }, 429));

        const err = await downloadFileContent({ accessToken: "at", fileId: "f1" }).catch(e => e);
        expect((err as GoogleDriveError).isRetryable).toBe(true);
    });

    it("uploads multipart with metadata and media parts", async () => {
        const fetchMock = mockFetch(
            jsonResponse({ id: "new1", mimeType: "application/pdf", headRevisionId: "r1" })
        );

        const meta = await createFileMultipart({
            accessToken: "at",
            name: "contract.pdf",
            mimeType: "application/pdf",
            data: Buffer.from("PDFBYTES"),
            parents: ["folder1"],
        });

        expect(meta.id).toBe("new1");
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toContain("uploadType=multipart");
        const headers = init.headers as Record<string, string>;
        expect(headers["Content-Type"]).toContain("multipart/related; boundary=");
        const body = Buffer.from(init.body as Uint8Array).toString("utf8");
        expect(body).toContain('"name":"contract.pdf"');
        expect(body).toContain('"parents":["folder1"]');
        expect(body).toContain("PDFBYTES");
    });

    it("pushes in-place updates via uploadType=media PATCH", async () => {
        const fetchMock = mockFetch(
            jsonResponse({ id: "f1", mimeType: "application/pdf", headRevisionId: "r2" })
        );

        const meta = await updateFileMedia({
            accessToken: "at",
            fileId: "f1",
            mimeType: "application/pdf",
            data: Buffer.from("v2"),
        });

        expect(meta.headRevisionId).toBe("r2");
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toContain("/upload/drive/v3/files/f1?uploadType=media");
        expect(init.method).toBe("PATCH");
    });

    it("reuses an existing folder before creating one", async () => {
        const fetchMock = mockFetch(
            jsonResponse({
                files: [{ id: "fold1", mimeType: "application/vnd.google-apps.folder" }],
            })
        );

        const id = await ensureFolder({ accessToken: "at", name: "LaunchStack" });
        expect(id).toBe("fold1");
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("creates the folder when the search comes back empty", async () => {
        const fetchMock = mockFetch(jsonResponse({ files: [] }), jsonResponse({ id: "made1" }));

        const id = await ensureFolder({ accessToken: "at", name: "LaunchStack" });
        expect(id).toBe("made1");
        expect(fetchMock).toHaveBeenCalledTimes(2);
        const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
        expect(init.method).toBe("POST");
    });
});

describe("buildAuthorizationUrl", () => {
    it("always requests offline access with forced consent", () => {
        const url = buildAuthorizationUrl({
            clientId: "cid",
            redirectUri: "https://app.example/cb",
            scopes: ["https://www.googleapis.com/auth/drive.file", "openid", "email"],
            state: "abc",
        });
        expect(url).toContain("access_type=offline");
        expect(url).toContain("prompt=consent");
        expect(url).toContain("state=abc");
        const scope = new URL(url).searchParams.get("scope");
        expect(scope).toBe("https://www.googleapis.com/auth/drive.file openid email");
    });
});
