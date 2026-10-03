import { sql, type InferSelectModel } from "drizzle-orm";
import {
    bigint,
    bigserial,
    index,
    integer,
    jsonb,
    text,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/pg-core";
import { pgTable } from "@launchstack/store/schema/helpers";

export const marketingContentHistory = pgTable(
    "marketing_content_history",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" }).notNull(),
        platform: varchar("platform", { length: 20 }).notNull(),
        message: text("message").notNull(),
        angle: varchar("angle", { length: 500 }),
        contentType: varchar("content_type", { length: 50 }).default("post"),
        metadata: jsonb("metadata"),
        impressions: integer("impressions"),
        engagements: integer("engagements"),
        clicks: integer("clicks"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull(),
        // Publish write-back (unification PR-6): the platform-native post id
        // and URL recorded when a row's content is actually published — the
        // key a future engagement read-back loop needs. NULL until published.
        //
        // Declared LAST to match the physical column order: the migration
        // (20260822235519) ADDs these to an existing table, so the database
        // appends them — and the migrations-vs-TypeScript parity gate diffs
        // pg_dump output, where order is part of the contract.
        postId: varchar("post_id", { length: 200 }),
        postUrl: varchar("post_url", { length: 500 }),
        publishedAt: timestamp("published_at"),
    },
    table => [
        index("mch_company_id_idx").on(table.companyId),
        index("mch_platform_idx").on(table.platform),
    ]
);

// ─── Brand posts ─────────────────────────────────────────────────────────────

/**
 * A post's life: composed as a draft or straight to scheduled; the scheduler
 * claims it (publishing) with one conditional update so two schedulers never
 * post twice; then published or failed. Cancelled keeps the row for the
 * calendar's record.
 */
export const BRAND_POST_STATUSES = [
    "draft",
    "scheduled",
    "publishing",
    "published",
    "failed",
    "cancelled",
] as const;
export type BrandPostStatus = (typeof BRAND_POST_STATUSES)[number];

/** Where a post came from, for the calendar and the generator's memory. */
export interface BrandPostSource {
    kind: "compose" | "campaign";
    /** The marketing_content_history row a campaign post was drafted from. */
    historyId?: number;
}

/**
 * One row per network per composed message: a message sent to three networks
 * is three rows that succeed, fail and appear on the calendar independently.
 */
export const brandPosts = pgTable(
    "brand_posts",
    {
        id: varchar("id", { length: 64 }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" }).notNull(),
        createdByUserId: varchar("created_by_user_id", { length: 256 }).notNull(),
        platform: varchar("platform", { length: 20 }).notNull(),
        body: text("body").notNull(),
        /** Reddit self-post title; other networks ignore it. */
        title: varchar("title", { length: 300 }),
        status: varchar("status", { length: 20, enum: BRAND_POST_STATUSES })
            .notNull()
            .default("draft"),
        scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
        publishedAt: timestamp("published_at", { withTimezone: true }),
        postId: varchar("post_id", { length: 200 }),
        postUrl: varchar("post_url", { length: 500 }),
        /** The last failure, kept so the calendar can say why. */
        error: text("error"),
        source: jsonb("source").$type<BrandPostSource>(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
        // Declared last: added by a later migration (ADD COLUMN appends, and
        // the pg_dump parity gate compares physical column order).
        /** Publish attempts so far, including the one that succeeded. */
        attempts: integer("attempts").notNull().default(0),
        /**
         * When the scheduler may try again after a transient failure. Null
         * means "at scheduledAt". The calendar keeps showing scheduledAt.
         */
        nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
        lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    },
    table => [
        index("brand_posts_company_status_idx").on(table.companyId, table.status),
        index("brand_posts_company_scheduled_idx").on(table.companyId, table.scheduledAt),
        index("brand_posts_due_idx").on(table.status, table.scheduledAt),
        index("brand_posts_next_attempt_idx").on(table.status, table.nextAttemptAt),
    ]
);
export type BrandPostRow = InferSelectModel<typeof brandPosts>;

// ─── Brand accounts ──────────────────────────────────────────────────────────

/**
 * A workspace's own credential for one network. The credential is a JSON
 * document sealed with the store's secret box (AES-256-GCM, key-versioned);
 * `identity` is display-only. One row per network per workspace: connecting
 * again replaces it. `revoked` means the network refused the credential and
 * reconnecting is the only fix.
 */
export const brandAccounts = pgTable(
    "brand_accounts",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" }).notNull(),
        platform: varchar("platform", { length: 20 }).notNull(),
        /** The handle or name the network reported when the credential was verified. */
        identity: varchar("identity", { length: 256 }),
        credentialsCiphertext: text("credentials_ciphertext").notNull(),
        encryptionKeyVersion: integer("encryption_key_version").notNull().default(1),
        /** active | revoked */
        status: varchar("status", { length: 16 }).notNull().default("active"),
        lastError: text("last_error"),
        connectedByUserId: varchar("connected_by_user_id", { length: 256 }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => [
        uniqueIndex("brand_accounts_company_platform_unique").on(table.companyId, table.platform),
        index("brand_accounts_company_idx").on(table.companyId),
    ]
);
export type BrandAccountRow = InferSelectModel<typeof brandAccounts>;
