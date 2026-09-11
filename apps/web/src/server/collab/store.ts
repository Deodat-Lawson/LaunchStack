/**
 * Postgres-backed `ChannelStore`.
 *
 * The engine's contract is four operations; the only one with a real
 * concurrency requirement is `append`, which has to hand out a gap-free `seq`
 * even when a local turn, a remote worker's reply, and a Slack message land at
 * the same instant. That is done by locking the channel row and reading
 * `max(seq)` inside the same transaction, with a unique index on
 * `(channel_id, seq)` as the backstop.
 */

import { and, asc, eq, gt, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { collabChannel, collabMessage } from "~/server/db/schema";
import type {
    Channel,
    ChannelMessage,
    ChannelMessageInput,
    ChannelStore,
    MessageListener,
    ReadOptions,
} from "@launchstack/collab";
import { db } from "~/server/db";

type ChannelRow = typeof collabChannel.$inferSelect;
type MessageRow = typeof collabMessage.$inferSelect;

function toChannel(row: ChannelRow): Channel {
    return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        topic: row.topic ?? undefined,
        workspaceId: String(row.companyId),
        createdAt: row.createdAt.toISOString(),
        slackChannelId: row.slackChannelId ?? undefined,
        archived: row.archived,
    };
}

function toMessage(row: MessageRow): ChannelMessage {
    return {
        id: row.id,
        channelId: row.channelId,
        seq: row.seq,
        ts: row.createdAt.toISOString(),
        author: {
            kind: row.authorKind,
            id: row.authorId,
            displayName: row.authorName,
            onBehalfOfPersonaId: row.onBehalfOfPersonaId ?? undefined,
        },
        text: row.body,
        kind: row.kind,
        threadId: row.threadId ?? undefined,
        slackTs: row.slackTs ?? undefined,
        meta: (row.meta as Record<string, unknown> | null) ?? undefined,
    };
}

export class PostgresChannelStore implements ChannelStore {
    /**
     * Subscribers are per-process. A single-process deployment (Docker, a
     * self-hosted node) gets live fan-out to the Slack bridge and to connected
     * workers; a multi-replica deployment gets it only for messages produced by
     * the same replica. Cross-replica fan-out needs LISTEN/NOTIFY and is a
     * deliberate follow-up, not an accident.
     */
    private readonly listeners = new Map<string, Set<MessageListener>>();

    async createChannel(
        input: Omit<Channel, "createdAt"> & { createdAt?: string; createdByUserId?: string }
    ): Promise<Channel> {
        const [row] = await db
            .insert(collabChannel)
            .values({
                id: input.id,
                companyId: BigInt(input.workspaceId),
                slug: input.slug,
                name: input.name,
                topic: input.topic,
                slackChannelId: input.slackChannelId,
                archived: input.archived ?? false,
                createdByUserId: input.createdByUserId,
                ...(input.createdAt ? { createdAt: new Date(input.createdAt) } : {}),
            })
            .returning();
        if (!row) throw new Error("Failed to create channel");
        return toChannel(row);
    }

    async getChannel(channelId: string): Promise<Channel | null> {
        const [row] = await db
            .select()
            .from(collabChannel)
            .where(eq(collabChannel.id, channelId))
            .limit(1);
        return row ? toChannel(row) : null;
    }

    async getChannelBySlug(workspaceId: string, slug: string): Promise<Channel | null> {
        const [row] = await db
            .select()
            .from(collabChannel)
            .where(
                and(eq(collabChannel.companyId, BigInt(workspaceId)), eq(collabChannel.slug, slug))
            )
            .limit(1);
        return row ? toChannel(row) : null;
    }

    async listChannels(workspaceId: string): Promise<Channel[]> {
        const rows = await db
            .select()
            .from(collabChannel)
            .where(eq(collabChannel.companyId, BigInt(workspaceId)))
            .orderBy(asc(collabChannel.createdAt));
        return rows.map(toChannel);
    }

