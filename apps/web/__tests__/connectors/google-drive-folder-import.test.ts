/**
 * Shared-folder import, the pieces that need no database: reading a pasted
 * Drive link, the scope the connect flow asks for (and whether a stored grant
 * can read folders), where a synced file lands in the folder tree, the
 * Picker's three views, and the Drive client's shared-drive query. The link
 * resolver runs against the Google stand-in over a routed `fetch`.
 */

const mockEnv = {
    server: {
        GOOGLE_OAUTH_CLIENT_ID: "cid" as string | undefined,
        GOOGLE_OAUTH_CLIENT_SECRET: "sec" as string | undefined,
        GOOGLE_DRIVE_FOLDER_ACCESS_ENABLED: undefined as string | undefined,
        GOOGLE_STAND_IN_URL: undefined as string | undefined,
        APP_PUBLIC_URL: undefined as string | undefined,
        GOOGLE_OAUTH_REDIRECT_URL: undefined as string | undefined,
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
jest.mock("~/server/services/google-drive/connections", () => ({
    getAccessTokenForConnection: jest.fn(),
}));

import { createDriveClient } from "@launchstack/pipelines/connectors/google-drive";

import { handleGoogleRequest } from "~/app/dev/stand-ins/google/dispatch";
import { googleWorld, resetGoogleWorld } from "~/app/dev/stand-ins/google/world";
import {
    buildDriveViews,
    type PickerView,
} from "~/app/employer/documents/_workspace/useGooglePicker";
import { driveIdFromLink } from "~/lib/integrations/google-drive-link";
import type { ConnectorConnection } from "~/server/db/schema";
import {
    folderSegmentFor,
    freeTopLevelPath,
    missingToMark,
    ownerForPick,
    placementPath,
} from "~/server/services/connectors/google-drive/destinations";
import { resolveDriveLink } from "~/server/services/connectors/google-drive/resolve-link";
import { getAccessTokenForConnection } from "~/server/services/google-drive/connections";
import {
    DRIVE_FILE_SCOPE,
    DRIVE_READONLY_SCOPE,
    driveApiBaseUrl,
    googleDriveScopes,
    googleStandInUrl,
    grantsFolderAccess,
} from "~/server/services/google-drive/config";

afterEach(() => {
    mockEnv.server.GOOGLE_DRIVE_FOLDER_ACCESS_ENABLED = undefined;
    mockEnv.server.GOOGLE_STAND_IN_URL = undefined;
});

describe("driveIdFromLink", () => {
    const ID = "1AbC_dEf-GhIjKlMnOpQrStUvWxYz0123";
    it.each([
        [`https://drive.google.com/drive/folders/${ID}?usp=sharing`],
        [`https://drive.google.com/drive/u/1/folders/${ID}`],
        [`https://drive.google.com/drive/mobile/folders/${ID}?usp=drive_link`],
        [`drive.google.com/drive/folders/${ID}`],
        [`https://drive.google.com/open?id=${ID}`],
        [`https://drive.google.com/folderview?id=${ID}&usp=sharing`],
        [`https://drive.google.com/file/d/${ID}/view?usp=sharing`],
        [`https://docs.google.com/document/d/${ID}/edit`],
        [`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`],
        [`  ${ID}  `],
    ])("reads the id from %s", link => {
        expect(driveIdFromLink(link)).toBe(ID);
    });

    it.each([
        [""],
        ["https://example.com/drive/folders/1AbCdEfGhIjKlMnOp"],
        ["https://drive.google.com/drive/my-drive"],
        ["not a link at all"],
        ["https://drive.google.com.evil.example/drive/folders/1AbCdEfGhIjKlMnOp"],
    ])("refuses %p", link => {
        expect(driveIdFromLink(link)).toBeNull();
    });
});

describe("folder access configuration", () => {
    it("asks for drive.readonly only when folder access is asked for and the operator allows it", () => {
        const base = [DRIVE_FILE_SCOPE, "openid", "email"];
        expect(googleDriveScopes()).toEqual(base);
        expect(googleDriveScopes({ folderAccess: true })).toEqual(base);

        mockEnv.server.GOOGLE_DRIVE_FOLDER_ACCESS_ENABLED = "true";
        // A plain connect stays clear of the restricted scope.
        expect(googleDriveScopes()).toEqual(base);
        expect(googleDriveScopes({ folderAccess: true })).toEqual([
            DRIVE_FILE_SCOPE,
            DRIVE_READONLY_SCOPE,
            "openid",
            "email",
        ]);
    });

    it("tells a grant that can read folders from one that can't", () => {
        expect(grantsFolderAccess(`${DRIVE_FILE_SCOPE} openid email`)).toBe(false);
        expect(grantsFolderAccess(`openid ${DRIVE_READONLY_SCOPE} ${DRIVE_FILE_SCOPE}`)).toBe(true);
        expect(grantsFolderAccess("https://www.googleapis.com/auth/drive")).toBe(true);
        expect(grantsFolderAccess(null)).toBe(false);
    });

    it("honours the stand-in only where the /dev routes are served", () => {
        mockEnv.server.GOOGLE_STAND_IN_URL = "http://127.0.0.1:3031/dev/stand-ins/google/";
        expect(googleStandInUrl()).toBe("http://127.0.0.1:3031/dev/stand-ins/google");
        expect(driveApiBaseUrl()).toBe("http://127.0.0.1:3031/dev/stand-ins/google/drive/v3");

        const previous = process.env.NODE_ENV;
        const writable = process.env as Record<string, string | undefined>;
        writable.NODE_ENV = "production";
        try {
            expect(googleStandInUrl()).toBeNull();
            expect(driveApiBaseUrl()).toBeUndefined();
        } finally {
            writable.NODE_ENV = previous;
        }
    });
});

describe("where a synced file lands", () => {
    it("keeps Drive folder names as LaunchStack folder names", () => {
        expect(folderSegmentFor("Financials / FY27")).toBe("Financials - FY27");
        expect(folderSegmentFor("   ")).toBe("Drive folder");
        expect(folderSegmentFor("Unfiled")).toBe("Unfiled (Drive)");
        expect(folderSegmentFor("x".repeat(120))).toHaveLength(80);
    });

    it("rebuilds subfolders under the imported folder", () => {
        expect(placementPath("Acme Seed Data Room", [])).toBe("Acme Seed Data Room");
        expect(placementPath("Acme Seed Data Room", ["Financials", "Archive"])).toBe(
            "Acme Seed Data Room/Financials/Archive"
        );
        // Moved inside another folder in LaunchStack: new files follow it.
        expect(placementPath("Deals/Acme", ["Legal"])).toBe("Deals/Acme/Legal");
    });

    it("cuts a tree deeper than LaunchStack allows at the last folder that fits", () => {
        const deep = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
        expect(placementPath("Room", deep)).toBe("Room/a/b/c/d/e/f/g");
        const long = Array.from({ length: 4 }, (_, i) => `${i}`.repeat(80));
        const path = placementPath("Room", long);
        expect(path.length).toBeLessThanOrEqual(256);
        expect(path.split("/")).toHaveLength(4);
    });

    it("never reuses a name another folder already has", () => {
        expect(freeTopLevelPath("Data Room", new Set(["Other"]))).toBe("Data Room");
        expect(freeTopLevelPath("Data Room", new Set(["Data Room", "Data Room (2)"]))).toBe(
            "Data Room (3)"
        );
        const long = "y".repeat(80);
        expect(freeTopLevelPath(long, new Set([long]))).toHaveLength(80);
    });
});

describe("who owns what a pick brings in", () => {
    const ada = { companyId: 1n, userPk: 10n, authUserId: "auth_ada" };
    const ben = { companyId: 1n, userPk: 11n, authUserId: "auth_ben" };
    const pickers = new Map([[10, ada]]);

    it("is the person who picked it while they are an active member", () => {
        expect(ownerForPick(10, pickers, ben)).toBe(ada);
    });

    it("falls back to whoever connected Drive when the picker has left, or is unknown", () => {
        // 12 is not in the active-member map: left the workspace.
        expect(ownerForPick(12, pickers, ben)).toBe(ben);
        expect(ownerForPick(null, pickers, ben)).toBe(ben);
    });
});

describe("which missing files get flagged as removed from Drive", () => {
    const known = [
        { sourceId: "plan", pickedRootId: "room" },
        { sourceId: "memo", pickedRootId: "room" },
        { sourceId: "solo", pickedRootId: "solo" },
        { sourceId: "legacy", pickedRootId: null },
    ];

    it("flags everything missing when the grant can read folders", () => {
        expect(missingToMark(["plan", "solo", "legacy"], known, [])).toEqual([
            "plan",
            "solo",
            "legacy",
        ]);
    });

    it("leaves files under a picked folder the grant couldn't read unflagged", () => {
        // drive.file only: "room" listed empty, so its files are unseen, not gone.
        expect(missingToMark(["plan", "memo", "solo", "legacy"], known, ["room"])).toEqual([
            "solo",
            "legacy",
        ]);
    });
});

describe("Google Picker views", () => {
    it("opens on everything, Shared with me, and Shared drives", () => {
        const calls: string[][] = [];
        class FakeView implements PickerView {
            readonly log: string[] = [];
            constructor() {
                calls.push(this.log);
            }
            setIncludeFolders(v: boolean) {
                this.log.push(`folders:${v}`);
                return this;
            }
            setSelectFolderEnabled(v: boolean) {
                this.log.push(`selectFolder:${v}`);
                return this;
            }
            setOwnedByMe(v: boolean) {
                this.log.push(`ownedByMe:${v}`);
                return this;
            }
            setEnableDrives(v: boolean) {
                this.log.push(`drives:${v}`);
                return this;
            }
        }
        const views = buildDriveViews({ DocsView: FakeView });
        expect(views).toHaveLength(3);
        expect(calls).toEqual([
            ["folders:true", "selectFolder:true"],
            ["folders:true", "selectFolder:true", "ownedByMe:false"],
            ["folders:true", "selectFolder:true", "drives:true"],
        ]);
    });
});

describe("Drive client", () => {
    it("searches a shared drive's folder inside that drive, at the configured base", async () => {
        const urls: string[] = [];
        const client = createDriveClient({
            accessToken: "t",
            baseUrl: "http://127.0.0.1:9/drive/v3/",
            fetch: async url => {
                urls.push(url);
                return new Response(JSON.stringify({ files: [] }), { status: 200 });
            },
        });
        await client.listChildren("folder-1", undefined, "drive-1");
        await client.listChildren("folder-2");

        const shared = new URL(urls[0]!);
        expect(shared.origin + shared.pathname).toBe("http://127.0.0.1:9/drive/v3/files");
        expect(shared.searchParams.get("corpora")).toBe("drive");
        expect(shared.searchParams.get("driveId")).toBe("drive-1");
        expect(shared.searchParams.get("includeItemsFromAllDrives")).toBe("true");
        const mine = new URL(urls[1]!);
        expect(mine.searchParams.has("corpora")).toBe(false);
    });
});

describe("resolveDriveLink (against the Google stand-in)", () => {
    const realFetch = global.fetch;
    const STAND_IN = "http://127.0.0.1:3031/dev/stand-ins/google";

    function connection(scopes: string): ConnectorConnection {
        return {
            id: 1,
            scopes,
            providerAccountEmail: "alex.rivera@example.com",
        } as unknown as ConnectorConnection;
    }

    function tokenFor(scopes: string[]): string {
        const token = `test-token-${scopes.length}`;
        googleWorld().tokens[token] = { scopes, expiresAt: Date.now() + 60_000 };
        return token;
    }

    beforeEach(() => {
        resetGoogleWorld();
        mockEnv.server.GOOGLE_STAND_IN_URL = STAND_IN;
        global.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
            handleGoogleRequest(new Request(input, init))) as typeof fetch;
    });
    afterEach(() => {
        global.fetch = realFetch;
    });

    it("resolves a shared folder's link to a picked folder", async () => {
        jest.mocked(getAccessTokenForConnection).mockResolvedValue(
            tokenFor([DRIVE_FILE_SCOPE, DRIVE_READONLY_SCOPE])
        );
        const result = await resolveDriveLink(
            connection(`${DRIVE_FILE_SCOPE} ${DRIVE_READONLY_SCOPE}`),
            "https://drive.google.com/drive/folders/sa-dataroom?usp=sharing"
        );
        expect(result).toEqual({
            ok: true,
            item: {
                fileId: "sa-dataroom",
                kind: "folder",
                name: "Acme Seed Data Room",
                mimeType: "application/vnd.google-apps.folder",
            },
        });
    });

    it("says who to ask when the account can't open the link", async () => {
        jest.mocked(getAccessTokenForConnection).mockResolvedValue(
            tokenFor([DRIVE_FILE_SCOPE, DRIVE_READONLY_SCOPE])
        );
        const result = await resolveDriveLink(
            connection(`${DRIVE_FILE_SCOPE} ${DRIVE_READONLY_SCOPE}`),
            "https://drive.google.com/drive/folders/1NotSharedWithAlexAtAll"
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toBe("not-found");
            expect(result.message).toContain(
                "Ask its owner to share it with alex.rivera@example.com"
            );
        }
    });

    it("refuses before calling Drive when the grant can't read folders, or it isn't a link", async () => {
        jest.mocked(getAccessTokenForConnection).mockClear();
        const filesOnly = await resolveDriveLink(
            connection(`${DRIVE_FILE_SCOPE} openid email`),
            "https://drive.google.com/drive/folders/sa-dataroom"
        );
        expect(filesOnly).toMatchObject({ ok: false, reason: "no-folder-access" });
        const garbage = await resolveDriveLink(connection(DRIVE_READONLY_SCOPE), "hello");
        expect(garbage).toMatchObject({ ok: false, reason: "not-a-link" });
        expect(getAccessTokenForConnection).not.toHaveBeenCalled();
    });
});
