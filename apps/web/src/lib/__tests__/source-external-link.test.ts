import {
    driveFileUrl,
    externalLinkHost,
    githubRepoOrigin,
    githubRepoUrl,
    isSourceExternalLink,
    originUrlMarker,
    sourceExternalLink,
    type ExternalLinkContext,
} from "../source-external-link";
import { artifactDocumentMarker } from "../artifact-document";
import { websiteDocumentMarker } from "../website-document";

/**
 * Every source gets one way out of LaunchStack: where it came from, or the
 * stored file. The stored metadata is the importer's word, so nothing but a
 * checked http(s) address (or an app link built here) may come back.
 */

const ME = "7";
const context = (owners: Record<string, string> = {}): ExternalLinkContext => ({
    viewerUserPk: ME,
    connectionOwners: new Map(Object.entries(owners)),
});
const FILE = "/api/files/12";
const DRIVE_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz";

describe("sourceExternalLink", () => {
    it("opens an upload as the stored file", () => {
        expect(sourceExternalLink({ ocrMetadata: null, fileUrl: FILE }, context())).toEqual({
            kind: "file",
            url: FILE,
        });
    });

    it("has nothing to open without an origin or a stored file", () => {
        expect(sourceExternalLink({ ocrMetadata: null, fileUrl: null }, context())).toBeNull();
    });

    it("opens a synced Drive file in Drive, and a native Doc in its editor", () => {
        const binary = {
            connector: "google-drive",
            driveFileId: DRIVE_ID,
            driveMimeType: "application/pdf",
        };
        expect(sourceExternalLink({ ocrMetadata: binary, fileUrl: FILE }, context())).toEqual({
            kind: "google-drive",
            url: `https://drive.google.com/file/d/${DRIVE_ID}/view`,
        });
        const doc = { ...binary, driveMimeType: "application/vnd.google-apps.spreadsheet" };
        expect(sourceExternalLink({ ocrMetadata: doc, fileUrl: FILE }, context())?.url).toBe(
            `https://docs.google.com/spreadsheets/d/${DRIVE_ID}/edit`
        );
    });

    it("falls back to the stored copy when a connector's id is unusable", () => {
        const broken = { connector: "google-drive", driveFileId: "../../evil" };
        expect(sourceExternalLink({ ocrMetadata: broken, fileUrl: FILE }, context())).toEqual({
            kind: "file",
            url: FILE,
        });
    });

    it("opens a Notion page at its URL, or rebuilds it from the page id", () => {
        const page = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";
        expect(
            sourceExternalLink(
                {
                    ocrMetadata: {
                        connector: "notion",
                        notionUrl: `https://www.notion.so/Plan-${page}`,
                    },
                    fileUrl: FILE,
                },
                context()
            )
        ).toEqual({ kind: "notion", url: `https://www.notion.so/Plan-${page}` });
        // A URL off Notion's hosts is not trusted; the id still is.
        expect(
            sourceExternalLink(
                {
                    ocrMetadata: {
                        connector: "notion",
                        notionUrl: "https://evil.example/phish",
                        notionPageId: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
                    },
                    fileUrl: FILE,
                },
                context()
            )
        ).toEqual({ kind: "notion", url: `https://www.notion.so/${page}` });
    });

    it("opens a Gmail thread only for the mailbox's owner", () => {
        const thread = {
            connector: "gmail",
            connectionId: "4",
            gmailLink: "https://mail.google.com/mail/?authuser=ada%40acme.com#all/18c2",
        };
        expect(
            sourceExternalLink({ ocrMetadata: thread, fileUrl: FILE }, context({ "4": ME }))
        ).toEqual({ kind: "gmail", url: thread.gmailLink });
        // Shared with someone else: Gmail would say "not found", the copy opens.
        expect(
            sourceExternalLink({ ocrMetadata: thread, fileUrl: FILE }, context({ "4": "99" }))
        ).toEqual({ kind: "file", url: FILE });
    });

    it("opens an Outlook conversation only for the mailbox's owner", () => {
        const conversation = {
            connector: "outlook",
            connectionId: "6",
            outlookLink: "https://outlook.office365.com/owa/?ItemID=AAMk%3D&exvsurl=1",
        };
        expect(
            sourceExternalLink({ ocrMetadata: conversation, fileUrl: FILE }, context({ "6": ME }))
        ).toEqual({ kind: "outlook", url: conversation.outlookLink });
        // Shared with someone else: Outlook would not find it, the copy opens.
        expect(
            sourceExternalLink({ ocrMetadata: conversation, fileUrl: FILE }, context({ "6": "99" }))
        ).toEqual({ kind: "file", url: FILE });
        // A link that is not Outlook's is never followed.
        expect(
            sourceExternalLink(
                {
                    ocrMetadata: { ...conversation, outlookLink: "https://outlook.evil.test/owa" },
                    fileUrl: FILE,
                },
                context({ "6": ME })
            )
        ).toEqual({ kind: "file", url: FILE });
        // A conversation Graph sent no link for opens as the stored copy.
        expect(
            sourceExternalLink(
                { ocrMetadata: { ...conversation, outlookLink: null }, fileUrl: FILE },
                context({ "6": ME })
            )
        ).toEqual({ kind: "file", url: FILE });
    });

    it("opens an Obsidian note in the owner's vault, encoded", () => {
        const note = {
            connector: "obsidian",
            obsidianOwner: ME,
            obsidianVault: "Work notes",
            obsidianPath: "Plans/Q4 & beyond.md",
        };
        expect(sourceExternalLink({ ocrMetadata: note, fileUrl: FILE }, context())).toEqual({
            kind: "obsidian",
            url: "obsidian://open?vault=Work%20notes&file=Plans%2FQ4%20%26%20beyond.md",
        });
        expect(
            sourceExternalLink(
                { ocrMetadata: { ...note, obsidianOwner: "99" }, fileUrl: FILE },
                context()
            )?.kind
        ).toBe("file");
    });

    it("opens a document linked to Drive in its Drive copy", () => {
        const link = `https://docs.google.com/document/d/${DRIVE_ID}/edit`;
        expect(
            sourceExternalLink({ ocrMetadata: null, fileUrl: FILE, driveLinkUrl: link }, context())
        ).toEqual({ kind: "google-drive", url: link });
        // Only a Drive address counts as one.
        expect(
            sourceExternalLink(
                { ocrMetadata: null, fileUrl: FILE, driveLinkUrl: "https://evil.example" },
                context()
            )?.kind
        ).toBe("file");
    });

    it("opens a GitHub import on GitHub", () => {
        const marker = originUrlMarker(githubRepoUrl("acme", "app", "release/2.0"));
        expect(sourceExternalLink({ ocrMetadata: marker, fileUrl: FILE }, context())).toEqual({
            kind: "github",
            url: "https://github.com/acme/app/tree/release/2.0",
        });
        expect(githubRepoUrl("acme", "app")).toBe("https://github.com/acme/app");
    });

    it("tells archive expansion where each file of a GitHub import lives", () => {
        expect(githubRepoOrigin("acme", "app")).toEqual({
            originUrl: "https://github.com/acme/app",
            originEntryBaseUrl: "https://github.com/acme/app/blob/HEAD/",
        });
        expect(githubRepoOrigin("acme", "app", "release/2.0").originEntryBaseUrl).toBe(
            "https://github.com/acme/app/blob/release/2.0/"
        );
        // An extracted file carries its own address, which opens on GitHub.
        expect(
            sourceExternalLink(
                {
                    ocrMetadata: originUrlMarker("https://github.com/acme/app/blob/HEAD/src/a.ts"),
                    fileUrl: FILE,
                },
                context()
            )
        ).toEqual({ kind: "github", url: "https://github.com/acme/app/blob/HEAD/src/a.ts" });
    });

    it("opens a saved page on its site", () => {
        const marker = websiteDocumentMarker({ url: "https://www.acme.com/about" });
        expect(sourceExternalLink({ ocrMetadata: marker, fileUrl: FILE }, context())).toEqual({
            kind: "web",
            url: "https://www.acme.com/about",
        });
    });

    it("opens a YouTube transcript on YouTube and another video at its address", () => {
        const youtube = { source: "sidecar-ytdlp", videoUrl: "https://youtu.be/dQw4w9WgXcQ" };
        expect(sourceExternalLink({ ocrMetadata: youtube, fileUrl: FILE }, context())).toEqual({
            kind: "youtube",
            url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        });
        const loom = { source: "sidecar-ytdlp", videoUrl: "https://www.loom.com/share/abc" };
        expect(sourceExternalLink({ ocrMetadata: loom, fileUrl: FILE }, context())).toEqual({
            kind: "web",
            url: "https://www.loom.com/share/abc",
        });
    });

    it("opens an artifact where it was imported from", () => {
        const claude = artifactDocumentMarker({
            artifactType: "html",
            sourceUrl: "https://claude.ai/public/artifacts/abc",
        });
        expect(sourceExternalLink({ ocrMetadata: claude, fileUrl: FILE }, context())?.kind).toBe(
            "claude"
        );
        const pasted = artifactDocumentMarker({ artifactType: "html", sourceUrl: null });
        expect(sourceExternalLink({ ocrMetadata: pasted, fileUrl: FILE }, context())?.kind).toBe(
            "file"
        );
    });

    it("never hands back a script or data URL", () => {
        for (const url of ["javascript:alert(1)", "data:text/html,<script>1</script>"]) {
            expect(
                sourceExternalLink({ ocrMetadata: originUrlMarker(url), fileUrl: FILE }, context())
            ).toEqual({ kind: "file", url: FILE });
        }
    });
});

describe("driveFileUrl", () => {
    it("rejects anything that is not a Drive id", () => {
        expect(driveFileUrl("a/b")).toBeNull();
        expect(driveFileUrl("short")).toBeNull();
    });
});

describe("externalLinkHost", () => {
    it("names the site, the repository on GitHub, and nothing for the file", () => {
        expect(externalLinkHost({ kind: "web", url: "https://www.acme.com/about" })).toBe(
            "acme.com"
        );
        expect(
            externalLinkHost({ kind: "github", url: "https://github.com/acme/app/tree/main" })
        ).toBe("github.com/acme/app");
        expect(externalLinkHost({ kind: "file", url: FILE })).toBeNull();
    });
});

describe("isSourceExternalLink", () => {
    it("accepts only the kinds this module makes", () => {
        expect(isSourceExternalLink({ kind: "file", url: FILE })).toBe(true);
        expect(isSourceExternalLink({ kind: "ftp", url: FILE })).toBe(false);
        expect(isSourceExternalLink({ kind: "file", url: "" })).toBe(false);
        expect(isSourceExternalLink(null)).toBe(false);
    });
});
