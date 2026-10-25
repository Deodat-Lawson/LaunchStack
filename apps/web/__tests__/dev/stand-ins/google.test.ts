/**
 * The Google stand-in, driven over HTTP-shaped Requests the way the Drive
 * connector drives Google: consent → code → token → refresh, and the Drive v3
 * reads the sync makes. What matters most is that it keeps Google's scope
 * rules — a drive.file token sees only what was picked, and listing a picked
 * folder returns nothing that wasn't picked too; drive.readonly sees all.
 */
import mammoth from "mammoth";

import { handleGoogleRequest } from "~/app/dev/stand-ins/google/dispatch";
import {
    DRIVE_FILE_SCOPE,
    DRIVE_READONLY_SCOPE,
    googleWorld,
    resetGoogleWorld,
} from "~/app/dev/stand-ins/google/world";

const ORIGIN = "http://127.0.0.1:3031";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const BASE = `${ORIGIN}/dev/stand-ins/google`;
const REDIRECT = `${ORIGIN}/api/connectors/google/oauth/callback`;

function post(path: string, form: Record<string, string | string[]>, headers = {}) {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(form)) {
        for (const v of Array.isArray(value) ? value : [value]) body.append(key, v);
    }
    return handleGoogleRequest(
        new Request(`${BASE}${path}`, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
            body,
        })
    );
}

function get(path: string, token?: string) {
    return handleGoogleRequest(
        new Request(`${BASE}${path}`, {
            headers: token ? { authorization: `Bearer ${token}` } : {},
        })
    );
}

/** Consent with these scopes ticked, exchange the code, return the tokens. */
async function connect(scopes: string[]) {
    const consent = await post("/consent", {
        decision: "allow",
        client_id: "cid",
        redirect_uri: REDIRECT,
        state: "nonce-1",
        scope: scopes,
    });
    expect(consent.status).toBe(303);
    const back = new URL(consent.headers.get("location")!);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get("state")).toBe("nonce-1");
    const code = back.searchParams.get("code")!;

    const res = await post("/token", {
        grant_type: "authorization_code",
        code,
        client_id: "cid",
        client_secret: "sec",
        redirect_uri: REDIRECT,
    });
    expect(res.status).toBe(200);
    return (await res.json()) as {
        access_token: string;
        refresh_token: string;
        scope: string;
        id_token: string;
    };
}

async function childNames(token: string, folderId: string, driveId?: string) {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const extra = driveId ? `&corpora=drive&driveId=${driveId}` : "";
    const res = await get(`/drive/v3/files?q=${q}${extra}`, token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: { name: string }[] };
    return body.files.map(f => f.name).sort();
}

beforeEach(() => {
    resetGoogleWorld();
});

describe("Google stand-in OAuth", () => {
    it("issues tokens for the scopes ticked on the consent screen, and refreshes them", async () => {
        const tokens = await connect([DRIVE_FILE_SCOPE]);
        expect(tokens.scope.split(" ").sort()).toEqual(["email", DRIVE_FILE_SCOPE, "openid"]);
        const claims = JSON.parse(
            Buffer.from(tokens.id_token.split(".")[1]!, "base64url").toString("utf8")
        ) as { email: string };
        expect(claims.email).toBe("alex.rivera@example.com");

        const refreshed = await post("/token", {
            grant_type: "refresh_token",
            refresh_token: tokens.refresh_token,
            client_id: "cid",
            client_secret: "sec",
        });
        expect(refreshed.status).toBe(200);
        const body = (await refreshed.json()) as { access_token: string; refresh_token?: string };
        expect(body.access_token).not.toBe(tokens.access_token);
        expect(body.refresh_token).toBeUndefined();
    });

    it("answers a declined consent with access_denied, and a used code with invalid_grant", async () => {
        const declined = await post("/consent", {
            decision: "cancel",
            client_id: "cid",
            redirect_uri: REDIRECT,
            state: "s",
        });
        expect(new URL(declined.headers.get("location")!).searchParams.get("error")).toBe(
            "access_denied"
        );

        const reuse = await post("/token", {
            grant_type: "authorization_code",
            code: "4/never-issued",
            client_id: "cid",
            client_secret: "sec",
            redirect_uri: REDIRECT,
        });
        expect(reuse.status).toBe(400);
        expect(((await reuse.json()) as { error: string }).error).toBe("invalid_grant");
    });

    it("refuses to send a browser anywhere but this machine", async () => {
        const res = await post("/consent", {
            decision: "allow",
            client_id: "cid",
            redirect_uri: "https://evil.example/callback",
        });
        expect(res.status).toBe(400);
    });
});

