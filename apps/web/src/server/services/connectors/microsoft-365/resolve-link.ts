/**
 * A pasted OneDrive or SharePoint link → the picked item it names. Microsoft
 * resolves the link itself (`/shares/{token}/driveItem`), as the connected
 * account: a link that account cannot open answers 403 or 404, which reads
 * here as "ask its owner to share it".
 */

import {
    createMicrosoft365Client,
    Microsoft365AccessError,
    Microsoft365ApiError,
    type GraphDriveItem,
} from "@launchstack/pipelines/connectors/microsoft-365";

import type { Copy } from "~/i18n/copy";
import { microsoft365LinkFrom } from "~/lib/integrations/microsoft-365-link";
import type { ConnectorConnection } from "~/server/db/schema";
import { graphApiBaseUrl } from "~/server/services/microsoft/config";
import { getMicrosoftAccessToken } from "~/server/services/microsoft/connections";

import type { PickedItemInput } from "./store";

export type ResolvedMicrosoft365Link =
    | { readonly ok: true; readonly item: PickedItemInput }
    | {
          readonly ok: false;
          readonly reason: "not-a-link" | "not-found" | "unsupported";
          /** English, for API readers and logs. */
          readonly message: string;
          /** The same sentence for a screen to word in its reader's language. */
          readonly copy: Copy;
      };

/**
 * A Graph item as a picked row, or null for what cannot be picked: a OneNote
 * notebook, or an item Graph did not place in a drive. A "shared with me"
 * pointer is followed to the drive the item really lives in.
 */
export function pickedItemFromGraph(
    item: GraphDriveItem,
    fallbackDriveId?: string
): PickedItemInput | null {
    const remote = item.remoteItem;
    const driveId =
        remote?.parentReference?.driveId ?? item.parentReference?.driveId ?? fallbackDriveId;
    const itemId = remote?.id ?? item.id;
    const folder = remote ? Boolean(remote.folder) : Boolean(item.folder);
    const file = remote ? remote.file : item.file;
    if (!driveId || !itemId) return null;
    if (!folder && !file) return null;
    return {
        driveId,
        itemId,
        kind: folder ? "folder" : "file",
        name: remote?.name ?? item.name,
        mimeType: folder ? null : (file?.mimeType ?? null),
        webUrl: item.webUrl ?? null,
    };
}

export async function resolveMicrosoft365Link(
    connection: ConnectorConnection,
    link: string
): Promise<ResolvedMicrosoft365Link> {
    const url = microsoft365LinkFrom(link);
    if (!url) {
        return {
            ok: false,
            reason: "not-a-link",
            message:
                "That isn't a OneDrive or SharePoint link. In OneDrive or SharePoint, use Share, then Copy link.",
            copy: { key: "sources.microsoft365Source.notMicrosoftLink" },
        };
    }

    const client = createMicrosoft365Client({
        accessToken: await getMicrosoftAccessToken(connection),
        baseUrl: graphApiBaseUrl(),
    });
    const account = connection.providerAccountEmail ?? "the connected Microsoft account";
    let item: GraphDriveItem;
    try {
        item = await client.getSharedItem(url);
    } catch (error) {
        // 400 is Microsoft saying the address is not a sharing link it knows.
        const unknownLink = error instanceof Microsoft365ApiError && error.status === 400;
        if (error instanceof Microsoft365AccessError || unknownLink) {
            return {
                ok: false,
                reason: "not-found",
                message: `${account} can't open that link. Ask its owner to share it with ${account}, then paste it again.`,
                copy: connection.providerAccountEmail
                    ? {
                          key: "sources.server.microsoft365.linkNotFound",
                          values: { account: connection.providerAccountEmail },
                      }
                    : { key: "sources.server.microsoft365.linkNotFoundAccount" },
            };
        }
        throw error;
    }

    const picked = pickedItemFromGraph(item);
    if (!picked) {
        return {
            ok: false,
            reason: "unsupported",
            message: `"${item.name}" is not a file or a folder, so it can't be added.`,
            copy: {
                key: "sources.server.microsoft365.linkUnsupported",
                values: { name: item.name },
            },
        };
    }
    return { ok: true, item: picked };
}
