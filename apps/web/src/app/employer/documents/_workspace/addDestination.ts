/**
 * Where an addition lands and who will be able to open it — the words the
 * "Add a source" dialog shows above every upload. Pure, so the sentence a
 * person reads is pinned beside the rules the server applies when the file
 * arrives (ADR-014, `applyDocumentCreationDefaults` / `claimNewFolderPath`):
 *
 * - No folder (Unfiled): private to whoever adds it.
 * - An existing folder: the file takes that folder's audience.
 * - A folder that does not exist yet: a new top-level folder is private to
 *   whoever creates it; a new subfolder follows the folder it is made in.
 */

import type { useTranslations } from "next-intl";

import type { GrantLevel, PrincipalType } from "~/lib/authz/permissions";
import {
    folderAncestors,
    folderLeafName,
    folderPathIssue,
    isUnfiledFolder,
    joinFolderPath,
    normalizeFolderPath,
    splitFolderPath,
} from "~/lib/folders/path";

import type { ItemAccessView, SourceAudience } from "./types";

/**
 * `useTranslations("sources")`: the dialog's words live in
 * `sources.addDestination`, and borrow `sources.audience` and
 * `sources.folderIssues`.
 */
export type DestinationTranslator = ReturnType<typeof useTranslations<"sources">>;

// ---------------------------------------------------------------------------
// Destination
// ---------------------------------------------------------------------------

/**
 * `unfiled` — no folder; `folder` — one that exists; `new-top` — a top-level
 * folder this addition will create; `new-sub` — a subfolder it will create
 * inside one that exists.
 */
export type DestinationKind = "unfiled" | "folder" | "new-top" | "new-sub";

export interface Destination {
    path: string;
    kind: DestinationKind;
    /** Path segments, for the breadcrumb; empty for Unfiled. */
    crumbs: string[];
    /**
     * The existing folder whose sharing the addition will follow: the
     * destination itself, or for a new subfolder the nearest folder above it.
     * Null when the answer is "only you" without asking (Unfiled, new top).
     */
    audienceFrom: string | null;
}

/** Where `rawPath` is, given the folders the person can see. */
export function resolveDestination(rawPath: string, known: readonly string[]): Destination {
    const path = normalizeFolderPath(rawPath);
    if (isUnfiledFolder(path)) return { path, kind: "unfiled", crumbs: [], audienceFrom: null };
    const crumbs = splitFolderPath(path);
    const existing = new Set(known.map(normalizeFolderPath));
    if (existing.has(path)) return { path, kind: "folder", crumbs, audienceFrom: path };
    const nearest = [...folderAncestors(path)].reverse().find(a => existing.has(a)) ?? null;
    return nearest === null
        ? { path, kind: "new-top", crumbs, audienceFrom: null }
        : { path, kind: "new-sub", crumbs, audienceFrom: nearest };
}

/**
 * A folder a connector files into (Drive, Coding sessions). The connector
 * makes it as an ordinary workspace folder when it does not exist yet
 * (`ensureCategoryRow`), not as a private new one — so its audience is always
 * whatever the server says about the path, never "only you" by rule.
 */
export function connectorDestination(rawPath: string): Destination {
    const path = normalizeFolderPath(rawPath);
    return { path, kind: "folder", crumbs: splitFolderPath(path), audienceFrom: path };
}

// ---------------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------------

/** One person, group or role that can open the folder. */
export interface AudiencePrincipal {
    type: PrincipalType;
    name: string;
    /** A person's auth subject id, for their photo. */
    authUserId?: string | null;
    /** The person adding — listed first, as "You". */
    self: boolean;
}

/** What the server says about the folder the addition follows (`/api/workspace/folders/by-path`). */
export interface FolderAudienceFacts {
    /** Whether the folder has its own audience, or inherits one. */
    visibility: "workspace" | "restricted";
    grants: readonly {
        principalType: PrincipalType;
        principalName: string;
        level: GrantLevel;
        authUserId?: string | null;
    }[];
    audienceCount: number;
    canManage: boolean;
    inheritsFrom: { path: string | null; restricted: boolean };
    workspaceName: string;
}

/**
 * Who can open the folder: its own grants when it is restricted, or those of
 * the restricted folder it inherits from, plus anyone added to it directly.
 * Nothing restricting it at all means the workspace, and an empty list.
 */
