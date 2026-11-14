/**
 * OneDrive and SharePoint import, the pieces that need no database: reading
 * a pasted link, where a picked file lands, what the built-in browser lists,
 * what a sync brings in and how its files are labelled, and which place
 * "Open in ..." names. Everything that talks to Microsoft runs against the
 * Microsoft stand-in over a routed `fetch`.
 */

const mockEnv = {
    server: {
        MICROSOFT_OAUTH_CLIENT_ID: "cid" as string | undefined,
        MICROSOFT_OAUTH_CLIENT_SECRET: "sec" as string | undefined,
        MICROSOFT_STAND_IN_URL: undefined as string | undefined,
        EMBEDDING_SECRETS_KEY: "key" as string | undefined,
        APP_PUBLIC_URL: undefined as string | undefined,
    },
    client: {},
};
jest.mock("~/env", () => ({
    get env() {
        return mockEnv;
    },
}));
jest.mock("~/server/engine", () => ({ getEngine: jest.fn() }));
jest.mock("~/server/db", () => ({ db: {} }));
jest.mock("~/server/services/microsoft/connections", () => ({
    getMicrosoftAccessToken: jest.fn(),
    markMicrosoftConnectionRevoked: jest.fn(),
}));

import type { KnowledgeItem, KnowledgeSink } from "@launchstack/pipelines/connectors";
import {
    createMicrosoft365Client,
    syncMicrosoft365,
} from "@launchstack/pipelines/connectors/microsoft-365";

import { handleMicrosoftRequest } from "~/app/dev/stand-ins/microsoft/dispatch";
import { MORGAN, PRIYA } from "~/app/dev/stand-ins/microsoft/directory";
import {
    CLIENTS_DRIVE_ID,
    CLIENTS_SITE_ID,
    SAMPLE_SHARING_URL,
} from "~/app/dev/stand-ins/microsoft/seed-drive";
import { microsoftWorld, resetMicrosoftWorld } from "~/app/dev/stand-ins/microsoft/world";
import {
    microsoft365LinkFrom,
    microsoft365PlaceOfHost,
} from "~/lib/integrations/microsoft-365-link";
import { sourceExternalLink } from "~/lib/source-external-link";
import type { ConnectorConnection } from "~/server/db/schema";
import {
    browseFolder,
    browseItemFrom,
    browseMyDrive,
    browseSiteDrives,
    browseSites,
} from "~/server/services/connectors/microsoft-365/browse";
import { createMicrosoft365Destinations } from "~/server/services/connectors/microsoft-365/destinations";
import { resolveMicrosoft365Link } from "~/server/services/connectors/microsoft-365/resolve-link";
import { graphApiBaseUrl } from "~/server/services/microsoft/config";
import { getMicrosoftAccessToken } from "~/server/services/microsoft/connections";

const STAND_IN = "http://127.0.0.1:3031/dev/stand-ins/microsoft";
const realFetch = global.fetch;

function tokenFor(account = MORGAN, scopes = ["Files.Read.All", "Sites.Read.All"]): string {
    const token = `test-token-${account.key}-${scopes.length}`;
    microsoftWorld().tokens[token] = {
        oid: account.oid,
        scopes,
        expiresAt: Date.now() + 60_000,
    };
    return token;
}

function connection(email: string | null = MORGAN.email): ConnectorConnection {
    return { id: 1, providerAccountEmail: email } as unknown as ConnectorConnection;
}

function standInClient(token = tokenFor()) {
    return createMicrosoft365Client({ accessToken: token, baseUrl: graphApiBaseUrl() });
}

beforeEach(() => {
    resetMicrosoftWorld();
    mockEnv.server.MICROSOFT_STAND_IN_URL = STAND_IN;
    global.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
        handleMicrosoftRequest(new Request(input, init))) as typeof fetch;
});
afterEach(() => {
    global.fetch = realFetch;
    mockEnv.server.MICROSOFT_STAND_IN_URL = undefined;
});

