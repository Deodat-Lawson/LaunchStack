/**
 * GET /api/connectors/outlook/folders: the caller's mail folders, live from
 * Outlook, for the folder picker: the whole tree, flattened, parents before
 * their children. Each entry names its parent and carries its path
 * (`Clients/Acme`), so the picker draws the tree without asking again.
 *
 * The folders people think in come first (Inbox, Sent, Archive); the ones
 * nobody wants synced are left out with everything inside them (Junk,
 * Deleted Items, Outbox, Drafts, sync and conversation housekeeping).
 */

import {
    createOutlookClient,
    listOutlookFolderTree,
} from "@launchstack/pipelines/connectors/outlook";

import { createSuccessResponse, handleApiError } from "~/lib/api-utils";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import {
    requireOutlookWriter,
    requireOwnActiveOutlookConnection,
} from "~/server/services/connectors/outlook/guard";
import { graphApiBaseUrl } from "~/server/services/microsoft/config";
import { getMicrosoftAccessToken } from "~/server/services/microsoft/connections";

export const runtime = "nodejs";

/** Shown first among their siblings, in this order. Keys are Graph's `wellKnownName`s. */
const WELL_KNOWN_ORDER: Record<string, number> = {
    inbox: 0,
    sentitems: 1,
    archive: 2,
};

/** Never offered: nothing a person wants in their knowledge base. */
const WELL_KNOWN_HIDDEN = new Set([
    "junkemail",
    "deleteditems",
    "outbox",
    "drafts",
    "conversationhistory",
    "syncissues",
    "conflicts",
    "localfailures",
    "serverfailures",
    "recoverableitemsdeletions",
    "scheduled",
    "searchfolders",
    "clutter",
]);

interface ShownFolder {
    readonly id: string;
    readonly name: string;
    /** Display names from the top of the mailbox down. */
    readonly path: string;
    /** Null at the top of the mailbox. */
    readonly parentId: string | null;
    readonly messageCount: number | null;
}

export async function GET(request: Request) {
    return withRateLimit(request, RateLimitPresets.standard, async () => {
        try {
            const guard = await requireOutlookWriter();
            if (!guard.ok) return guard.response;
            const own = await requireOwnActiveOutlookConnection(guard.ctx);
            if (!own.ok) return own.response;

            const accessToken = await getMicrosoftAccessToken(own.connection);
            const client = createOutlookClient({ accessToken, baseUrl: graphApiBaseUrl() });
            const tree = await listOutlookFolderTree(client);

            // The walk is parents-first, so a hidden folder is known before
            // anything inside it is reached.
            const listed = new Set(tree.map(folder => folder.id));
            const hidden = new Set<string>();
            const byParent = new Map<string | null, (ShownFolder & { order: number })[]>();
            for (const folder of tree) {
                const wellKnown = folder.wellKnownName?.toLowerCase() ?? "";
                const parentId =
                    folder.parentFolderId && listed.has(folder.parentFolderId)
                        ? folder.parentFolderId
                        : null;
                if (WELL_KNOWN_HIDDEN.has(wellKnown) || (parentId && hidden.has(parentId))) {
                    hidden.add(folder.id);
                    continue;
                }
                const siblings = byParent.get(parentId) ?? [];
                siblings.push({
                    id: folder.id,
                    name: folder.displayName,
                    path: folder.path,
                    parentId,
                    messageCount: folder.totalItemCount ?? null,
                    order: WELL_KNOWN_ORDER[wellKnown] ?? 100,
                });
                byParent.set(parentId, siblings);
            }

            const folders: ShownFolder[] = [];
            const emit = (parentId: string | null) => {
                const siblings = (byParent.get(parentId) ?? []).sort(
                    (a, b) => a.order - b.order || a.name.localeCompare(b.name)
                );
                for (const folder of siblings) {
                    folders.push({
                        id: folder.id,
                        name: folder.name,
                        path: folder.path,
                        parentId: folder.parentId,
                        messageCount: folder.messageCount,
                    });
                    emit(folder.id);
                }
            };
            emit(null);

            return createSuccessResponse({ folders });
        } catch (error) {
            return handleApiError(error, request);
        }
    });
}
