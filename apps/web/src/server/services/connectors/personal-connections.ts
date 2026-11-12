/**
 * A member's own connections (`connector_connections.owner_user_id`: Gmail
 * and Notion) and what becomes of them when the member is gone.
 *
 * A personal connection belongs to its member, not to the workspace, so it
 * lasts exactly as long as their membership:
 *
 * - **Removed, or left.** The connection row goes (its sync state and scope
 *   cascade) and its grant is revoked at Google or Notion once the
 *   transaction commits (`revokePersonalGrants`, bounded so a hung provider
 *   never holds the request). A Notion connection's pages stay, and its
 *   folder is handed over like the member's other sole-managed items.
 *   The mail it brought in goes too: every document still inside the
 *   member's Gmail folder, and the folder. A mailbox was private to its owner
 *   (ADR-014 kept the `Gmail` subtree out of the admin carry-over), so nobody
 *   inherits it. Mail the member moved out of that folder was put in front of
 *   the team on purpose and is handed over like their other files.
 * - **Suspended, or moved to a role that can't add files.** The sync pauses
 *   (`personalSyncStanding`) and picks up again if they are reinstated.
 *
 * Two things keep the cleanup to what is theirs, and complete:
 *
 * - Disconnecting keeps a mailbox's folder, so someone else may since have
 *   connected the same Google account into it. A mailbox another connection
 *   syncs into belongs to that connection and stays.
 * - A sync already running when its owner goes can write after the cleanup.
 *   It sweeps its mailbox when it ends (`sweepMailboxOfClosedConnection`).
 *
 * A sync that finds its owner already gone, removed before this rule
 * existed, applies the departure rule itself (`closePersonalConnectionsNow`).
 */

import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, sql } from "drizzle-orm";

import { decryptSecret } from "@launchstack/store/crypto";
import { category, document } from "@launchstack/store/schema";
import { resolvePermissionsForRole } from "~/lib/authz/resolve";
import { UNFILED_FOLDER, isFolderOrDescendant, normalizeFolderPath } from "~/lib/folders/path";
import { db } from "~/server/db";
import {
    connectorConnections,
    folderGrants,
    mindmaps,
    userCompanyMemberships,
    users,
} from "~/server/db/schema";
import { descendantPattern } from "~/server/folders";
import { deleteDocumentCore } from "~/server/services/document-delete";
import type { Tx } from "~/server/workspace/db-types";

import {
    GMAIL_PROVIDER,
    GMAIL_ROOT_FOLDER,
    gmailFolderFor,
    isPersonalMailboxPath,
} from "./gmail/config";
import { revokeConnectionTokens, type ConnectionTokens } from "./revoke";

/** Personal providers whose grants are Google's, revoked at Google's endpoint. */
const GOOGLE_PERSONAL_PROVIDERS: ReadonlySet<string> = new Set([GMAIL_PROVIDER]);

export interface ClosedPersonalConnections {
    readonly connections: number;
    readonly documents: number;
    readonly folders: number;
    /** Which connections closed, for one audit line each. */
    readonly closed: readonly { readonly id: number; readonly provider: string }[];
    /** Refresh tokens to revoke at Google once the transaction has committed. */
    readonly googleTokensToRevoke: readonly string[];
    /** Other providers' grants (Notion) to revoke once it has committed. */
    readonly otherGrantsToRevoke: readonly {
        readonly provider: string;
        readonly tokens: ConnectionTokens;
    }[];
}

function decryptOrNull(ciphertext: string | null): string | null {
    if (!ciphertext) return null;
    try {
        return decryptSecret(ciphertext);
    } catch {
        return null; // a key-rotation casualty can't be revoked; the row goes regardless
    }
}

/**
 * The mailbox folders that are this member's: the folder each of their
 * Gmail connections syncs into (the sync's own naming), plus any Gmail
 * folder carrying the manage grant they gave themselves when it was made
 * (the owner signature `folderOwner` reads), so a mailbox whose connection
 * was already disconnected is found too.
 */
async function ownedMailboxPaths(
    tx: Tx,
    companyId: bigint,
    userPk: bigint,
    authUserId: string | null,
    accountEmails: readonly string[]
): Promise<string[]> {
    const paths = new Set(accountEmails.map(email => gmailFolderFor(email)));
    if (authUserId) {
        const signed = await tx
            .select({ name: category.name })
            .from(folderGrants)
            .innerJoin(category, eq(category.id, folderGrants.categoryId))
            .where(
                and(
                    eq(folderGrants.companyId, companyId),
                    eq(folderGrants.principalType, "user"),
                    eq(folderGrants.principalId, userPk.toString()),
                    eq(folderGrants.level, "manage"),
                    eq(folderGrants.grantedBy, authUserId)
                )
            );
        for (const row of signed) {
            const path = normalizeFolderPath(row.name);
            if (isPersonalMailboxPath(path)) paths.add(path);
        }
    }
    return [...paths];
}