describe("which addresses are OneDrive or SharePoint", () => {
    it.each([
        ["contoso.sharepoint.com", "sharepoint"],
        ["contoso-my.sharepoint.com", "onedrive"],
        ["CONTOSO-MY.SharePoint.com", "onedrive"],
        ["onedrive.live.com", "onedrive"],
        ["1drv.ms", "onedrive"],
        ["harlowreed.sharepoint.example", "sharepoint"],
        ["harlowreed-my.sharepoint.example", "onedrive"],
    ])("%s is %s", (host, place) => {
        expect(microsoft365PlaceOfHost(host)).toBe(place);
    });

    it.each([
        ["sharepoint.com"],
        ["contoso.sharepoint.com.evil.example"],
        ["evil.example"],
        ["a.b.sharepoint.com"],
        ["drive.google.com"],
    ])("%s is neither", host => {
        expect(microsoft365PlaceOfHost(host)).toBeNull();
    });

    it("reads a pasted link, with or without its scheme", () => {
        const link = "https://contoso.sharepoint.com/:x:/s/Clients/Eabc123?e=k3Tq9a";
        expect(microsoft365LinkFrom(`  ${link} `)).toBe(link);
        expect(microsoft365LinkFrom("contoso-my.sharepoint.com/:f:/p/ada/Efolder")).toBe(
            "https://contoso-my.sharepoint.com/:f:/p/ada/Efolder"
        );
        expect(microsoft365LinkFrom("https://1drv.ms/f/s!Abc")).toBe("https://1drv.ms/f/s!Abc");
    });

    it.each([
        [""],
        ["not a link at all"],
        ["http://contoso.sharepoint.com/sites/Clients/doc.docx"],
        ["https://contoso.sharepoint.com/"],
        ["https://drive.google.com/drive/folders/abc"],
        ["javascript:alert(1)"],
    ])("refuses %p", link => {
        expect(microsoft365LinkFrom(link)).toBeNull();
    });
});

describe('"Open in ..." for a synced file', () => {
    const context = { viewerUserPk: 1, connectionOwners: new Map<string, number>() };
    const linkFor = (webUrl: unknown) =>
        sourceExternalLink(
            { ocrMetadata: { connector: "microsoft-365", webUrl }, fileUrl: "/api/files/9" },
            context as unknown as Parameters<typeof sourceExternalLink>[1]
        );

    it("opens a SharePoint library's file in SharePoint", () => {
        const url = "https://contoso.sharepoint.com/sites/Clients/Shared%20Documents/a.docx";
        expect(linkFor(url)).toEqual({ kind: "sharepoint", url });
    });

    it("opens a work OneDrive file, and a personal one, in OneDrive", () => {
        const work = "https://contoso-my.sharepoint.com/personal/ada/Documents/a.docx";
        expect(linkFor(work)).toEqual({ kind: "onedrive", url: work });
        const personal = "https://onedrive.live.com/?id=ABC%21123";
        expect(linkFor(personal)).toEqual({ kind: "onedrive", url: personal });
    });

    it("falls back to the stored file when the address isn't Microsoft's, or isn't https", () => {
        const file = { kind: "file", url: "/api/files/9" };
        expect(linkFor("https://evil.example/a.docx")).toEqual(file);
        expect(linkFor("javascript:alert(1)")).toEqual(file);
        expect(linkFor("http://contoso.sharepoint.com/a.docx")).toEqual(file);
        expect(linkFor(null)).toEqual(file);
    });
});

describe("where a picked file lands", () => {
    const ada = { companyId: 1n, userPk: 10n, authUserId: "auth_ada" };
    const destinations = createMicrosoft365Destinations({
        companyId: 1n,
        connectionId: 1,
        roots: [
            {
                id: 1n,
                sourceId: "b!d:deck",
                kind: "file",
                name: "Deck.pdf",
                folderCategoryId: null,
                destination: "Deals/Acme/",
                owner: ada,
            },
            {
                id: 2n,
                sourceId: "b!d:memo",
                kind: "file",
                name: "Memo.pdf",
                folderCategoryId: null,
                destination: null,
                owner: ada,
            },
        ],
    });

    it("goes to the folder Add source picked it into, as an upload there would", async () => {
        await expect(
            destinations.placeFor({ metadata: { pickedRoot: "b!d:deck" } })
        ).resolves.toEqual({ category: "Deals/Acme", owner: ada });
    });

    it("goes to Microsoft 365 as a workspace import when its pick names no folder", async () => {
        await expect(
            destinations.placeFor({ metadata: { pickedRoot: "b!d:memo" } })
        ).resolves.toEqual({ category: "Microsoft 365", owner: null });
        await expect(destinations.placeFor({ metadata: {} })).resolves.toEqual({
            category: "Microsoft 365",
            owner: null,
        });
    });
});

