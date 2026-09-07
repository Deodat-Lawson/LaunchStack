/**
 * Better Auth core tables — the auth provider's own storage.
 *
 * Column set mirrors better-auth 1.7's core schema exactly (verified against
 * `getAuthTables()` at that version); the adapter reads and writes these by
 * the Drizzle property names, so property names must stay the library's
 * (`emailVerified`, `ipAddress`, …) even though the SQL names are snake_case.
 *
 * `auth_user.id` is the opaque subject ID the product schema stores in
 * `users.userId` (identity.ts). Imported Clerk accounts keep their original
 * `user_…` strings here; new signups get better-auth generated IDs. Password
 * hashes live on `auth_account` rows with providerId "credential" and issuer
 * "local:credential" — imported Clerk hashes are bcrypt, new ones scrypt; the
 * verifier in ~/server/auth branches on the hash prefix.
 */
import { boolean, index, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { pgTable } from "@launchstack/store/schema/helpers";

export const authUser = pgTable(
    "auth_user",
    {
        id: text("id").primaryKey(),
        name: text("name").notNull(),
        email: text("email").notNull(),
        emailVerified: boolean("email_verified").notNull().default(false),
        image: text("image"),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    },
    table => ({
        emailUnique: uniqueIndex("auth_user_email_unique").on(table.email),
    })
);

export const authSession = pgTable(
    "auth_session",
    {
        id: text("id").primaryKey(),
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
        token: text("token").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
        ipAddress: text("ip_address"),
        userAgent: text("user_agent"),
        userId: text("user_id")
            .notNull()
            .references(() => authUser.id, { onDelete: "cascade" }),
    },
    table => ({
        tokenUnique: uniqueIndex("auth_session_token_unique").on(table.token),
        userIdIdx: index("auth_session_user_id_idx").on(table.userId),
    })
);

export const authAccount = pgTable(
    "auth_account",
    {
        id: text("id").primaryKey(),
        issuer: text("issuer").notNull(),
        accountId: text("account_id").notNull(),
        providerId: text("provider_id").notNull(),
        userId: text("user_id")
            .notNull()
            .references(() => authUser.id, { onDelete: "cascade" }),
        accessToken: text("access_token"),
        refreshToken: text("refresh_token"),
        idToken: text("id_token"),
        accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
        refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
        scope: text("scope"),
        password: text("password"),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    },
    table => ({
        userIdIdx: index("auth_account_user_id_idx").on(table.userId),
        // better-auth resolves accounts by (issuer, accountId).
        issuerAccountIdx: index("auth_account_issuer_account_idx").on(
            table.issuer,
            table.accountId
        ),
    })
);

export const authVerification = pgTable(
    "auth_verification",
    {
        id: text("id").primaryKey(),
        identifier: text("identifier").notNull(),
        value: text("value").notNull(),
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    },
    table => ({
        identifierIdx: index("auth_verification_identifier_idx").on(table.identifier),
    })
);
