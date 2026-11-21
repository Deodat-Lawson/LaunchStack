/**
 * The Microsoft stand-in, driven over HTTP-shaped Requests the way the
 * OneDrive / SharePoint and Outlook connectors drive Entra and Graph:
 * consent → code → token → refresh, then the Graph reads a sync makes. What
 * matters most is the behaviour a sync depends on: scopes, absolute nextLink
 * paging, cTag / eTag movement, and message delta with removals and expiry.
 */
import mammoth from "mammoth";
import { PDFDocument } from "pdf-lib";
import * as XLSX from "xlsx";

import { handleMicrosoftRequest } from "~/app/dev/stand-ins/microsoft/dispatch";
import { quickXorHash } from "~/app/dev/stand-ins/microsoft/office";
import {
    CLIENTS_DRIVE_ID,
    CLIENTS_SITE_ID,
    MORGAN,
    PRIYA,
    SAMPLE_SHARING_URL,
    TENANT_ID,
    addFile,
    addMessage,
    deleteItem,
    deleteMessage,
    editFile,
    invalidateDeltaTokens,
    microsoftWorld,
    renameItem,
    resetMicrosoftWorld,
    revokeGrants,
} from "~/app/dev/stand-ins/microsoft/world";

const ORIGIN = "http://127.0.0.1:3031";
const BASE = `${ORIGIN}/dev/stand-ins/microsoft`;
const GRAPH = `${BASE}/graph/v1.0`;
const REDIRECT = `${ORIGIN}/api/connectors/microsoft/oauth/callback`;
const TOKEN_PATH = `/${TENANT_ID}/oauth2/v2.0/token`;

const FILES = ["openid", "profile", "email", "offline_access", "Files.Read.All", "Sites.Read.All"];
const MAIL = ["openid", "offline_access", "Mail.Read"];

function post(path: string, form: Record<string, string>) {
    return handleMicrosoftRequest(
        new Request(`${BASE}${path}`, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams(form),
        })
    );
}

