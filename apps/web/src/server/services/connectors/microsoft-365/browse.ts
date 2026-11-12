/**
 * What the built-in OneDrive and SharePoint browser shows: one folder's
 * children, the SharePoint sites a search finds, a site's document
 * libraries. Read as the connected account, so the browser shows exactly
 * what a sync could reach.
 *
 * A folder is read to its end here, up to BROWSE_MAX_ITEMS: Microsoft's
 * "next page" address is never handed to the browser and taken back, since
 * fetching an address a client sent, with the workspace's token, would let
 * that client point the token anywhere.
 */

import {
    resolveMicrosoft365Action,
    type GraphDrive,
    type GraphDriveItem,
    type GraphSite,
    type Microsoft365Client,
} from "@launchstack/pipelines/connectors/microsoft-365";

/** Children shown for one folder; a larger folder says it was cut short. */
export const BROWSE_MAX_ITEMS = 1000;

export interface BrowseItem {
    readonly driveId: string;
    readonly itemId: string;
    readonly kind: "file" | "folder";
    readonly name: string;
    readonly mimeType: string | null;
    readonly size: number | null;
    readonly modifiedAt: string | null;
    readonly webUrl: string | null;
    /** False for a file type LaunchStack can't read: shown, not selectable. */
    readonly supported: boolean;
}

export interface BrowseDrive {
    readonly driveId: string;
    readonly name: string;
    /** `personal`, `business` or `documentLibrary`, as Microsoft reports it. */
    readonly driveType: string | null;
    readonly webUrl: string | null;
}

export interface BrowseSite {
    readonly siteId: string;
    readonly name: string;
    readonly webUrl: string | null;
}

export interface BrowseFolder {
    readonly drive: BrowseDrive | null;
    readonly folder: { readonly driveId: string; readonly itemId: string };
    readonly items: readonly BrowseItem[];
    /** The folder holds more than BROWSE_MAX_ITEMS; the rest is not listed. */
    readonly truncated: boolean;
}

/** One child as a row, or null for what is neither a file nor a folder (a OneNote notebook). */
export function browseItemFrom(item: GraphDriveItem, listedDriveId: string): BrowseItem | null {
    const action = resolveMicrosoft365Action(item);
    const remote = item.remoteItem;
    // A "shared with me" entry points at an item in someone else's drive.
    const driveId =
        remote?.parentReference?.driveId ?? item.parentReference?.driveId ?? listedDriveId;
    const itemId = remote?.id ?? item.id;
    const isFolder = remote ? Boolean(remote.folder) : Boolean(item.folder);
    const file = remote ? remote.file : item.file;
    if (!isFolder && !file) return null;
    if (item.package || item.deleted) return null;

    return {
        driveId,
        itemId,
        kind: isFolder ? "folder" : "file",
        name: remote?.name ?? item.name,
        mimeType: isFolder ? null : (file?.mimeType ?? null),
        size: typeof item.size === "number" ? item.size : null,
        modifiedAt: item.lastModifiedDateTime ?? null,
        webUrl: item.webUrl ?? null,
        supported:
            isFolder ||
            action.action === "download" ||
            // A shared file's type is settled when it is followed.
            action.action === "resolve-remote",
    };
}

function byKindThenName(a: BrowseItem, b: BrowseItem): number {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
}

/** The first of `names` that says something; Microsoft sends empty names as well as none. */
function firstName(...names: readonly (string | null | undefined)[]): string | null {
    for (const name of names) {
        const trimmed = name?.trim();
        if (trimmed) return trimmed;
    }
    return null;
}

export function browseDriveFrom(drive: GraphDrive, fallbackName: string): BrowseDrive {
    return {
        driveId: drive.id,
        name: firstName(drive.name) ?? fallbackName,
        driveType: drive.driveType ?? null,
        webUrl: drive.webUrl ?? null,
    };
}

export async function browseFolder(
    client: Microsoft365Client,
    driveId: string,
    itemId: string
): Promise<Omit<BrowseFolder, "drive">> {
    const items: BrowseItem[] = [];
    let nextLink: string | undefined;
    let truncated = false;
    do {
        const page = await client.listChildren(driveId, itemId, nextLink);
        for (const child of page.value) {
            const row = browseItemFrom(child, driveId);
            if (row) items.push(row);
        }
        nextLink = page["@odata.nextLink"];
        if (nextLink && items.length >= BROWSE_MAX_ITEMS) {
            truncated = true;
            break;
        }
    } while (nextLink);
    return {
        folder: { driveId, itemId },
        items: items.slice(0, BROWSE_MAX_ITEMS).sort(byKindThenName),
        truncated: truncated || items.length > BROWSE_MAX_ITEMS,
    };
}

/** The connected account's own OneDrive, opened at its top. */
export async function browseMyDrive(
    client: Microsoft365Client,
    fallbackName: string
): Promise<BrowseFolder> {
    const drive = await client.getMyDrive();
    return {
        drive: browseDriveFrom(drive, fallbackName),
        ...(await browseFolder(client, drive.id, "root")),
    };
}

export function browseSiteFrom(site: GraphSite): BrowseSite {
    return {
        siteId: site.id,
        name: firstName(site.displayName, site.name, site.webUrl) ?? site.id,
        webUrl: site.webUrl ?? null,
    };
}

/** SharePoint sites matching `query`; every site the account can see when it is empty. */
export async function browseSites(
    client: Microsoft365Client,
    query: string
): Promise<BrowseSite[]> {
    const sites = await client.searchSites(query.trim() || "*");
    return sites
        .map(browseSiteFrom)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export async function browseSiteDrives(
    client: Microsoft365Client,
    siteId: string,
    fallbackName: string
): Promise<BrowseDrive[]> {
    const drives = await client.listSiteDrives(siteId);
    return drives.map(drive => browseDriveFrom(drive, fallbackName));
}
