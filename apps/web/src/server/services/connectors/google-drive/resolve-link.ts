/**
 * A pasted Drive link → the picked item it names. Only works with folder
 * access (drive.readonly): under drive.file the app can open nothing it was
 * not handed through the Picker, so a link to anything else answers 404.
 */

import {
    DriveAccessError,
    GOOGLE_FOLDER_MIME,
    GOOGLE_SHORTCUT_MIME,
    createDriveClient,
    type DriveFile,
} from "@launchstack/pipelines/connectors/google-drive";

import type { Copy } from "~/i18n/copy";
import { driveIdFromLink } from "~/lib/integrations/google-drive-link";
import type { ConnectorConnection } from "~/server/db/schema";
import { driveApiBaseUrl, grantsFolderAccess } from "~/server/services/google-drive/config";
import { getAccessTokenForConnection } from "~/server/services/google-drive/connections";

import type { PickedItemInput } from "./store";

export type ResolvedDriveLink =
    | { readonly ok: true; readonly item: PickedItemInput }
    | {
          readonly ok: false;
          readonly reason: "not-a-link" | "no-folder-access" | "not-found" | "trashed";
          /** English, for API readers and logs. */
          readonly message: string;
          /** The same sentence for a screen to word in its reader's language. */
          readonly copy: Copy;
      };

export async function resolveDriveLink(
    connection: ConnectorConnection,
    link: string
): Promise<ResolvedDriveLink> {
    const fileId = driveIdFromLink(link);
    if (!fileId) {
        return {
            ok: false,
            reason: "not-a-link",
            message: "That isn't a Google Drive link. In Drive, use Share › Copy link.",
            copy: { key: "sources.driveConnect.notDriveLink" },
        };
    }
    if (!grantsFolderAccess(connection.scopes)) {
        return {
            ok: false,
            reason: "no-folder-access",
            message:
                "This connection can only open files picked in Google's picker. Allow folder access to add links.",
            copy: { key: "sources.server.drive.linkNeedsFolderAccess" },
        };
    }

    const client = createDriveClient({
        accessToken: await getAccessTokenForConnection(connection),
        baseUrl: driveApiBaseUrl(),
    });
    const account = connection.providerAccountEmail ?? "the connected Google account";
    let file: DriveFile;
    try {
        file = await client.getFile(fileId);
        if (file.mimeType === GOOGLE_SHORTCUT_MIME && file.shortcutDetails?.targetId) {
            file = await client.getFile(file.shortcutDetails.targetId);
        }
    } catch (error) {
        if (error instanceof DriveAccessError) {
            return {
                ok: false,
                reason: "not-found",
                message: `${account} can't open that link. Ask its owner to share it with ${account}, then paste it again.`,
                copy: connection.providerAccountEmail
                    ? {
                          key: "sources.server.drive.linkNotFound",
                          values: { account: connection.providerAccountEmail },
                      }
                    : { key: "sources.server.drive.linkNotFoundAccount" },
            };
        }
        throw error;
    }
    if (file.trashed) {
        return {
            ok: false,
            reason: "trashed",
            message: `"${file.name}" is in the Drive trash.`,
            copy: { key: "sources.server.drive.linkTrashed", values: { name: file.name } },
        };
    }

    return {
        ok: true,
        item: {
            fileId: file.id,
            kind: file.mimeType === GOOGLE_FOLDER_MIME ? "folder" : "file",
            name: file.name,
            mimeType: file.mimeType,
        },
    };
}