describe("the built-in browser (against the Microsoft stand-in)", () => {
    it("opens the connected account's own OneDrive at its top", async () => {
        const listing = await browseMyDrive(standInClient(), "My OneDrive");
        expect(listing.drive?.driveId).toBe(MORGAN.driveId);
        expect(listing.folder).toEqual({ driveId: MORGAN.driveId, itemId: "root" });
        expect(listing.items.map(item => item.name)).toContain("Client files");
        expect(listing.items.find(item => item.name === "Client files")).toMatchObject({
            kind: "folder",
            driveId: MORGAN.driveId,
            itemId: "od-client-files",
            supported: true,
        });
    });

    it("lists a folder with its folders first, and marks what can be read", async () => {
        const client = standInClient();
        const top = await browseFolder(client, MORGAN.driveId, "od-client-files");
        expect(top.items.map(item => item.itemId)).toContain("od-northgate");

        const folder = await browseFolder(client, MORGAN.driveId, "od-northgate");
        const names = folder.items.map(item => item.name);
        expect(names).toContain("Engagement letter FY2026.docx");
        const kinds = folder.items.map(item => item.kind);
        expect(kinds).toEqual([...kinds].sort((a, b) => (a === b ? 0 : a === "folder" ? -1 : 1)));
        for (const item of folder.items.filter(entry => entry.kind === "file")) {
            expect(typeof item.supported).toBe("boolean");
            expect(item.driveId).toBe(MORGAN.driveId);
        }
        expect(folder.truncated).toBe(false);
    });

    it("finds SharePoint sites by name, and every site for an empty search", async () => {
        const client = standInClient();
        const all = await browseSites(client, "");
        expect(all.map(site => site.siteId)).toContain(CLIENTS_SITE_ID);
        expect(all.length).toBeGreaterThan(1);

        const some = await browseSites(client, "client");
        expect(some.map(site => site.siteId)).toEqual([CLIENTS_SITE_ID]);
        await expect(browseSites(client, "no such site anywhere")).resolves.toEqual([]);
    });

    it("lists a site's document libraries, which open like any folder", async () => {
        const client = standInClient();
        const drives = await browseSiteDrives(client, CLIENTS_SITE_ID, "Documents");
        expect(drives.map(drive => drive.driveId)).toEqual([CLIENTS_DRIVE_ID]);
        expect(drives[0]!.name).toBeTruthy();

        const library = await browseFolder(client, CLIENTS_DRIVE_ID, "root");
        expect(library.items.length).toBeGreaterThan(0);
    });

    it("shows a file type LaunchStack can't read without letting it be picked", () => {
        expect(
            browseItemFrom(
                { id: "1", name: "clip.mov", file: { mimeType: "video/quicktime" } },
                "d"
            )
        ).toMatchObject({ kind: "file", supported: false });
        expect(
            browseItemFrom({ id: "2", name: "notes.md", file: { mimeType: "text/markdown" } }, "d")
        ).toMatchObject({ kind: "file", supported: true });
        // A OneNote notebook is neither a file nor a folder.
        expect(
            browseItemFrom({ id: "3", name: "Notebook", package: { type: "oneNote" } }, "d")
        ).toBeNull();
    });

    it("follows a shared-with-me entry to the drive the item really lives in", () => {
        expect(
            browseItemFrom(
                {
                    id: "local",
                    name: "Shared folder",
                    remoteItem: {
                        id: "remote-1",
                        name: "Shared folder",
                        folder: { childCount: 2 },
                        parentReference: { driveId: "b!other" },
                    },
                },
                "b!mine"
            )
        ).toMatchObject({ driveId: "b!other", itemId: "remote-1", kind: "folder" });
    });
});

