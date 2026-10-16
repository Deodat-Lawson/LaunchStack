/**
 * Better Auth tables — the auth provider's own storage.
 *
 * Column set mirrors better-auth 1.7.10's schema for the core plus the jwt,
 * mcp (OAuth provider) and cimd plugins (verified against `getAuthTables()`
 * and the drizzle adapter's own schema generator at that version); the
 * adapter reads and writes these by the Drizzle property names, so property
 * names must stay the library's (`emailVerified`, `ipAddress`, …) even though
 * the SQL names are snake_case.
 *
 * `auth_user.id` is the opaque subject ID the product schema stores in
 * `users.userId` (identity.ts). Imported Clerk accounts keep their original
 * `user_…` strings here; new signups get better-auth generated IDs. Password
 * hashes live on `auth_account` rows with providerId "credential" — imported
 * Clerk hashes are bcrypt, new ones scrypt; the verifier in ~/server/auth
 * branches on the hash prefix.
 *
 * The OAuth tables (`auth_oauth_*`, `auth_jwks`) back LaunchStack's MCP
 * server: assistants such as Claude, ChatGPT and Gemini register as OAuth
 * clients and get tokens for one workspace (see ~/server/mcp).
 */
import { boolean, index, integer, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

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
        // better-auth 1.7.0–1.7.2 keyed accounts by (issuer, accountId); 1.7.3
        // went back to (providerId, accountId) and stopped writing this
        // column. Nullable since then, per better-auth's 1.7 upgrade guide;
        // older rows keep their value. Safe to drop in a later cleanup.
        issuer: text("issuer"),
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
        // Kept from the 1.7.2 schema; nothing resolves by it any more.
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

// ---------------------------------------------------------------------------
// JWT signing keys (jwt plugin). Access tokens for the MCP server are JWTs
// signed with these; resource checks verify them against /api/auth/jwks.
// ---------------------------------------------------------------------------

export const authJwks = pgTable("auth_jwks", {
    id: text("id").primaryKey(),
    publicKey: text("public_key").notNull(),
    privateKey: text("private_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    alg: text("alg"),
    crv: text("crv"),
});

// ---------------------------------------------------------------------------
// OAuth provider (mcp plugin). `referenceId` on consents and tokens is the
// workspace (company id, as a string) the person picked when connecting.
// ---------------------------------------------------------------------------

export const authOauthClient = pgTable(
    "auth_oauth_client",
    {
        id: text("id").primaryKey(),
        // Inline constraint, not a table index: other tables' foreign keys
        // reference it, and drizzle-kit emits indexes after foreign keys.
        clientId: text("client_id").notNull().unique("auth_oauth_client_client_id_unique"),
        clientSecret: text("client_secret"),
        clientDiscoveryId: text("client_discovery_id"),
        disabled: boolean("disabled").default(false),
        skipConsent: boolean("skip_consent"),
        enableEndSession: boolean("enable_end_session"),
        subjectType: text("subject_type"),
        scopes: text("scopes").array(),
        clientCredentialsScopes: text("client_credentials_scopes").array().default([]),
        userId: text("user_id").references(() => authUser.id, { onDelete: "cascade" }),
        createdAt: timestamp("created_at", { withTimezone: true }),
        updatedAt: timestamp("updated_at", { withTimezone: true }),
        name: text("name"),
        uri: text("uri"),
        icon: text("icon"),
        contacts: text("contacts").array(),
        tos: text("tos"),
        policy: text("policy"),
        softwareId: text("software_id"),
        softwareVersion: text("software_version"),
        softwareStatement: text("software_statement"),
        redirectUris: text("redirect_uris").array().notNull(),
        postLogoutRedirectUris: text("post_logout_redirect_uris").array(),
        backchannelLogoutUri: text("backchannel_logout_uri"),
        backchannelLogoutSessionRequired: boolean("backchannel_logout_session_required"),
        tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
        applicationType: text("application_type"),
        jwks: text("jwks"),
        jwksUri: text("jwks_uri"),
        grantTypes: text("grant_types").array(),
        responseTypes: text("response_types").array(),
        requirePKCE: boolean("require_pkce"),
        dpopBoundAccessTokens: boolean("dpop_bound_access_tokens").default(false),
        referenceId: text("reference_id"),
        metadata: jsonb("metadata"),
    },
    table => ({
        userIdIdx: index("auth_oauth_client_user_id_idx").on(table.userId),
    })
);

export const authOauthResource = pgTable("auth_oauth_resource", {
    id: text("id").primaryKey(),
    // Inline for the same reason as auth_oauth_client.client_id.
    identifier: text("identifier").notNull().unique("auth_oauth_resource_identifier_unique"),
    name: text("name").notNull(),
    accessTokenTtl: integer("access_token_ttl"),
    refreshTokenTtl: integer("refresh_token_ttl"),
    signingAlgorithm: text("signing_algorithm"),
    signingKeyId: text("signing_key_id"),
    allowedScopes: text("allowed_scopes").array(),
    customClaims: jsonb("custom_claims"),
    dpopBoundAccessTokensRequired: boolean("dpop_bound_access_tokens_required").default(false),
    disabled: boolean("disabled").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    policyVersion: integer("policy_version").default(1),
    metadata: jsonb("metadata"),
});

export const authOauthClientResource = pgTable(
    "auth_oauth_client_resource",
    {
        id: text("id").primaryKey(),
        clientId: text("client_id")
            .notNull()
            .references(() => authOauthClient.clientId, { onDelete: "cascade" }),
        resourceId: text("resource_id")
            .notNull()
            .references(() => authOauthResource.identifier, { onDelete: "cascade" }),
        metadata: jsonb("metadata"),
        createdAt: timestamp("created_at", { withTimezone: true }),
    },
    table => ({
        clientResourceUnique: uniqueIndex("auth_oauth_client_resource_client_resource_unique").on(
            table.clientId,
            table.resourceId
        ),
        clientIdIdx: index("auth_oauth_client_resource_client_id_idx").on(table.clientId),
        resourceIdIdx: index("auth_oauth_client_resource_resource_id_idx").on(table.resourceId),
    })
);

export const authOauthRefreshToken = pgTable(
    "auth_oauth_refresh_token",
    {
        id: text("id").primaryKey(),
        token: text("token").notNull(),
        clientId: text("client_id")
            .notNull()
            .references(() => authOauthClient.clientId, { onDelete: "cascade" }),
        sessionId: text("session_id").references(() => authSession.id, { onDelete: "set null" }),
        userId: text("user_id")
            .notNull()
            .references(() => authUser.id, { onDelete: "cascade" }),
        referenceId: text("reference_id"),
        authorizationCodeId: text("authorization_code_id"),
        resources: text("resources").array(),
        requestedUserInfoClaims: text("requested_user_info_claims").array(),
        expiresAt: timestamp("expires_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }),
        revoked: timestamp("revoked", { withTimezone: true }),
        rotatedAt: timestamp("rotated_at", { withTimezone: true }),
        rotationReplayResponse: text("rotation_replay_response"),
        rotationReplayExpiresAt: timestamp("rotation_replay_expires_at", { withTimezone: true }),
        authTime: timestamp("auth_time", { withTimezone: true }),
        confirmation: jsonb("confirmation"),
        scopes: text("scopes").array().notNull(),
    },
    table => ({
        tokenUnique: uniqueIndex("auth_oauth_refresh_token_token_unique").on(table.token),
        clientIdIdx: index("auth_oauth_refresh_token_client_id_idx").on(table.clientId),
        sessionIdIdx: index("auth_oauth_refresh_token_session_id_idx").on(table.sessionId),
        userIdIdx: index("auth_oauth_refresh_token_user_id_idx").on(table.userId),
        authorizationCodeIdIdx: index("auth_oauth_refresh_token_authorization_code_id_idx").on(
            table.authorizationCodeId
        ),
    })
);

export const authOauthAccessToken = pgTable(
    "auth_oauth_access_token",
    {
        id: text("id").primaryKey(),
        token: text("token"),
        clientId: text("client_id")
            .notNull()
            .references(() => authOauthClient.clientId, { onDelete: "cascade" }),
        sessionId: text("session_id").references(() => authSession.id, { onDelete: "set null" }),
        userId: text("user_id").references(() => authUser.id, { onDelete: "cascade" }),
        referenceId: text("reference_id"),
        authorizationCodeId: text("authorization_code_id"),
        resources: text("resources").array(),
        requestedUserInfoClaims: text("requested_user_info_claims").array(),
        refreshId: text("refresh_id").references(() => authOauthRefreshToken.id, {
            onDelete: "cascade",
        }),
        expiresAt: timestamp("expires_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }),
        revoked: timestamp("revoked", { withTimezone: true }),
        confirmation: jsonb("confirmation"),
        scopes: text("scopes").array().notNull(),
    },
    table => ({
        tokenUnique: uniqueIndex("auth_oauth_access_token_token_unique").on(table.token),
        clientIdIdx: index("auth_oauth_access_token_client_id_idx").on(table.clientId),
        sessionIdIdx: index("auth_oauth_access_token_session_id_idx").on(table.sessionId),
        userIdIdx: index("auth_oauth_access_token_user_id_idx").on(table.userId),
        authorizationCodeIdIdx: index("auth_oauth_access_token_authorization_code_id_idx").on(
            table.authorizationCodeId
        ),
        refreshIdIdx: index("auth_oauth_access_token_refresh_id_idx").on(table.refreshId),
    })
);

export const authOauthConsent = pgTable(
    "auth_oauth_consent",
    {
        id: text("id").primaryKey(),
        clientId: text("client_id")
            .notNull()
            .references(() => authOauthClient.clientId, { onDelete: "cascade" }),
        userId: text("user_id").references(() => authUser.id, { onDelete: "cascade" }),
        referenceId: text("reference_id"),
        resources: text("resources").array(),
        requestedUserInfoClaims: text("requested_user_info_claims").array(),
        scopes: text("scopes").array().notNull(),
        createdAt: timestamp("created_at", { withTimezone: true }),
        updatedAt: timestamp("updated_at", { withTimezone: true }),
    },
    table => ({
        clientIdIdx: index("auth_oauth_consent_client_id_idx").on(table.clientId),
        userIdIdx: index("auth_oauth_consent_user_id_idx").on(table.userId),
    })
);

export const authOauthClientAssertion = pgTable("auth_oauth_client_assertion", {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