describe("Google stand-in Drive scopes", () => {
    it("drive.file: a picked folder opens, but its listing holds only what was picked too", async () => {
        const { access_token } = await connect([DRIVE_FILE_SCOPE]);

        expect((await get("/drive/v3/files/sa-dataroom", access_token)).status).toBe(404);
        const grant = await handleGoogleRequest(
            new Request(`${BASE}/_standin/grant`, {
                method: "POST",
                headers: { authorization: `Bearer ${access_token}` },
                body: JSON.stringify({ ids: ["sa-dataroom"] }),
            })
        );
        expect(grant.status).toBe(200);

        expect((await get("/drive/v3/files/sa-dataroom", access_token)).status).toBe(200);
        expect(await childNames(access_token, "sa-dataroom")).toEqual([]);
        expect(
            (await get("/drive/v3/files/sa-readme/export?mimeType=text/markdown", access_token))
                .status
        ).toBe(404);
    });

    it("drive.readonly: the whole shared folder, its subfolders and the shared drive", async () => {
        const { access_token } = await connect([DRIVE_FILE_SCOPE, DRIVE_READONLY_SCOPE]);

        expect(await childNames(access_token, "sa-dataroom")).toEqual([
            "Cap table summary.csv",
            "Financials",
            "Legal",
            "Read me first",
        ]);
        expect(await childNames(access_token, "sa-financials")).toEqual([
            "Archive",
            "FY2027 operating plan",
            "Unit economics.md",
        ]);
        expect(await childNames(access_token, "sa-drive-team", "sa-drive-team")).toEqual([
            "Customer research",
        ]);

        const doc = await get(
            "/drive/v3/files/sa-readme/export?mimeType=text/markdown",
            access_token
        );
        expect(await doc.text()).toContain("# Read me first");
        // The connector asks for Word: a real .docx, headings kept as styles.
        const word = await get(
            `/drive/v3/files/sa-readme/export?mimeType=${encodeURIComponent(DOCX_MIME)}`,
            access_token
        );
        expect(word.headers.get("content-type")).toBe(DOCX_MIME);
        const html = await mammoth.convertToHtml({
            buffer: Buffer.from(await word.arrayBuffer()),
        });
        expect(html.value).toContain("<h1>Read me first</h1>");
        // Docs have no bytes of their own; Drive says to export them.
        expect((await get("/drive/v3/files/sa-readme?alt=media", access_token)).status).toBe(403);
        const csv = await get("/drive/v3/files/sa-captable?alt=media", access_token);
        expect(await csv.text()).toContain("holder,class,shares");
    });

    it("feeds later additions and edits through the changes feed", async () => {
        const { access_token } = await connect([DRIVE_FILE_SCOPE, DRIVE_READONLY_SCOPE]);
        const start = (await (
            await get("/drive/v3/changes/startPageToken", access_token)
        ).json()) as {
            startPageToken: string;
        };
        const quiet = (await (
            await get(`/drive/v3/changes?pageToken=${start.startPageToken}`, access_token)
        ).json()) as { changes: unknown[] };
        expect(quiet.changes).toHaveLength(0);

        await handleGoogleRequest(
            new Request(`${BASE}/_standin/action`, {
                method: "POST",
                body: JSON.stringify({
                    action: "add-file",
                    folderId: "sa-financials",
                    name: "Q3.md",
                }),
            })
        );
        const after = (await (
            await get(`/drive/v3/changes?pageToken=${start.startPageToken}`, access_token)
        ).json()) as { changes: { file: { name: string } }[] };
        expect(after.changes.map(c => c.file.name)).toEqual(["Q3.md"]);
        expect(await childNames(access_token, "sa-financials")).toContain("Q3.md");
    });

    it("rejects calls without a live token the way Drive does", async () => {
        expect((await get("/drive/v3/files/sa-readme")).status).toBe(401);
        const { access_token } = await connect([DRIVE_READONLY_SCOPE]);
        googleWorld().tokens[access_token]!.expiresAt = 0;
        expect((await get("/drive/v3/files/sa-readme", access_token)).status).toBe(401);
    });
});