    async updateChannel(
        channelId: string,
        patch: Partial<Omit<Channel, "id">>
    ): Promise<Channel | null> {
        const [row] = await db
            .update(collabChannel)
            .set({
                ...(patch.name !== undefined ? { name: patch.name } : {}),
                ...(patch.topic !== undefined ? { topic: patch.topic } : {}),
                ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
                ...(patch.slackChannelId !== undefined
                    ? { slackChannelId: patch.slackChannelId }
                    : {}),
                ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
            })
            .where(eq(collabChannel.id, channelId))
            .returning();
        return row ? toChannel(row) : null;
    }

    async append(input: ChannelMessageInput): Promise<ChannelMessage> {
        const row = await db.transaction(async tx => {
            // Lock the channel so concurrent appends serialize on this row rather
            // than racing for the same seq and failing the unique index.
            const [channel] = await tx
                .select({ id: collabChannel.id })
                .from(collabChannel)
                .where(eq(collabChannel.id, input.channelId))
                .for("update")
                .limit(1);
            if (!channel) throw new Error(`Unknown channel ${input.channelId}`);

            const [seqRow] = await tx
                .select({ maxSeq: sql<number>`COALESCE(MAX(${collabMessage.seq}), 0)` })
                .from(collabMessage)
                .where(eq(collabMessage.channelId, input.channelId));

            const [inserted] = await tx
                .insert(collabMessage)
                .values({
                    id: `msg_${randomUUID().replace(/-/g, "")}`,
                    channelId: input.channelId,
                    seq: Number(seqRow?.maxSeq ?? 0) + 1,
                    authorKind: input.author.kind,
                    authorId: input.author.id,
                    authorName: input.author.displayName,
                    onBehalfOfPersonaId: input.author.onBehalfOfPersonaId,
                    body: input.text,
                    kind: input.kind ?? "chat",
                    threadId: input.threadId,
                    slackTs: input.slackTs,
                    meta: input.meta,
                })
                .returning();
            if (!inserted) throw new Error("Failed to append message");
            return inserted;
        });

        const message = toMessage(row);
        for (const listener of this.listeners.get(input.channelId) ?? []) {
            try {
                listener(message);
            } catch {
                // Subscribers own their error handling; the message is committed.
            }
        }
        return message;
    }

    async read(channelId: string, options: ReadOptions = {}): Promise<ChannelMessage[]> {
        const conditions = [eq(collabMessage.channelId, channelId)];
        if (options.afterSeq && options.afterSeq > 0) {
            conditions.push(gt(collabMessage.seq, options.afterSeq));
        }
        const query = db
            .select()
            .from(collabMessage)
            .where(and(...conditions))
            .orderBy(asc(collabMessage.seq));
        const rows = options.limit !== undefined ? await query.limit(options.limit) : await query;
        return rows.map(toMessage);
    }

    async getMessage(messageId: string): Promise<ChannelMessage | null> {
        const [row] = await db
            .select()
            .from(collabMessage)
            .where(eq(collabMessage.id, messageId))
            .limit(1);
        return row ? toMessage(row) : null;
    }

    async latestSeq(channelId: string): Promise<number> {
        const [row] = await db
            .select({ maxSeq: sql<number>`COALESCE(MAX(${collabMessage.seq}), 0)` })
            .from(collabMessage)
            .where(eq(collabMessage.channelId, channelId));
        return Number(row?.maxSeq ?? 0);
    }

    subscribe(channelId: string, listener: MessageListener): () => void {
        let set = this.listeners.get(channelId);
        if (!set) {
            set = new Set();
            this.listeners.set(channelId, set);
        }
        set.add(listener);
        return () => {
            set.delete(listener);
            if (set.size === 0) this.listeners.delete(channelId);
        };
    }
}

/**
 * One store per process. The instance identity matters: subscriptions live on
 * it, so the Slack bridge and the hub must hold the same object the API routes
 * write through.
 */
const globalForStore = globalThis as unknown as { __collabStore?: PostgresChannelStore };

export function getChannelStore(): PostgresChannelStore {
    globalForStore.__collabStore ??= new PostgresChannelStore();
    return globalForStore.__collabStore;
}
