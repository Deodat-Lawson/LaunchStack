import { boolean, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { pgTable } from "./helpers";

// ============================================================================
// Better Auth Tables
// ============================================================================

export const authUser = pgTable("auth_user", {
    id: varchar("id", { length: 36 }).primaryKey(),
    name: text("name").notNull(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const authSession = pgTable("auth_session", {
    id: varchar("id", { length: 36 }).primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: varchar("token", { length: 255 }).notNull().unique(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: varchar("user_id", { length: 36 })
        .notNull()
        .references(() => authUser.id, { onDelete: "cascade" }),
});

export const authAccount = pgTable("auth_account", {
    id: varchar("id", { length: 36 }).primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: varchar("user_id", { length: 36 })
        .notNull()
        .references(() => authUser.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const authVerification = pgTable("auth_verification", {
    id: varchar("id", { length: 36 }).primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
});