/** GET a Graph path, or a full URL the stand-in handed back (nextLink, deltaLink). */
function graph(pathOrUrl: string, token?: string, headers: Record<string, string> = {}) {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${GRAPH}${pathOrUrl}`;
    return handleMicrosoftRequest(
        new Request(url, {
            headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
        })
    );
}

async function graphJson<T>(pathOrUrl: string, token: string, headers?: Record<string, string>) {
    const res = await graph(pathOrUrl, token, headers);
    expect(res.status).toBe(200);
    return (await res.json()) as T;
}

interface Tokens {
    access_token: string;
    refresh_token?: string;
    scope: string;
    id_token: string;
    token_type: string;
    expires_in: number;
}

/** Allow on the consent screen as `oid`, exchange the code, return the tokens. */
async function connect(scopes: string[], oid = MORGAN.oid): Promise<Tokens> {
    const consent = await post("/consent", {
        decision: "allow",
        client_id: "cid",
        redirect_uri: REDIRECT,
        state: "nonce-1",
        scope: scopes.join(" "),
        account: oid,
    });
    expect(consent.status).toBe(303);
    const back = new URL(consent.headers.get("location")!);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get("state")).toBe("nonce-1");

    const res = await post(TOKEN_PATH, {
        grant_type: "authorization_code",
        code: back.searchParams.get("code")!,
        client_id: "cid",
        client_secret: "sec",
        redirect_uri: REDIRECT,
    });
    expect(res.status).toBe(200);
    return (await res.json()) as Tokens;
}

function refresh(refreshToken: string) {
    return post("/common/oauth2/v2.0/token", {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: "cid",
        client_secret: "sec",
    });
}

interface DriveItem {
    id: string;
    name: string;
    size: number;
    eTag: string;
    cTag: string;
    lastModifiedDateTime: string;
    webUrl: string;
    parentReference: { driveId: string; id?: string; path?: string };
    file?: { mimeType: string; hashes: { quickXorHash: string } };
    folder?: { childCount: number };
    package?: { type: string };
}

interface Page<T> {
    value: T[];
    "@odata.nextLink"?: string;
    "@odata.deltaLink"?: string;
}

/** Follow nextLinks to the end; returns every entry, the page count and the final page. */
async function drain<T>(first: string, token: string, headers?: Record<string, string>) {
    const all: T[] = [];
    let pages = 0;
    let url: string | undefined = first;
    let last: Page<T> | undefined;
    while (url) {
        last = await graphJson<Page<T>>(url, token, headers);
        all.push(...last.value);
        pages += 1;
        url = last["@odata.nextLink"];
    }
    return { all, pages, last: last! };
}

const item = (id: string, driveId = MORGAN.driveId) =>
    `/drives/${encodeURIComponent(driveId)}/items/${id}`;

beforeEach(() => {
    resetMicrosoftWorld();
});

describe("Microsoft stand-in OAuth", () => {
    it("runs code → token → refresh for the account chosen on the consent screen", async () => {
        const tokens = await connect(FILES);
        expect(tokens.token_type).toBe("Bearer");
        expect(tokens.expires_in).toBe(3600);
        expect(tokens.scope.split(" ")).toEqual(
            expect.arrayContaining(["Files.Read.All", "Sites.Read.All", "openid"])
        );
        expect(tokens.refresh_token).toBeDefined();
        const claims = JSON.parse(
            Buffer.from(tokens.id_token.split(".")[1]!, "base64url").toString("utf8")
        ) as Record<string, string>;
        expect(claims).toMatchObject({
            oid: MORGAN.oid,
            tid: TENANT_ID,
            email: "morgan.ellis@harlowreed.example",
            preferred_username: "morgan.ellis@harlowreed.example",
            name: "Morgan Ellis",
        });

        const refreshed = await refresh(tokens.refresh_token!);
        expect(refreshed.status).toBe(200);
        const body = (await refreshed.json()) as Tokens;
        expect(body.access_token).not.toBe(tokens.access_token);
        expect(body.refresh_token).toBe(tokens.refresh_token);
        const me = await graphJson<{ mail: string }>("/me", body.access_token);
        expect(me.mail).toBe(MORGAN.email);
    });

    it("signs in the other account, and accepts scopes written as Graph URLs", async () => {
        const tokens = await connect(
            ["https://graph.microsoft.com/Files.Read.All", "offline_access"],
            PRIYA.oid
        );
        expect(tokens.scope).toBe("Files.Read.All");
        const me = await graphJson<Record<string, string>>("/me", tokens.access_token);
        expect(me).toMatchObject({
            id: PRIYA.oid,
            displayName: "Priya Nair",
            mail: PRIYA.email,
            userPrincipalName: PRIYA.email,
        });
        // Her own OneDrive opens; Morgan's does not.
        const drive = await graphJson<{ id: string; driveType: string }>(
            "/me/drive",
            tokens.access_token
        );
        expect(drive).toMatchObject({ id: PRIYA.driveId, driveType: "business" });
        const other = await graph(
            `/drives/${encodeURIComponent(MORGAN.driveId)}/root`,
            tokens.access_token
        );
        expect(other.status).toBe(403);
    });

    it("gives no refresh token unless offline_access was asked for", async () => {
        const tokens = await connect(["openid", "Mail.Read"]);
        expect(tokens.refresh_token).toBeUndefined();
    });

    it("answers a revoked grant with invalid_grant, and kills its access tokens", async () => {
        const tokens = await connect(FILES);
        revokeGrants(microsoftWorld());
        const res = await refresh(tokens.refresh_token!);
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string; error_description: string };
        expect(body.error).toBe("invalid_grant");
        expect(body.error_description).toEqual(expect.any(String));
        expect((await graph("/me", tokens.access_token)).status).toBe(401);
    });

    it("answers a declined consent with access_denied, and a bad code with invalid_grant", async () => {
        const declined = await post("/consent", {
            decision: "cancel",
            client_id: "cid",
            redirect_uri: REDIRECT,
            state: "s",
        });
        const back = new URL(declined.headers.get("location")!);
        expect(back.searchParams.get("error")).toBe("access_denied");
        expect(back.searchParams.get("error_description")).toBeTruthy();
        expect(back.searchParams.get("state")).toBe("s");

        const reuse = await post(TOKEN_PATH, {
            grant_type: "authorization_code",
            code: "never-issued",
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

describe("Microsoft stand-in Graph access", () => {
    it("answers 401 without a live token, in Graph's error envelope", async () => {
        const res = await graph("/me");
        expect(res.status).toBe(401);
        expect(await res.json()).toMatchObject({
            error: { code: "InvalidAuthenticationToken", message: expect.any(String) },
        });
        expect((await graph("/me/drive", "made-up")).status).toBe(401);

        const { access_token } = await connect(FILES);
        microsoftWorld().tokens[access_token]!.expiresAt = 0;
        expect((await graph("/me", access_token)).status).toBe(401);
    });

    it("answers 403 when the token lacks the scope the endpoint needs", async () => {
        const mailOnly = await connect(MAIL);
        const files = await graph("/me/drive", mailOnly.access_token);
        expect(files.status).toBe(403);
        expect(await files.json()).toMatchObject({ error: { code: "accessDenied" } });
        expect((await graph("/sites?search=", mailOnly.access_token)).status).toBe(403);
        // /me needs only a valid token.
        expect((await graph("/me", mailOnly.access_token)).status).toBe(200);

        const filesOnly = await connect(FILES);
        const mail = await graph("/me/mailFolders", filesOnly.access_token);
        expect(mail.status).toBe(403);
        expect((await graph("/me/messages", filesOnly.access_token)).status).toBe(403);
    });

    it("answers 404 itemNotFound for ids it does not know", async () => {
        const { access_token } = await connect([...FILES, "Mail.Read"]);
        for (const path of [
            item("no-such-item"),
            "/drives/b!nope/root",
            "/sites/nope/drives",
            "/me/mailFolders/nope/childFolders",
            "/me/messages/nope/attachments",
        ]) {
            const res = await graph(path, access_token);
            expect(res.status).toBe(404);
            expect(await res.json()).toMatchObject({ error: { code: "itemNotFound" } });
        }
    });
});

describe("Microsoft stand-in files", () => {
    it("walks OneDrive from the root, two folders deep", async () => {
        const { access_token } = await connect(FILES);
        const drive = await graphJson<{ id: string; driveType: string; webUrl: string }>(
            "/me/drive",
            access_token
        );
        expect(drive).toMatchObject({ id: MORGAN.driveId, driveType: "business" });

        const root = await graphJson<DriveItem>(
            `/drives/${encodeURIComponent(drive.id)}/root`,
            access_token
        );
        expect(root.folder?.childCount).toBe(4);
        const top = await graphJson<Page<DriveItem>>(
            `/drives/${encodeURIComponent(drive.id)}/root/children`,
            access_token
        );
        expect(top.value.map(i => i.name)).toEqual([
            "Client files",
            "Fee quote template.docx",
            "Partner meeting notes",
            "Scratch.txt",
        ]);
        const notebook = top.value.find(i => i.name === "Partner meeting notes")!;
        expect(notebook.package).toEqual({ type: "oneNote" });
        expect(notebook.file).toBeUndefined();
        expect(notebook.folder).toBeUndefined();
        const empty = top.value.find(i => i.name === "Scratch.txt")!;
        expect(empty.size).toBe(0);
        expect(empty.file?.mimeType).toBe("text/plain");

        const clients = await graphJson<Page<DriveItem>>(
            `${item(top.value[0]!.id)}/children`,
            access_token
        );
        expect(clients.value.map(i => i.name)).toEqual([
            "Lumen Dental Studio",
            "Northgate Bakery Group",
        ]);
        const letter = await graphJson<DriveItem>(item("od-engagement-letter"), access_token);
        expect(letter.parentReference).toMatchObject({
            driveId: MORGAN.driveId,
            id: "od-northgate",
            path: `/drives/${MORGAN.driveId}/root:/Client%20files/Northgate%20Bakery%20Group`,
        });
        expect(letter.webUrl).toContain(
            "/Documents/Client%20files/Northgate%20Bakery%20Group/Engagement%20letter%20FY2026.docx"
        );
        expect(letter.lastModifiedDateTime).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    });

    it("pages children with $top and absolute nextLinks", async () => {
        const { access_token } = await connect(FILES);
        const first = await graphJson<Page<DriveItem>>(
            `${item("od-workpapers")}/children?$top=3`,
            access_token
        );
        expect(first.value).toHaveLength(3);
        expect(first["@odata.nextLink"]).toMatch(
            new RegExp(`^${GRAPH.replace(/[.]/g, "\\.")}/drives/.+\\$skiptoken=`)
        );

        const { all, pages } = await drain<DriveItem>(
            `${item("od-workpapers")}/children?$top=3`,
            access_token
        );
        expect(pages).toBe(3);
        expect(all.map(i => i.name)).toEqual([
            "WP-01 Cash and bank.md",
            "WP-02 Receivables.md",
            "WP-03 Inventory.md",
            "WP-04 Fixed assets.txt",
            "WP-05 Payables.txt",
            "WP-06 Payroll.txt",
            "WP-07 Revenue.md",
        ]);
        // Without $top it is one page and no link.
        const whole = await graphJson<Page<DriveItem>>(
            `${item("od-workpapers")}/children`,
            access_token
        );
        expect(whole.value).toHaveLength(7);
        expect(whole["@odata.nextLink"]).toBeUndefined();
    });

    it("downloads real file bytes with their content type", async () => {
        const { access_token } = await connect(FILES);

        const word = await graph(`${item("od-engagement-letter")}/content`, access_token);
        expect(word.status).toBe(200);
        expect(word.headers.get("content-type")).toBe(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        );
        const docx = Buffer.from(await word.arrayBuffer());
        const html = await mammoth.convertToHtml({ buffer: docx });
        expect(html.value).toContain("<h1>Engagement letter</h1>");
        expect(html.value).toContain("$48,500");
        const meta = await graphJson<DriveItem>(item("od-engagement-letter"), access_token);
        expect(meta.size).toBe(docx.byteLength);
        expect(meta.file?.hashes.quickXorHash).toBe(quickXorHash(docx));

        const sheet = await graph(`${item("od-trial-balance")}/content`, access_token);
        const workbook = XLSX.read(Buffer.from(await sheet.arrayBuffer()), { type: "buffer" });
        const rows = XLSX.utils.sheet_to_json<(string | number)[]>(
            workbook.Sheets[workbook.SheetNames[0]!]!,
            { header: 1 }
        );
        expect(rows[0]).toEqual(["Account", "Description", "Debit", "Credit"]);
        expect(rows[1]).toEqual(["1000", "Cash at bank", 318400, 0]);

        const pdf = await graph(`${item("od-signed-letter")}/content`, access_token);
        expect(pdf.headers.get("content-type")).toBe("application/pdf");
        const parsed = await PDFDocument.load(new Uint8Array(await pdf.arrayBuffer()));
        expect(parsed.getPageCount()).toBe(1);

        const text = await graph(`${item("od-call-notes")}/content`, access_token);
        expect(await text.text()).toContain("Call with Tomas Okafor");
        const empty = await graph(`${item("od-scratch")}/content`, access_token);
        expect((await empty.arrayBuffer()).byteLength).toBe(0);

        // Folders and notebooks have no content.
        expect((await graph(`${item("od-workpapers")}/content`, access_token)).status).toBe(400);
        expect((await graph(`${item("od-notebook")}/content`, access_token)).status).toBe(400);
    });

    it("computes quickXorHash the way OneDrive does", () => {
        // Each byte lands 11 bits further round a 160-bit ring; the length is
        // XORed into the last eight bytes.
        const one = Buffer.from(quickXorHash(Uint8Array.from([0xff])), "base64");
        expect(one[0]).toBe(0xff);
        expect(one[12]).toBe(1);
        const two = Buffer.from(quickXorHash(Uint8Array.from([0, 0x01])), "base64");
        expect(two[1]).toBe(0b1000);
        expect(two[12]).toBe(2);
        expect(Buffer.from(quickXorHash(new Uint8Array(0)), "base64")).toHaveLength(20);
    });

    it("moves cTag and eTag on an edit, and only eTag on a rename", async () => {
        const { access_token } = await connect(FILES);
        const before = await graphJson<DriveItem>(item("od-onboarding"), access_token);

        editFile(microsoftWorld(), "od-onboarding", "- [ ] Added by the test");
        const edited = await graphJson<DriveItem>(item("od-onboarding"), access_token);
        expect(edited.cTag).not.toBe(before.cTag);
        expect(edited.eTag).not.toBe(before.eTag);
        expect(edited.size).toBeGreaterThan(before.size);
        expect(edited.file?.hashes.quickXorHash).not.toBe(before.file?.hashes.quickXorHash);
        const body = await graph(`${item("od-onboarding")}/content`, access_token);
        expect(await body.text()).toContain("Added by the test");

        renameItem(microsoftWorld(), "od-onboarding", "Onboarding.md");
        const renamed = await graphJson<DriveItem>(item("od-onboarding"), access_token);
        expect(renamed.name).toBe("Onboarding.md");
        expect(renamed.cTag).toBe(edited.cTag);
        expect(renamed.eTag).not.toBe(edited.eTag);

        // An edited Word file is still a Word file.
        editFile(microsoftWorld(), "od-engagement-letter", "Fieldwork now ends on 27 October.");
        const word = await graph(`${item("od-engagement-letter")}/content`, access_token);
        const html = await mammoth.convertToHtml({ buffer: Buffer.from(await word.arrayBuffer()) });
        expect(html.value).toContain("Fieldwork now ends on 27 October.");
    });

    it("shows added and removed files in the folder listing", async () => {
        const { access_token } = await connect(FILES);
        const w = microsoftWorld();
        const added = addFile(w, "od-workpapers", "WP-08 Tax.md", "# WP-08 Tax\n");
        deleteItem(w, "od-wp-01");

        const listing = await graphJson<Page<DriveItem>>(
            `${item("od-workpapers")}/children`,
            access_token
        );
        const names = listing.value.map(i => i.name);
        expect(names).toContain("WP-08 Tax.md");
        expect(names).not.toContain("WP-01 Cash and bank.md");
        expect((await graph(item("od-wp-01"), access_token)).status).toBe(404);
        expect((await graph(`${item(added.id)}/content`, access_token)).status).toBe(200);
    });

    it("resolves a sharing link or a pasted web URL through /shares", async () => {
        const { access_token } = await connect(FILES);
        const shareToken = (url: string) => `u!${Buffer.from(url, "utf8").toString("base64url")}`;

        const shared = await graphJson<DriveItem>(
            `/shares/${shareToken(SAMPLE_SHARING_URL)}/driveItem`,
            access_token
        );
        expect(shared).toMatchObject({
            id: "sp-pbc-list",
            name: "PBC request list.xlsx",
            parentReference: { driveId: CLIENTS_DRIVE_ID },
        });

        // A folder's address-bar URL works the same way.
        const folder = await graphJson<DriveItem>(item("od-northgate"), access_token);
        const byUrl = await graphJson<DriveItem>(
            `/shares/${shareToken(folder.webUrl)}/driveItem`,
            access_token
        );
        expect(byUrl.id).toBe("od-northgate");
        expect(byUrl.folder?.childCount).toBe(5);

        const unknown = await graph(
            `/shares/${shareToken("https://harlowreed.sharepoint.example/sites/Nope/x.docx")}/driveItem`,
            access_token
        );
        expect(unknown.status).toBe(404);
        expect((await graph("/shares/not-a-token/driveItem", access_token)).status).toBe(404);
    });

    it("finds SharePoint sites and lists their document libraries", async () => {
        const { access_token } = await connect(["Sites.Read.All"]);
        interface Site {
            id: string;
            name: string;
            displayName: string;
            webUrl: string;
        }
        const all = await graphJson<Page<Site>>("/sites?search=", access_token);
        expect(all.value.map(s => s.displayName)).toEqual(["Clients", "Firm Knowledge"]);

        const found = await graphJson<Page<Site>>("/sites?search=KNOWLEDGE", access_token);
        expect(found.value).toHaveLength(1);
        expect(found.value[0]).toMatchObject({
            name: "FirmKnowledge",
            displayName: "Firm Knowledge",
            webUrl: "https://harlowreed.sharepoint.example/sites/FirmKnowledge",
        });
        expect(
            (await graphJson<Page<Site>>("/sites?search=payroll", access_token)).value
        ).toHaveLength(0);

        const drives = await graphJson<Page<{ id: string; name: string; driveType: string }>>(
            `/sites/${encodeURIComponent(CLIENTS_SITE_ID)}/drives`,
            access_token
        );
        expect(drives.value).toEqual([
            expect.objectContaining({
                id: CLIENTS_DRIVE_ID,
                name: "Documents",
                driveType: "documentLibrary",
            }),
        ]);
        const library = await graphJson<Page<DriveItem>>(
            `/drives/${encodeURIComponent(CLIENTS_DRIVE_ID)}/root/children`,
            access_token
        );
        expect(library.value.map(i => i.name)).toEqual([
            "Brightwater Logistics",
            "Northgate Bakery Group",
        ]);
    });
});

describe("Microsoft stand-in mail", () => {
    interface Folder {
        id: string;
        displayName: string;
        parentFolderId: string;
        childFolderCount: number;
        totalItemCount: number;
        unreadItemCount: number;
        wellKnownName?: string;
    }
    interface Message {
        id: string;
        conversationId: string;
        subject: string;
        from: { emailAddress: { name: string; address: string } };
        toRecipients: { emailAddress: { name: string; address: string } }[];
        ccRecipients: { emailAddress: { name: string; address: string } }[];
        sentDateTime: string;
        receivedDateTime: string;
        isDraft: boolean;
        hasAttachments: boolean;
        body: { contentType: string; content: string };
        bodyPreview: string;
        webLink: string;
        parentFolderId: string;
        internetMessageId: string;
    }
    interface DeltaEntry {
        id: string;
        conversationId?: string;
        isDraft?: boolean;
        receivedDateTime?: string;
        subject?: string;
        "@removed"?: { reason: string };
    }
    const TEXT = { Prefer: 'outlook.body-content-type="text"' };
    const delta = (folderId: string, query = "") =>
        `/me/mailFolders/${folderId}/messages/delta${query}`;

    it("lists mail folders and their child folders", async () => {
        const { access_token } = await connect(MAIL);
        const top = await graphJson<Page<Folder>>("/me/mailFolders?$top=50", access_token);
        expect(top.value.map(f => f.displayName).sort()).toEqual([
            "Archive",
            "Drafts",
            "Inbox",
            "Sent Items",
        ]);
        const inbox = top.value.find(f => f.displayName === "Inbox")!;
        expect(inbox).toMatchObject({
            id: "mf-morgan-inbox",
            childFolderCount: 1,
            totalItemCount: 5,
            wellKnownName: "inbox",
        });
        expect(inbox.unreadItemCount).toBeGreaterThan(0);

        const children = await graphJson<Page<Folder>>(
            `/me/mailFolders/${inbox.id}/childFolders`,
            access_token
        );
        expect(children.value).toEqual([
            expect.objectContaining({
                id: "mf-morgan-clients",
                displayName: "Clients",
                parentFolderId: inbox.id,
                childFolderCount: 0,
                totalItemCount: 9,
            }),
        ]);

        // $top pages folders too.
        const paged = await drain<Folder>("/me/mailFolders?$top=3", access_token);
        expect(paged.pages).toBe(2);
        expect(paged.all).toHaveLength(4);
    });

    it("delta: every message first, then only what arrived or was deleted", async () => {
        const { access_token } = await connect(MAIL);
        const w = microsoftWorld();

        const first = await drain<DeltaEntry>(delta("mf-morgan-clients", "?$top=4"), access_token);
        expect(first.pages).toBe(3);
        expect(first.all).toHaveLength(9);
        expect(new Set(first.all.map(m => m.id)).size).toBe(9);
        for (const entry of first.all) {
            expect(entry).toMatchObject({
                id: expect.any(String),
                conversationId: expect.any(String),
                isDraft: false,
                receivedDateTime: expect.any(String),
            });
        }
        const deltaLink = first.last["@odata.deltaLink"]!;
        expect(deltaLink).toMatch(new RegExp(`^${GRAPH.replace(/[.]/g, "\\.")}/me/mailFolders/`));
        expect(deltaLink).toContain("$deltatoken=");

        // Nothing happened: an empty page and a new link.
        const quiet = await graphJson<Page<DeltaEntry>>(deltaLink, access_token);
        expect(quiet.value).toEqual([]);
        expect(quiet["@odata.deltaLink"]).toBeDefined();

        // A reply arrives, and mail lands in another folder.
        const reply = addMessage(w, "conv-morgan-planning-meeting", { text: "Running late." });
        expect(reply.folderId).toBe("mf-morgan-clients");
        addMessage(w, "conv-morgan-tax-memo");
        const afterReply = await graphJson<Page<DeltaEntry>>(
            quiet["@odata.deltaLink"]!,
            access_token
        );
        expect(afterReply.value).toEqual([
            expect.objectContaining({
                id: reply.id,
                conversationId: "conv-morgan-planning-meeting",
                isDraft: false,
            }),
        ]);

        // A delete comes through as @removed, once.
        deleteMessage(w, "msg-morgan-invoice-2041-1");
        const afterDelete = await graphJson<Page<DeltaEntry>>(
            afterReply["@odata.deltaLink"]!,
            access_token
        );
        expect(afterDelete.value).toEqual([
            { id: "msg-morgan-invoice-2041-1", "@removed": { reason: "deleted" } },
        ]);
        const settled = await graphJson<Page<DeltaEntry>>(
            afterDelete["@odata.deltaLink"]!,
            access_token
        );
        expect(settled.value).toEqual([]);

        // The older link still replays everything since it was issued.
        const replay = await graphJson<Page<DeltaEntry>>(deltaLink, access_token);
        expect(replay.value.map(e => e.id)).toEqual([reply.id, "msg-morgan-invoice-2041-1"]);
    });

    it("delta honours $select, well-known folder names and Prefer: odata.maxpagesize", async () => {
        const { access_token } = await connect(MAIL);
        const page = await graphJson<Page<DeltaEntry>>(
            delta("inbox", "?$select=subject,receivedDateTime"),
            access_token,
            { Prefer: "odata.maxpagesize=2" }
        );
        expect(page.value).toHaveLength(2);
        expect(page["@odata.nextLink"]).toContain("$skiptoken=");
        expect(page.value[0]!.subject).toEqual(expect.any(String));
        expect(page.value[0]!.conversationId).toBeUndefined();
    });

    it("answers an invalidated or made-up delta token with 410 syncStateNotFound", async () => {
        const { access_token } = await connect(MAIL);
        const first = await drain<DeltaEntry>(delta("mf-morgan-inbox"), access_token);
        const deltaLink = first.last["@odata.deltaLink"]!;
        expect((await graph(deltaLink, access_token)).status).toBe(200);

        invalidateDeltaTokens(microsoftWorld());
        const gone = await graph(deltaLink, access_token);
        expect(gone.status).toBe(410);
        expect(await gone.json()).toMatchObject({ error: { code: "syncStateNotFound" } });
        expect(
            (await graph(delta("mf-morgan-inbox", "?$deltatoken=garbage"), access_token)).status
        ).toBe(410);
        // A token for one folder is no good for another.
        const fresh = await drain<DeltaEntry>(delta("mf-morgan-inbox"), access_token);
        const moved = fresh.last["@odata.deltaLink"]!.replace("mf-morgan-inbox", "mf-morgan-sent");
        expect((await graph(moved, access_token)).status).toBe(410);
    });

    it("returns a whole conversation by filter, across folders", async () => {
        const { access_token } = await connect(MAIL);
        const filter = encodeURIComponent("conversationId eq 'conv-morgan-engagement'");
        const { all, pages } = await drain<Message>(
            `/me/messages?$filter=${filter}&$top=3`,
            access_token
        );
        expect(pages).toBe(2);
        expect(all).toHaveLength(4);
        expect(new Set(all.map(m => m.parentFolderId))).toEqual(
            new Set(["mf-morgan-sent", "mf-morgan-clients"])
        );
        const opener = all.find(m => m.id === "msg-morgan-engagement-1")!;
        expect(opener).toMatchObject({
            conversationId: "conv-morgan-engagement",
            subject: "Engagement letter for the FY2026 audit",
            from: { emailAddress: { name: "Morgan Ellis", address: MORGAN.email } },
            toRecipients: [{ emailAddress: { name: "Dana Whitfield" } }],
            ccRecipients: [{ emailAddress: { address: PRIYA.email } }],
            isDraft: false,
            hasAttachments: true,
            body: { contentType: "html" },
            parentFolderId: "mf-morgan-sent",
        });
        expect(opener.sentDateTime).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
        expect(opener.webLink).toMatch(/^https:\/\//);
        expect(opener.internetMessageId).toMatch(/^<.+@.+>$/);
        expect(opener.bodyPreview).toContain("Attached is our engagement letter");
        expect(opener.body.content).toContain("<p>Hi Dana,</p>");

        const none = await graphJson<Page<Message>>(
            `/me/messages?$filter=${encodeURIComponent("conversationId eq 'nope'")}`,
            access_token
        );
        expect(none.value).toEqual([]);
        // Priya's copy of the thread is hers alone.
        const priya = await connect(MAIL, PRIYA.oid);
        const hers = await graphJson<Page<Message>>(
            `/me/messages?$filter=${filter}`,
            priya.access_token
        );
        expect(hers.value).toEqual([]);
    });

    it("quotes earlier messages the three ways mail clients do, and holds a draft", async () => {
        const { access_token } = await connect(MAIL);
        const text = async (id: string) =>
            (await graphJson<Message>(`/me/messages/${id}`, access_token, TEXT)).body.content;

        const onWrote = await text("msg-morgan-engagement-2");
        expect(onWrote).toMatch(
            /\n\nOn \w{3}, \w{3} \d+, \d{4} at .+ Morgan Ellis <.+> wrote:\n> /
        );
        const outlook = await text("msg-morgan-engagement-3");
        expect(outlook).toMatch(/\nFrom: Dana Whitfield <.+>\nSent: \w+, \w+ \d+, \d{4} .+\nTo: /);
        const original = await text("msg-morgan-invoice-2041-2");
        expect(original).toContain("-----Original Message-----\nFrom: Harlow Reed Accounts");

        const drafts = await graphJson<Page<Message>>(
            "/me/mailFolders/drafts/messages",
            access_token
        );
        expect(drafts.value).toHaveLength(1);
        expect(drafts.value[0]).toMatchObject({
            isDraft: true,
            parentFolderId: "mf-morgan-drafts",
        });
    });

    it("searches subject, body and sender", async () => {
        const { access_token } = await connect(MAIL);
        const search = async (q: string) =>
            (
                await drain<Message>(
                    `/me/messages?$search=${encodeURIComponent(`"${q}"`)}&$top=5`,
                    access_token
                )
            ).all;

        const invoices = await search("INV-2041");
        expect(invoices.map(m => m.id).sort()).toEqual([
            "msg-morgan-invoice-2041-1",
            "msg-morgan-invoice-2041-2",
        ]);
        const bySender = await search("tomas@lumendental.example");
        expect(bySender.length).toBeGreaterThanOrEqual(3);
        expect(bySender.every(m => JSON.stringify(m).toLowerCase().includes("tomas"))).toBe(true);
        const byBody = await search("capital allowances");
        expect(byBody.map(m => m.conversationId)).toContain("conv-morgan-tax-memo");
        expect(await search("zebra crossing")).toEqual([]);
    });

    it("lists attachments and serves their bytes", async () => {
        const { access_token } = await connect(MAIL);
        interface Attachment {
            id: string;
            name: string;
            contentType: string;
            size: number;
            isInline: boolean;
        }
        const pdfs = await graphJson<Page<Attachment>>(
            "/me/messages/msg-morgan-engagement-4/attachments",
            access_token
        );
        expect(pdfs.value).toEqual([
            expect.objectContaining({
                name: "Signed engagement letter.pdf",
                contentType: "application/pdf",
                isInline: false,
            }),
        ]);
        const pdf = await graph(
            `/me/messages/msg-morgan-engagement-4/attachments/${pdfs.value[0]!.id}/$value`,
            access_token
        );
        expect(pdf.status).toBe(200);
        expect(pdf.headers.get("content-type")).toBe("application/pdf");
        const pdfBytes = new Uint8Array(await pdf.arrayBuffer());
        expect(pdfBytes.byteLength).toBe(pdfs.value[0]!.size);
        expect((await PDFDocument.load(pdfBytes)).getPageCount()).toBe(1);

        const docs = await graphJson<Page<Attachment>>(
            "/me/messages/msg-morgan-tax-memo-1/attachments",
            access_token
        );
        const docx = await graph(
            `/me/messages/msg-morgan-tax-memo-1/attachments/${docs.value[0]!.id}/$value`,
            access_token
        );
        const html = await mammoth.convertToHtml({ buffer: Buffer.from(await docx.arrayBuffer()) });
        expect(html.value).toContain("<h1>Capital allowances memo</h1>");

        // An inline signature image is listed, flagged, and not counted by hasAttachments.
        const inline = await graphJson<Page<Attachment>>(
            "/me/messages/msg-morgan-pbc-list-2/attachments",
            access_token
        );
        expect(inline.value).toEqual([
            expect.objectContaining({ contentType: "image/png", isInline: true }),
        ]);
        const png = await graph(
            `/me/messages/msg-morgan-pbc-list-2/attachments/${inline.value[0]!.id}/$value`,
            access_token
        );
        expect(
            Buffer.from(await png.arrayBuffer())
                .subarray(1, 4)
                .toString("latin1")
        ).toBe("PNG");
        const carrier = await graphJson<Message>(
            "/me/messages/msg-morgan-pbc-list-2",
            access_token
        );
        expect(carrier.hasAttachments).toBe(false);
        expect(carrier.body.content).toContain("cid:logo@brightwater-logistics.example");

        expect(
            (
                await graph(
                    "/me/messages/msg-morgan-engagement-4/attachments/nope/$value",
                    access_token
                )
            ).status
        ).toBe(404);
        const bare = await graphJson<Page<Attachment>>(
            "/me/messages/msg-morgan-engagement-2/attachments",
            access_token
        );
        expect(bare.value).toEqual([]);
    });

    it("returns the text body when Prefer asks for it, and HTML when there is none", async () => {
        const { access_token } = await connect(MAIL);
        const html = await graphJson<Message>("/me/messages/msg-morgan-onboarding-1", access_token);
        expect(html.body.contentType).toBe("html");
        expect(html.body.content).toContain("<p>Hi both,</p>");

        const res = await graph("/me/messages/msg-morgan-onboarding-1", access_token, TEXT);
        expect(res.headers.get("preference-applied")).toBe('outlook.body-content-type="text"');
        const text = (await res.json()) as Message;
        expect(text.body.contentType).toBe("text");
        expect(text.body.content).toMatch(/^Hi both,\n\nI have sent the bank feed access\./);
        expect(text.body.content).not.toContain("<p>");

        // Lists honour it too.
        const filter = encodeURIComponent("conversationId eq 'conv-morgan-onboarding'");
        const listed = await graphJson<Page<Message>>(
            `/me/messages?$filter=${filter}`,
            access_token,
            TEXT
        );
        expect(listed.value[0]!.body.contentType).toBe("text");

        // The one message that was only ever HTML stays HTML.
        const bulk = await graphJson<Message>("/me/messages/msg-morgan-cpe-1", access_token, TEXT);
        expect(bulk.body.contentType).toBe("html");
        expect(bulk.body.content).toContain("31 of the 40 CPE hours");
    });
});

describe("Microsoft stand-in viewer controls", () => {
    const act = (body: Record<string, unknown>) =>
        handleMicrosoftRequest(
            new Request(`${BASE}/_standin/action`, { method: "POST", body: JSON.stringify(body) })
        );

    it("edits, removes, adds, replies and resets from the page's buttons", async () => {
        const { access_token, refresh_token } = await connect([...FILES, "Mail.Read"]);
        const before = await graphJson<DriveItem>(item("od-engagement-letter"), access_token);
        const messagesBefore = Object.keys(microsoftWorld().messages).length;

        expect((await act({ action: "edit-file" })).status).toBe(200);
        const after = await graphJson<DriveItem>(item("od-engagement-letter"), access_token);
        expect(after.cTag).not.toBe(before.cTag);

        expect((await act({ action: "remove-file" })).status).toBe(200);
        expect((await graph(item("od-wp-01"), access_token)).status).toBe(404);
        expect((await act({ action: "add-file" })).status).toBe(200);
        const reply = await act({ action: "new-reply" });
        const snapshot = (await reply.json()) as { messages: unknown[]; calls: unknown[] };
        expect(snapshot.messages).toHaveLength(messagesBefore + 1);
        expect(snapshot.calls.length).toBeGreaterThan(0);

        expect((await act({ action: "revoke-grants" })).status).toBe(200);
        expect((await refresh(refresh_token!)).status).toBe(400);
        expect((await act({ action: "nope" })).status).toBe(400);

        expect((await act({ action: "reset" })).status).toBe(200);
        expect(Object.keys(microsoftWorld().messages)).toHaveLength(messagesBefore);
        expect(microsoftWorld().items["od-wp-01"]).toBeDefined();
    });
});