/**
 * Mailbox folders a Gmail connection still syncs into, leaving out
 * `exceptOwner`'s own. Disconnecting keeps a mailbox's folder and grants, so
 * someone else may since have connected the same Google account into it;
 * that mailbox is theirs now, whatever older grants still say.
 */
async function mailboxesStillConnected(
    tx: Tx,
    companyId: bigint,
    exceptOwner: bigint | null
): Promise<Set<string>> {
    const rows = await tx
        .select({
            ownerUserId: connectorConnections.ownerUserId,
            accountEmail: connectorConnections.providerAccountEmail,
            ownerEmail: users.email,
        })
        .from(connectorConnections)
        .leftJoin(users, sql`${users.id} = ${connectorConnections.ownerUserId}`)
        .where(
            and(
                eq(connectorConnections.companyId, companyId),
                eq(connectorConnections.provider, GMAIL_PROVIDER)
            )
        );
    const paths = new Set<string>();
    for (const row of rows) {
        if (exceptOwner !== null && row.ownerUserId === exceptOwner) continue;
        const email = row.accountEmail ?? row.ownerEmail;
        if (email) paths.add(gmailFolderFor(email));
    }
    return paths;
}

/** Deletes the mail in `mailboxes` (and beneath them), then the folders themselves. */
async function deleteMailboxes(
    tx: Tx,
    companyId: bigint,
    mailboxes: readonly string[],
    requestedBy: string
): Promise<{ documents: number; folders: number }> {
    if (mailboxes.length === 0) return { documents: 0, folders: 0 };
    const inMailbox = (path: string | null) =>
        mailboxes.some(mailbox => isFolderOrDescendant(normalizeFolderPath(path), mailbox));

    let documents = 0;
    const mail = await tx
        .select({ id: document.id, category: document.category })
        .from(document)
        .where(
            and(
                eq(document.companyId, companyId),
                like(document.category, descendantPattern(GMAIL_ROOT_FOLDER))
            )
        );
    const traceId = randomUUID();
    for (const doc of mail) {
        if (!inMailbox(doc.category)) continue;
        await deleteDocumentCore(tx, Number(doc.id), {
            requestedBy,
            reason: "connector_disconnect",
            traceId,
        });
        documents++;
    }

    // A draft filed in a mailbox goes back to its maker's Unfiled.
    const drafts = await tx
        .select({ id: mindmaps.id, folder: mindmaps.folder })
        .from(mindmaps)
        .where(
            and(
                eq(mindmaps.companyId, companyId),
                like(mindmaps.folder, descendantPattern(GMAIL_ROOT_FOLDER))
            )
        );
    const strayDrafts = drafts.filter(draft => inMailbox(draft.folder)).map(d => d.id);
    if (strayDrafts.length > 0) {
        await tx
            .update(mindmaps)
            .set({ folder: UNFILED_FOLDER })
            .where(inArray(mindmaps.id, strayDrafts));
    }

    // Folder settings and grants cascade with the category rows.
    const folderRows = await tx
        .select({ id: category.id, name: category.name })
        .from(category)
        .where(
            and(
                eq(category.companyId, companyId),
                like(category.name, descendantPattern(GMAIL_ROOT_FOLDER))
            )
        );
    const doomed = folderRows.filter(row => inMailbox(row.name)).map(row => row.id);
    if (doomed.length > 0) await tx.delete(category).where(inArray(category.id, doomed));
    return { documents, folders: doomed.length };
}

/**
 * Ends every personal connection `userPk` holds in `companyId`, inside the
 * caller's transaction: the rows, the mail still in their mailbox folders,
 * and those folders. Revoking the grants at Google is network work, so the
 * tokens come back for `revokePersonalGrants` to send after the commit.
 *
 * The rows are locked first, so a sync finishing at the same moment waits
 * for this to commit before it checks what it left behind
 * (`sweepMailboxOfClosedConnection`).
 */
