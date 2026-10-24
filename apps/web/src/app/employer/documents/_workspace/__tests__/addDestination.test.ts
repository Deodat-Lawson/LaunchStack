import { createTranslator } from "use-intl";

import { englishMessages } from "~/i18n/messages";

import {
    audiencePrincipals,
    connectorDestination,
    destinationLabel,
    folderAudienceTag,
    planFolderUpload,
    resolveDestination,
    summarizeAudience,
    type FolderAudienceFacts,
} from "../addDestination";

/**
 * The "Add a source" dialog says where an addition lands and who will be able
 * to open it before anything is uploaded. These pin those sentences to the
 * rules the server applies on arrival (ADR-014): loose files are private, a
 * filed one takes its folder's audience, a new top-level folder is private to
 * its creator, and a new subfolder follows the folder it is made in.
 */

const t = createTranslator({ locale: "en", messages: englishMessages, namespace: "sources" });

const KNOWN = ["Q4 planning", "Q4 planning/Pricing", "Test Folder", "Unfiled"];

describe("resolveDestination", () => {
    it("treats Unfiled as no folder, answered without asking the server", () => {
        expect(resolveDestination("Unfiled", KNOWN)).toEqual({
            path: "Unfiled",
            kind: "unfiled",
            crumbs: [],
            audienceFrom: null,
        });
    });

    it("follows an existing folder's own audience", () => {
        const dest = resolveDestination("Q4 planning/Pricing", KNOWN);
        expect(dest.kind).toBe("folder");
        expect(dest.audienceFrom).toBe("Q4 planning/Pricing");
        expect(dest.crumbs).toEqual(["Q4 planning", "Pricing"]);
    });

    it("knows a top-level folder that does not exist yet starts private", () => {
        const dest = resolveDestination("Board deck", KNOWN);
        expect(dest.kind).toBe("new-top");
        expect(dest.audienceFrom).toBeNull();
    });

    it("sends a new subfolder to the nearest folder that exists above it", () => {
        const dest = resolveDestination("Q4 planning/Pricing/2027/Drafts", KNOWN);
        expect(dest.kind).toBe("new-sub");
        expect(dest.audienceFrom).toBe("Q4 planning/Pricing");
    });

    it("normalizes stray separators and spaces before matching", () => {
        expect(resolveDestination(" Q4 planning / Pricing ", KNOWN).kind).toBe("folder");
    });

    it("treats a connector's folder as described by the server, even before it exists", () => {
        expect(connectorDestination("Google Drive")).toEqual({
            path: "Google Drive",
            kind: "folder",
            crumbs: ["Google Drive"],
            audienceFrom: "Google Drive",
        });
    });
});

describe("summarizeAudience", () => {
    it("says a loose file is yours alone", () => {
        const s = summarizeAudience(t, resolveDestination("Unfiled", KNOWN), null);
        expect(s).toEqual({
            tone: "private",
            headline: "Only you",
            detail: "Files with no folder stay private until you share them.",
        });
    });

    it("says a new top-level folder starts private, before the server is asked", () => {
        const s = summarizeAudience(t, resolveDestination("Board deck", KNOWN), null);
        expect(s?.headline).toBe("Only you");
        expect(s?.detail).toBe("Board deck is a new folder. New folders start private to you.");
    });

    it("names the workspace for an open folder", () => {
        const s = summarizeAudience(t, resolveDestination("Test Folder", KNOWN), "workspace", {
            workspaceName: "Acme",
        });
        expect(s?.headline).toBe("Everyone at Acme");
        expect(s?.detail).toBe("Anyone in the workspace can open Test Folder.");
    });

    it("counts people for a shared folder once the count is known", () => {
        const dest = resolveDestination("Q4 planning", KNOWN);
        expect(summarizeAudience(t, dest, "shared")?.headline).toBe("Specific people");
        expect(summarizeAudience(t, dest, "shared", { count: 4 })?.headline).toBe(
            "Shared with 4 people"
        );
        expect(summarizeAudience(t, dest, "shared", { count: 1 })?.headline).toBe(
            "Shared with 1 person"
        );
    });

    it("says which folder an inheriting one follows", () => {
        const s = summarizeAudience(t, resolveDestination("Q4 planning/Pricing", KNOWN), "shared", {
            governingPath: "Q4 planning",
        });
        expect(s?.detail).toBe("Pricing follows Q4 planning's sharing.");
    });

    it("does not call a folder's own restriction 'following' itself", () => {
        const s = summarizeAudience(t, resolveDestination("Q4 planning", KNOWN), "shared", {
            governingPath: "Q4 planning",
        });
        expect(s?.detail).toBe("Only the people Q4 planning is shared with can open it.");
    });

    it("says a private folder is private, and an inheriting one why", () => {
        expect(
            summarizeAudience(t, resolveDestination("Q4 planning", KNOWN), "private")?.detail
        ).toBe("Q4 planning is private to you.");
        expect(
            summarizeAudience(t, resolveDestination("Q4 planning/Pricing", KNOWN), "private", {
                governingPath: "Q4 planning",
            })?.detail
        ).toBe("Pricing follows Q4 planning, which is private to you.");
    });

    it("explains a new subfolder follows its parent", () => {
        const dest = resolveDestination("Q4 planning/Drafts", KNOWN);
        expect(summarizeAudience(t, dest, "shared")?.detail).toBe(
            "Drafts is a new folder inside Q4 planning, so it follows Q4 planning's sharing."
        );
        expect(summarizeAudience(t, dest, "private")?.detail).toBe(
            "Drafts is a new folder inside Q4 planning, which is private to you."
        );
    });

    it("waits rather than guesses while a folder's audience is unknown", () => {
        expect(summarizeAudience(t, resolveDestination("Q4 planning", KNOWN), null)).toBeNull();
    });
});

