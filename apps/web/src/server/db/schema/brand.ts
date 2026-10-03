/**
 * Product schema: Brand's channels, images and comments — the parts of the
 * Growth › Brand social-media manager that belong to a workspace's own
 * accounts. (Posts themselves are `brand_posts`, owned by the marketing
 * pipeline in `pipelines/src/marketing/schema.ts`.)
 *
 * A **connection** is one sign-in to a network and lives in
 * `connector_connections` with every other workspace grant (encrypted, one
 * row per account). A **channel** is one place a post can go out as: a
 * LinkedIn member's profile, each LinkedIn Page that member administers, a
 * Bluesky account. One LinkedIn connection therefore brings several
 * channels, and disconnecting it removes them (cascade).
 */
import { sql, type InferSelectModel } from "drizzle-orm";
import {
    bigint,
    boolean,
    index,
    integer,
    jsonb,
    text,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/pg-core";

import { brandPosts } from "@launchstack/pipelines/schema";
import { company } from "@launchstack/store/schema";
import { pgTable } from "@launchstack/store/schema/helpers";

import { connectorConnections } from "./connectors";

/** person = LinkedIn profile, organization = LinkedIn Page, account = Bluesky. */
export const BRAND_CHANNEL_KINDS = ["person", "organization", "account"] as const;
export type BrandChannelKind = (typeof BRAND_CHANNEL_KINDS)[number];

/** active, or reconnect: the network refused the credential for this channel. */
export const BRAND_CHANNEL_STATUSES = ["active", "reconnect"] as const;
export type BrandChannelStatus = (typeof BRAND_CHANNEL_STATUSES)[number];

/** What a channel can do, decided from the scopes its connection was granted. */
export interface BrandChannelCapabilities {
    publish: boolean;
    images: boolean;
    analytics: boolean;
    comments: boolean;
}

export const brandChannels = pgTable(
    "brand_channels",
    {
        id: varchar("id", { length: 64 }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        /** The sign-in this channel posts through; disconnecting it removes the channel. */
        connectionId: bigint("connection_id", { mode: "number" })
            .notNull()
            .references(() => connectorConnections.id, { onDelete: "cascade" }),
        platform: varchar("platform", { length: 20 }).notNull(),
        kind: varchar("kind", { length: 20, enum: BRAND_CHANNEL_KINDS }).notNull(),
        /** The network's id for the author: `urn:li:person:…`, `urn:li:organization:…`, a Bluesky DID. */
        externalId: varchar("external_id", { length: 256 }).notNull(),
        name: varchar("name", { length: 256 }).notNull(),
        /** LinkedIn vanity name, Bluesky handle. */
        handle: varchar("handle", { length: 256 }),
        avatarUrl: text("avatar_url"),
        profileUrl: text("profile_url"),
        /** LinkedIn Page role of the connecting member (ADMINISTRATOR, CONTENT_ADMINISTRATOR). */
        role: varchar("role", { length: 40 }),
        /** Offered in Compose. */
        enabled: boolean("enabled").notNull().default(true),
        capabilities: jsonb("capabilities").$type<BrandChannelCapabilities>().notNull(),
        status: varchar("status", { length: 20, enum: BRAND_CHANNEL_STATUSES })
            .notNull()
            .default("active"),
        statusReason: text("status_reason"),
        followers: integer("followers"),
        /** When numbers and comments were last read for this channel. */
        syncedAt: timestamp("synced_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => [
        // One channel per Page or account per workspace, whoever connected it.
        uniqueIndex("brand_channels_company_platform_external_unique").on(
            table.companyId,
            table.platform,
            table.externalId
        ),
        index("brand_channels_connection_idx").on(table.connectionId),
    ]
);
export type BrandChannelRow = InferSelectModel<typeof brandChannels>;

/**
 * An image uploaded in Compose, kept in the app's object storage until the
 * post that carries it goes out (networks take the bytes at publish time).
 */
export const brandMedia = pgTable(
    "brand_media",
    {
        id: varchar("id", { length: 64 }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        uploadedByUserId: varchar("uploaded_by_user_id", { length: 256 }).notNull(),
        /** The storage URL or key `fetchFile` reads back. Never sent to the browser. */
        storageUrl: text("storage_url").notNull(),
        mimeType: varchar("mime_type", { length: 100 }).notNull(),
        size: integer("size").notNull(),
        name: varchar("name", { length: 300 }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => [index("brand_media_company_idx").on(table.companyId)]
);
export type BrandMediaRow = InferSelectModel<typeof brandMedia>;

/** Network-specific references a reply needs (Bluesky: the CIDs of the thread). */
export interface BrandCommentRefs {
    cid?: string;
    rootUri?: string;
    rootCid?: string;
}

/**
 * Comments read back from the networks on posts Brand published, plus the
 * replies sent from Engagement. `handledAt` is the inbox's only state: a
 * comment is open until someone marks it done (or replies).
 */
export const brandComments = pgTable(
    "brand_comments",
    {
        id: varchar("id", { length: 64 }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        channelId: varchar("channel_id", { length: 64 })
            .notNull()
            .references(() => brandChannels.id, { onDelete: "cascade" }),
        postId: varchar("post_id", { length: 64 })
            .notNull()
            .references(() => brandPosts.id, { onDelete: "cascade" }),
        platform: varchar("platform", { length: 20 }).notNull(),
        /** The network's id: a LinkedIn comment URN, a Bluesky at:// URI. */
        externalId: varchar("external_id", { length: 512 }).notNull(),
        /** The comment this one answers; null when it is on the post itself. */
        parentExternalId: varchar("parent_external_id", { length: 512 }),
        refs: jsonb("refs").$type<BrandCommentRefs>(),
        authorExternalId: varchar("author_external_id", { length: 256 }),
        authorName: varchar("author_name", { length: 256 }),
        authorHandle: varchar("author_handle", { length: 256 }),
        body: text("body").notNull(),
        /** Written by the channel itself. */
        isOwn: boolean("is_own").notNull().default(false),
        /** When the network says it was written. */
        commentedAt: timestamp("commented_at", { withTimezone: true }).notNull(),
        handledAt: timestamp("handled_at", { withTimezone: true }),
        handledByUserId: varchar("handled_by_user_id", { length: 256 }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => [
        uniqueIndex("brand_comments_channel_external_unique").on(table.channelId, table.externalId),
        index("brand_comments_company_open_idx").on(table.companyId, table.handledAt),
        index("brand_comments_post_idx").on(table.postId),
    ]
);
export type BrandCommentRow = InferSelectModel<typeof brandComments>;