export async function closePersonalConnections(
    tx: Tx,
    companyId: bigint,
    userPk: bigint
): Promise<ClosedPersonalConnections> {
    const [user] = await tx
        .select({ authUserId: users.userId, email: users.email })
        .from(users)
        .where(eq(users.id, Number(userPk)))
        .limit(1);
    const connections = await tx
        .select()
        .from(connectorConnections)
        .where(
            and(
                eq(connectorConnections.companyId, companyId),
                eq(connectorConnections.ownerUserId, userPk)
            )
        )
        .for("update");

    const googleTokensToRevoke: string[] = [];
    const otherGrantsToRevoke: { provider: string; tokens: ConnectionTokens }[] = [];
    for (const row of connections) {
        if (GOOGLE_PERSONAL_PROVIDERS.has(row.provider)) {
            const refreshToken = decryptOrNull(row.refreshTokenCiphertext);
            if (refreshToken) googleTokensToRevoke.push(refreshToken);
            continue;
        }
        const tokens = {
            accessToken: decryptOrNull(row.accessTokenCiphertext),
            refreshToken: decryptOrNull(row.refreshTokenCiphertext),
        };
        if (tokens.accessToken || tokens.refreshToken) {
            otherGrantsToRevoke.push({ provider: row.provider, tokens });
        }
    }

    // The sync names the folder after the connected account, falling back
    // to the member's own address (gmail/sync-service.ts).
    const accountEmails = connections
        .filter(row => row.provider === GMAIL_PROVIDER)
        .map(row => row.providerAccountEmail ?? user?.email ?? null)
        .filter((email): email is string => Boolean(email));
    const owned = await ownedMailboxPaths(
        tx,
        companyId,
        userPk,
        user?.authUserId ?? null,
        accountEmails
    );
    const others = await mailboxesStillConnected(tx, companyId, userPk);
    const { documents, folders } = await deleteMailboxes(
        tx,
        companyId,
        owned.filter(path => !others.has(path)),
        "system:connector_disconnect"
    );

    if (connections.length > 0) {
        await tx.delete(connectorConnections).where(
            inArray(
                connectorConnections.id,
                connections.map(row => row.id)
            )
        );
    }

    return {
        connections: connections.length,
        documents,
        folders,
        closed: connections.map(row => ({ id: row.id, provider: row.provider })),
        googleTokensToRevoke,
        otherGrantsToRevoke,
    };
}

/**
 * Best effort, after the commit: a copied token dies with its connection.
 * Each revocation is bounded (`revokeConnectionTokens`), so a provider that
 * hangs costs seconds, never the removal it follows.
 */
export async function revokePersonalGrants(closed: ClosedPersonalConnections): Promise<void> {
    await Promise.all([
        ...closed.googleTokensToRevoke.map(refreshToken =>
            revokeConnectionTokens(GMAIL_PROVIDER, { accessToken: null, refreshToken })
        ),
        ...closed.otherGrantsToRevoke.map(grant =>
            revokeConnectionTokens(grant.provider, grant.tokens)
        ),
    ]);
}

/** `closePersonalConnections` in a transaction of its own, then the revocations. */
export async function closePersonalConnectionsNow(
    companyId: bigint,
    userPk: bigint
): Promise<ClosedPersonalConnections> {
    const closed = await db.transaction(tx => closePersonalConnections(tx, companyId, userPk));
    await revokePersonalGrants(closed);
    return closed;
}

/**
 * A sync already running when its connection was closed can still write
 * after the cleanup: it may make the folder again and store mail in it. The
 * sync calls this when it ends, however it ends. If its connection is gone,
 * the mailbox it wrote into goes too, unless another connection now syncs
 * into it. Null when there was nothing to sweep.
 *
 * The connection is read with a row lock, so a removal still in progress is
 * waited for, not raced: this sees either the live row or everything the
 * removal left.
 */
export async function sweepMailboxOfClosedConnection(
    companyId: bigint,
    connectionId: number,
    mailbox: string
): Promise<{ documents: number; folders: number } | null> {
    return db.transaction(async tx => {
        const [live] = await tx
            .select({ id: connectorConnections.id })
            .from(connectorConnections)
            .where(eq(connectorConnections.id, connectionId))
            .for("update");
        if (live) return null;
        const path = normalizeFolderPath(mailbox);
        if (!isPersonalMailboxPath(path)) return null;
        if ((await mailboxesStillConnected(tx, companyId, null)).has(path)) return null;
        return deleteMailboxes(tx, companyId, [path], "system:connector_disconnect");
    });
}

/**
 * Whether a personal connection's owner may still sync into this workspace.
 *
 * - `active`: an active member whose role may add files (`documents.upload`,
 *   the same permission that let them connect).
 * - `paused`: still a member, but suspended or pending, or their role no
 *   longer adds files. Nothing is deleted; reinstating them resumes the sync.
 * - `departed`: no membership at all. They were removed or left.
 */
export type PersonalSyncStanding = "active" | "paused" | "departed";

export async function personalSyncStanding(
    companyId: bigint,
    ownerUserPk: bigint
): Promise<PersonalSyncStanding> {
    const [membership] = await db
        .select({ role: userCompanyMemberships.role, status: userCompanyMemberships.status })
        .from(userCompanyMemberships)
        .where(
            and(
                eq(userCompanyMemberships.companyId, companyId),
                eq(userCompanyMemberships.userId, ownerUserPk)
            )
        )
        .limit(1);
    if (!membership) return "departed";
    if (membership.status !== "active") return "paused";
    const permissions = await resolvePermissionsForRole(companyId, membership.role);
    return permissions.has("documents.upload") ? "active" : "paused";
}
