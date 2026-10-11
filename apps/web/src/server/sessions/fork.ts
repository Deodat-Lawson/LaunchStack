/**
 * "Continue in a new chat" (ADR-014 §4): copy a chat you can read into a new,
 * private chat of your own, in one transaction.
 *
 * What comes along is what you could see: citations and pinned sources are
 * filtered to your scope first, exactly as reading it filters them, so a fork
 * can never carry a teammate's private evidence into your history. The new
 * chat remembers where it came from (`forked_from_session_id`, and the first
 * turn's `forkedFromSessionId` the chat header links back through).
 *
 * The client-side "Fork from here" on your own chat is a different verb — it
 * copies a prefix — and stays where it is.
 */

import { randomUUID } from "node:crypto";

import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { db } from "~/server/db";
import { workspaceSessionMessages, workspaceSessions } from "~/server/db/schema";
import { recordActivity } from "~/server/workspace/activity";

import { resolveSessionAccess } from "./access";
import { transcriptFor } from "./reader";
import { sessionDetail } from "./repository";

/** Rows per insert: well under Postgres' bind-parameter cap for any transcript. */
const INSERT_CHUNK = 200;
const TITLE_MAX = 300;

export function forkTitle(title: string): string {
    const suffix = " (copy)";
    const base = title.trim() || "Chat";
    return base.length + suffix.length > TITLE_MAX
        ? `${base.slice(0, TITLE_MAX - suffix.length - 1)}…${suffix}`
        : `${base}${suffix}`;
}

/** Null when the caller cannot read the source chat — a 404, like every other chat route. */
export async function forkSession(
    ctx: WorkspaceContext,
    sessionId: string
): Promise<{ id: string; title: string } | null> {
    const access = await resolveSessionAccess(ctx, sessionId);
    if (!access) return null;
    const source = access.session;
    const detail = await sessionDetail(source);
    const transcript = await transcriptFor(ctx, detail);

    const id = randomUUID();
    const title = forkTitle(source.title);
    const now = new Date();
    const mine = access.level === "owner";

    await db.transaction(async tx => {
        await tx.insert(workspaceSessions).values({
            id,
            companyId: ctx.companyId,
            userId: ctx.authUserId,
            title,
            contextSourceIds: transcript.contextSourceIds,
            // The imported-transcript context came from a document the reader
            // may not be able to open; only the owner's own fork keeps it.
            continuation: mine ? (source.continuation ?? null) : null,
            agentKey: source.agentKey ?? null,
            messageCount: transcript.messages.length,
            lastMessageAt: now,
            createdAt: now,
            updatedAt: now,
            forkedFromSessionId: source.id,
        });

        const rows = transcript.messages.map((message, index) => {
            // A question someone else asked stays theirs in your copy.
            const askedBy =
                message.role === "user"
                    ? (message.metadata?.askedBy ?? source.userId)
                    : message.metadata?.askedBy;
            const metadata = {
                ...(message.metadata ?? {}),
                ...(index === 0 ? { forkedFromSessionId: source.id } : {}),
            };
            if (askedBy && askedBy !== ctx.authUserId) metadata.askedBy = askedBy;
            else delete metadata.askedBy;
            return {
                sessionId: id,
                seq: index,
                role: message.role,
                text: message.text,
                refs: message.refs ?? null,
                citations: message.citations ?? null,
                attachments: message.attachments ?? null,
                model: message.model ?? null,
                tokens: message.tokens ?? null,
                agentKey: message.agentKey ?? null,
                metadata: Object.keys(metadata).length > 0 ? metadata : null,
                createdAt: new Date(message.createdAt),
            };
        });
        for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK) {
            await tx
                .insert(workspaceSessionMessages)
                .values(rows.slice(offset, offset + INSERT_CHUNK));
        }

        // Someone continuing your chat is news to you (and to whoever else
        // reads it); forking your own is not.
        if (!mine) {
            await recordActivity(tx, {
                companyId: ctx.companyId,
                actorUserId: ctx.authUserId,
                verb: "forked",
                targetType: "chat",
                targetId: source.id,
                targetLabel: source.title,
                detail: { ownerUserId: source.userId },
            });
        }
    });

    return { id, title };
}