describe("audiencePrincipals", () => {
    const facts = (over: Partial<FolderAudienceFacts>): FolderAudienceFacts => ({
        visibility: "workspace",
        grants: [],
        audienceCount: 8,
        canManage: false,
        inheritsFrom: { path: null, restricted: false },
        workspaceName: "Acme",
        ...over,
    });

    it("lists nobody for a workspace-wide folder", () => {
        expect(audiencePrincipals(facts({}), null, "me")).toEqual([]);
    });

    it("lists a restricted folder's own grants, you first, then people, groups, roles", () => {
        const out = audiencePrincipals(
            facts({
                visibility: "restricted",
                grants: [
                    { principalType: "role", principalName: "Admin", level: "manage" },
                    { principalType: "group", principalName: "Design", level: "view" },
                    {
                        principalType: "user",
                        principalName: "Ada",
                        level: "edit",
                        authUserId: "ada",
                    },
                    {
                        principalType: "user",
                        principalName: "Me",
                        level: "manage",
                        authUserId: "me",
                    },
                ],
            }),
            null,
            "me"
        );
        expect(out.map(p => [p.type, p.name, p.self])).toEqual([
            ["user", "Me", true],
            ["user", "Ada", false],
            ["group", "Design", false],
            ["role", "Admin", false],
        ]);
    });

    it("joins the governing folder's grants with anyone added to the inheriting one", () => {
        const out = audiencePrincipals(
            facts({
                inheritsFrom: { path: "Q4 planning", restricted: true },
                grants: [
                    {
                        principalType: "user",
                        principalName: "Ada",
                        level: "view",
                        authUserId: "ada",
                    },
                ],
            }),
            facts({
                visibility: "restricted",
                grants: [
                    {
                        principalType: "user",
                        principalName: "Ada",
                        level: "edit",
                        authUserId: "ada",
                    },
                    { principalType: "group", principalName: "Pricing team", level: "edit" },
                ],
            }),
            "me"
        );
        expect(out.map(p => p.name)).toEqual(["Ada", "Pricing team"]);
    });
});

describe("folderAudienceTag", () => {
    it("labels each folder in the picker without a count that could disagree with the bar", () => {
        const base = { principalCount: 3, ownAudience: true, canEdit: true, canManage: true };
        expect(folderAudienceTag(t, { ...base, audience: "private" })?.label).toBe("Only you");
        expect(folderAudienceTag(t, { ...base, audience: "shared" })?.label).toBe("Shared");
        expect(folderAudienceTag(t, { ...base, audience: "workspace" })?.label).toBe("Everyone");
        expect(folderAudienceTag(t, undefined)).toBeNull();
    });
});

describe("destinationLabel", () => {
    it("reads a path as a breadcrumb and Unfiled as no folder", () => {
        expect(destinationLabel(t, "Q4 planning/Pricing")).toBe("Q4 planning / Pricing");
        expect(destinationLabel(t, "Unfiled")).toBe("No folder");
    });
});

describe("planFolderUpload", () => {
    const FILES = ["Q3 data/summary.pdf", "Q3 data/raw/a.csv", "Q3 data/raw/deep/b.csv"];

    it("creates the picked folder inside the destination and keeps its subfolders", () => {
        const plan = planFolderUpload(t, "Q4 planning", "Q3 data", FILES);
        expect(plan.root).toBe("Q4 planning/Q3 data");
        expect(plan.paths).toEqual([
            "Q4 planning/Q3 data",
            "Q4 planning/Q3 data/raw",
            "Q4 planning/Q3 data/raw/deep",
        ]);
        expect(plan.folderCount).toBe(3);
        expect(plan.problems).toEqual([]);
    });

    it("puts it at the top level when there is no destination folder", () => {
        const plan = planFolderUpload(t, "Unfiled", "Q3 data", FILES);
        expect(plan.root).toBe("Q3 data");
        expect(plan.paths[1]).toBe("Q3 data/raw");
    });

    it("uses the name the person typed for the new folder", () => {
        const plan = planFolderUpload(t, "Q4 planning", "  Quarter   three ", FILES);
        expect(plan.root).toBe("Q4 planning/Quarter three");
        expect(plan.paths[2]).toBe("Q4 planning/Quarter three/raw/deep");
    });

    it("refuses an empty name or one with a slash", () => {
        expect(planFolderUpload(t, "Q4 planning", "  ", FILES).problems).toEqual([
            "Give the new folder a name.",
        ]);
        expect(planFolderUpload(t, "Q4 planning", "a/b", FILES).problems[0]).toMatch(/“\/”/);
    });

    it("refuses a tree deeper than folders may go", () => {
        const deep = ["Root/a/b/c/d/e/f/g/h/file.txt"];
        const plan = planFolderUpload(t, "Q4 planning", "Root", deep);
        expect(plan.problems.length).toBe(1);
    });
});