export function audiencePrincipals(
    folder: FolderAudienceFacts,
    governing: FolderAudienceFacts | null,
    selfAuthId: string | null
): AudiencePrincipal[] {
    const restrictedHere = folder.visibility === "restricted";
    const inherited = !restrictedHere && folder.inheritsFrom.restricted;
    if (!restrictedHere && !inherited) return [];
    const grants = restrictedHere
        ? folder.grants
        : [...(governing?.grants ?? []), ...folder.grants];
    const seen = new Set<string>();
    const out: AudiencePrincipal[] = [];
    for (const g of grants) {
        const key = `${g.principalType}:${g.authUserId ?? g.principalName}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
            type: g.principalType,
            name: g.principalName,
            authUserId: g.authUserId ?? null,
            self: g.principalType === "user" && !!selfAuthId && g.authUserId === selfAuthId,
        });
    }
    // You first, then people, then groups, then roles — the order a person reads them.
    const rank = (p: AudiencePrincipal) =>
        p.self ? 0 : p.type === "user" ? 1 : p.type === "group" ? 2 : 3;
    return out.sort((a, b) => rank(a) - rank(b));
}

/** The answer to "who can see it", in the words the dialog shows. */
export interface AudienceSummary {
    tone: SourceAudience;
    /** "Only you", "Everyone at Acme", "Specific people". */
    headline: string;
    /** One sentence on why. */
    detail: string;
}

/** "Q4 planning / Pricing" → "Pricing". */
const leaf = (path: string) => folderLeafName(path);

/**
 * What to tell the person adding. `tone` is the audience of `audienceFrom`
 * as the folder list reports it (`ItemAccessView.audience`) — known before
 * any request — and null while it is not known.
 */
export function summarizeAudience(
    t: DestinationTranslator,
    dest: Destination,
    tone: SourceAudience | null,
    options: {
        workspaceName?: string | null;
        governingPath?: string | null;
        /** People who can open it, once known — "Shared with 4 people". */
        count?: number | null;
    } = {}
): AudienceSummary | null {
    const onlyYou = t("audience.onlyYou");
    const everyone = options.workspaceName
        ? t("audience.everyoneAt", { workspace: options.workspaceName })
        : t("audience.everyoneInWorkspace");

    if (dest.kind === "unfiled") {
        return {
            tone: "private",
            headline: onlyYou,
            detail: t("addDestination.unfiledPrivate"),
        };
    }
    if (dest.kind === "new-top") {
        return {
            tone: "private",
            headline: onlyYou,
            detail: t("addDestination.newTopPrivate", { folder: leaf(dest.path) }),
        };
    }
    if (tone === null || dest.audienceFrom === null) return null;

    const from = dest.audienceFrom;
    const shared =
        options.count != null
            ? t("addDestination.sharedWithPeople", { count: options.count })
            : t("addDestination.specificPeople");
    const headline = tone === "private" ? onlyYou : tone === "workspace" ? everyone : shared;

    if (dest.kind === "new-sub") {
        const values = { folder: leaf(dest.path), parent: leaf(from) };
        const detail =
            tone === "private"
                ? t("addDestination.newSubPrivate", values)
                : t("addDestination.newSubFollows", values);
        return { tone, headline, detail };
    }

    const name = leaf(dest.path);
    const governing =
        options.governingPath && normalizeFolderPath(options.governingPath) !== dest.path
            ? leaf(options.governingPath)
            : null;
    if (tone === "private") {
        return {
            tone,
            headline,
            detail: governing
                ? t("addDestination.followsPrivate", { folder: name, governing })
                : t("addDestination.privateToYou", { folder: name }),
        };
    }
    if (tone === "workspace") {
        return {
            tone,
            headline,
            detail: t("addDestination.workspaceCanOpen", { folder: name }),
        };
    }
    return {
        tone,
        headline,
        detail: governing
            ? t("addDestination.followsSharing", { folder: name, governing })
            : t("addDestination.sharedOnly", { folder: name }),
    };
}

/**
 * The audience tag for a folder in the picker: "Only you", "Shared",
 * "Everyone". No count: the folder list counts grants (a group is one), and
 * a number beside "Shared with 4 people" in the bar would read as a mismatch.
 */
export function folderAudienceTag(
    t: DestinationTranslator,
    access: Pick<ItemAccessView, "audience"> | undefined
): { tone: SourceAudience; label: string } | null {
    if (!access) return null;
    switch (access.audience) {
        case "private":
            return { tone: "private", label: t("addDestination.tagOnlyYou") };
        case "shared":
            return { tone: "shared", label: t("addDestination.tagShared") };
        case "workspace":
            return { tone: "workspace", label: t("addDestination.tagEveryone") };
    }
}

/** "3 people", "1 person". */
export function peopleCount(t: DestinationTranslator, n: number): string {
    return t("addDestination.peopleCount", { count: n });
}

/** "Q4 planning / Pricing", or "No folder" for Unfiled. */
export function destinationLabel(t: DestinationTranslator, path: string): string {
    return isUnfiledFolder(path) ? t("addDestination.noFolder") : splitFolderPath(path).join(" / ");
}

// ---------------------------------------------------------------------------
// Folder upload
// ---------------------------------------------------------------------------

export interface FolderUploadPlan {
    /** The folder the picked one becomes: `<destination>/<root>`, or `<root>` at the top. */
    root: string;
    /** For each file, in order, the folder it is filed in. */
    paths: string[];
    /** How many distinct folders the files land in, the root included. */
    folderCount: number;
    /** Why the plan cannot be uploaded as is; empty when it can. */
    problems: string[];
}

/**
 * Where each file of a picked folder lands: inside the destination, under a
 * folder named `rootName`, keeping the subfolders it had on disk.
 * `relativePaths` are the browser's `webkitRelativePath`s
 * ("Q3 data/raw/a.csv"); their first segment is the picked folder itself.
 */
export function planFolderUpload(
    t: DestinationTranslator,
    destination: string,
    rootName: string,
    relativePaths: readonly string[]
): FolderUploadPlan {
    const base = isUnfiledFolder(destination) ? null : normalizeFolderPath(destination);
    const name = rootName.replace(/\s+/g, " ").trim();
    const root = joinFolderPath(base, name);
    const paths = relativePaths.map(rel => {
        const segments = splitFolderPath(rel);
        // Drop the picked folder's own name and the file name.
        return joinFolderPath(root, ...segments.slice(1, -1));
    });
    const distinct = [...new Set(paths)];
    const problems: string[] = [];
    if (!name) problems.push(t("addDestination.noName"));
    else if (name.includes("/")) problems.push(t("addDestination.noSlash"));
    else {
        for (const path of distinct) {
            const issue = folderPathIssue(path);
            if (issue) {
                const problem = t(`folderIssues.${issue.code}`, issue);
                problems.push(t("addDestination.pathProblem", { path, problem }));
                break;
            }
        }
    }
    return { root, paths, folderCount: distinct.length, problems };
}
