import { relations, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
    date,
    index,
    integer,
    jsonb,
    serial,
    timestamp,
    varchar,
    bigint,
    uniqueIndex,
} from "drizzle-orm/pg-core";

import { pgTable } from "./helpers";
import { company } from "./base";

// ============================================================================
// Token Accounts — one per company
// ============================================================================

export const tokenAccounts = pgTable(
    "token_accounts",
    {
        id: serial("id").primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        balanceTokens: integer("balance_tokens").default(0).notNull(),
        lifetimeTokensPurchased: integer("lifetime_tokens_purchased").default(0).notNull(),
        lifetimeTokensGranted: integer("lifetime_tokens_granted").default(0).notNull(),
        lifetimeTokensUsed: integer("lifetime_tokens_used").default(0).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
            () => new Date()
        ),
    },
    (table) => ({
        companyIdIdx: uniqueIndex("token_accounts_company_id_idx").on(table.companyId),
    })
);

// ============================================================================
// Token Transactions — append-only ledger
// ============================================================================

export const tokenTransactions = pgTable(
    "token_transactions",
    {
        id: serial("id").primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        type: varchar("type", { length: 20 }).notNull(), // grant | purchase | debit | refund | adjustment
        amount: integer("amount").notNull(), // positive for tokens in, negative for debits
        balanceAfter: integer("balance_after").notNull(),
        description: varchar("description", { length: 500 }),
        service: varchar("service", { length: 50 }), // embedding | rerank | ner | transcription | ocr | llm_chat
        referenceId: varchar("reference_id", { length: 256 }),
        metadata: jsonb("metadata"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    (table) => ({
        companyCreatedIdx: index("token_tx_company_created_idx").on(
            table.companyId,
            table.createdAt
        ),
        companyServiceIdx: index("token_tx_company_service_idx").on(
            table.companyId,
            table.service,
            table.createdAt
        ),
    })
);

// ============================================================================
// Token Usage Daily — aggregated for dashboards
// ============================================================================

export const tokenUsageDaily = pgTable(
    "token_usage_daily",
    {
        id: serial("id").primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        date: date("date").notNull(),
        service: varchar("service", { length: 50 }).notNull(),
        operationCount: integer("operation_count").default(0).notNull(),
        tokensUsed: integer("tokens_used").default(0).notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
            () => new Date()
        ),
    },
    (table) => ({
        companyDateServiceIdx: uniqueIndex("token_usage_daily_company_date_service_idx").on(
            table.companyId,
            table.date,
            table.service
        ),
    })
);

// ============================================================================
// Token Grants — signup bonuses, promos, manual grants
// ============================================================================

export const tokenGrants = pgTable(
    "token_grants",
    {
        id: serial("id").primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        grantType: varchar("grant_type", { length: 30 }).notNull(),
        amount: integer("amount").notNull(),
        expiresAt: timestamp("expires_at", { withTimezone: true }),
        grantedBy: varchar("granted_by", { length: 256 }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    (table) => ({
        companyIdIdx: index("token_grants_company_id_idx").on(table.companyId),
    })
);

// ============================================================================
// Relations
// ============================================================================

export const tokenAccountsRelations = relations(tokenAccounts, ({ one }) => ({
    company: one(company, {
        fields: [tokenAccounts.companyId],
        references: [company.id],
    }),
}));

export const tokenTransactionsRelations = relations(tokenTransactions, ({ one }) => ({
    company: one(company, {
        fields: [tokenTransactions.companyId],
        references: [company.id],
    }),
}));

export const tokenUsageDailyRelations = relations(tokenUsageDaily, ({ one }) => ({
    company: one(company, {
        fields: [tokenUsageDaily.companyId],
        references: [company.id],
    }),
}));

export const tokenGrantsRelations = relations(tokenGrants, ({ one }) => ({
    company: one(company, {
        fields: [tokenGrants.companyId],
        references: [company.id],
    }),
}));

// ============================================================================
// Types
// ============================================================================

export type TokenAccount = InferSelectModel<typeof tokenAccounts>;
export type TokenTransaction = InferSelectModel<typeof tokenTransactions>;
export type TokenUsageDaily = InferSelectModel<typeof tokenUsageDaily>;
export type TokenGrant = InferSelectModel<typeof tokenGrants>;