describe("resolveMicrosoft365Link (against the Microsoft stand-in)", () => {
    it("resolves a sharing link to the picked file it names", async () => {
        jest.mocked(getMicrosoftAccessToken).mockResolvedValue(tokenFor());
        const result = await resolveMicrosoft365Link(connection(), SAMPLE_SHARING_URL);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.item).toMatchObject({ driveId: CLIENTS_DRIVE_ID, kind: "file" });
            expect(result.item.name).toMatch(/\.xlsx$/);
            expect(result.item.itemId).toBeTruthy();
            expect(result.item.webUrl).toMatch(/^https:\/\//);
        }
    });

    it("says who to ask when the account can't open the link", async () => {
        jest.mocked(getMicrosoftAccessToken).mockResolvedValue(tokenFor());
        const result = await resolveMicrosoft365Link(
            connection(),
            "https://harlowreed.sharepoint.example/:x:/s/Clients/EnotSharedWithAnyone"
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toBe("not-found");
            expect(result.message).toContain(`Ask its owner to share it with ${MORGAN.email}`);
            expect(result.copy.key).toBe("sources.server.microsoft365.linkNotFound");
        }
    });

    it("refuses what isn't a OneDrive or SharePoint link before calling Microsoft", async () => {
        jest.mocked(getMicrosoftAccessToken).mockClear();
        await expect(
            resolveMicrosoft365Link(connection(), "https://drive.google.com/drive/folders/abc")
        ).resolves.toMatchObject({ ok: false, reason: "not-a-link" });
        await expect(resolveMicrosoft365Link(connection(), "hello")).resolves.toMatchObject({
            ok: false,
            reason: "not-a-link",
        });
        expect(getMicrosoftAccessToken).not.toHaveBeenCalled();
    });
});

describe("a sync of a picked folder (against the Microsoft stand-in)", () => {
    function recordingSink(hashes = new Map<string, string>()) {
        const stored: KnowledgeItem[] = [];
        const sink: KnowledgeSink = {
            lastSyncedHash: item => Promise.resolve(hashes.get(item.sourceId) ?? null),
            store: item => {
                stored.push(item);
                hashes.set(item.sourceId, item.contentHash);
                return Promise.resolve({
                    sourceId: item.sourceId,
                    documentId: stored.length,
                    versionId: stored.length,
                    jobId: `job-${stored.length}`,
                    revised: false,
                });
            },
        };
        return { sink, stored, hashes };
    }

    const picked = [
        { driveId: MORGAN.driveId, itemId: "od-client-files", kind: "folder" as const },
    ];
    const root = `${MORGAN.driveId}:od-client-files`;

    it("brings in the folder's files, each knowing its pick and its subfolders", async () => {
        const { sink, stored } = recordingSink();
        const report = await syncMicrosoft365({
            client: standInClient(),
            sink,
            pickedItems: picked,
        });

        expect(report.failed).toEqual([]);
        expect(stored.length).toBeGreaterThan(0);
        const letter = stored.find(item => item.title === "Engagement letter FY2026.docx")!;
        expect(letter.sourceId).toBe(`${MORGAN.driveId}:od-engagement-letter`);
        expect(letter.metadata).toMatchObject({
            driveId: MORGAN.driveId,
            itemId: "od-engagement-letter",
            pickedRoot: root,
            folderPath: ["Northgate Bakery Group"],
        });
        expect(String(letter.metadata.webUrl)).toMatch(/^https:\/\/harlowreed-my\.sharepoint\./);
    });

    it("downloads nothing the second time, and leaves out what was deleted here", async () => {
        const first = recordingSink();
        await syncMicrosoft365({ client: standInClient(), sink: first.sink, pickedItems: picked });
        const known = first.stored.map(item => item.sourceId);

        const second = recordingSink(first.hashes);
        const again = await syncMicrosoft365({
            client: standInClient(),
            sink: second.sink,
            pickedItems: picked,
            knownSourceIds: known,
        });
        expect(second.stored).toEqual([]);
        expect(again.dirty).toBe(false);
        expect(again.missingSourceIds).toEqual([]);

        const deleted = `${MORGAN.driveId}:od-engagement-letter`;
        const third = recordingSink();
        await syncMicrosoft365({
            client: standInClient(),
            sink: third.sink,
            pickedItems: picked,
            deletedSourceIds: [deleted],
        });
        expect(third.stored.map(item => item.sourceId)).not.toContain(deleted);
        expect(third.stored.length).toBe(first.stored.length - 1);
    });

    it("reports a pick the account can't open as access lost, not as an empty folder", async () => {
        const { sink, stored } = recordingSink();
        const report = await syncMicrosoft365({
            client: standInClient(tokenFor(PRIYA)),
            sink,
            pickedItems: [{ driveId: MORGAN.driveId, itemId: "no-such-item", kind: "folder" }],
            knownSourceIds: ["x:y"],
        });
        expect(stored).toEqual([]);
        expect(report.accessLost).toEqual([`${MORGAN.driveId}:no-such-item`]);
        // A walk that couldn't read a pick says nothing about what is gone.
        expect(report.missingSourceIds).toEqual([]);
    });
});
