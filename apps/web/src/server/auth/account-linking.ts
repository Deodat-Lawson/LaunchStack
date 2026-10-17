/**
 * What a Google or GitHub sign-in may do to an account that already exists
 * for its email address.
 *
 * LaunchStack never confirms the address on a password sign-up (no email
 * provider is wired, see ./email), so a password account may have been made
 * by someone who does not own the address. Better Auth's default answer is to
 * refuse the provider sign-in for such an account (`requireLocalEmailVerified`),
 * which strands the real owner behind a password they may never have set.
 * Turning that off alone would be worse: whoever registered the address first
 * would keep their password on the merged account ("pre-hijacking").
 *
 * So the rule is the one Firebase uses. A provider that confirms the address
 * proves who owns it, and nothing attached to the account before that was
 * ever proven. When a provider signs in to an account whose address was never
 * confirmed, it takes the account over:
 *
 * - every other sign-in method goes (the password, and any provider linked
 *   while the address was unconfirmed),
 * - every session ends,
 * - every assistant connection and access key made for the account is revoked,
 * - Better Auth then marks the address confirmed and signs the person in.
 *
 * A one-time cookie (`TAKEOVER_NOTICE_COOKIE`) tells the app to explain what
 * happened; see ~/components/auth/SignInNotice.
 *
 * Linking on purpose from Settings › Account is different: the person is
 * signed in, so they hold the account and the provider. Nothing is removed,
 * and the address is marked confirmed, because the provider just proved it.
 *
 * Better Auth only reaches either path when the provider reports the address
 * as confirmed, and a deliberate link only when that address is the account's
 * own. Both hold because no `trustedProviders` are configured and
 * `allowDifferentEmails` is off; this module relies on that.
 */
import type { BetterAuthOptions } from "better-auth";
import { getOAuthState } from "better-auth/api";
import { and, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { formatTakeoverNotice, TAKEOVER_NOTICE_COOKIE } from "~/lib/auth/takeover-notice";

// The schema barrel, as the middleware itself imports it (see oauth-workspace).
import {
    authOauthAccessToken,
    authOauthConsent,
    authOauthRefreshToken,
    mcpAccessKeys,
    users,
} from "~/server/db/schema";

// Any schema: callers pass the auth module's client, typed for auth tables only.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = PostgresJsDatabase<any>;

type DatabaseHooks = NonNullable<BetterAuthOptions["databaseHooks"]>;
type HookContext = Parameters<
    NonNullable<NonNullable<NonNullable<DatabaseHooks["account"]>["create"]>["before"]>
>[1];

/** Where a provider sign-in attaches itself to an existing account by email. */
const SIGN_IN_PATHS = new Set(["/callback/:id", "/sign-in/social"]);

/** Better Auth's id for the email-and-password sign-in method. */
const PASSWORD = "credential";

async function linkInState(): Promise<boolean> {
    // `link` is written by the server's own link-social endpoint, after any
    // client-supplied fields, so a sign-in cannot pass itself off as one.
    return Boolean((await getOAuthState())?.link);
}

/** A provider signing someone in (not linking from Settings) on an existing account. */
async function isSignIn(ctx: HookContext): Promise<boolean> {
    return Boolean(ctx?.path && SIGN_IN_PATHS.has(ctx.path)) && !(await linkInState());
}

/** Linking from Settings: the redirect flow that started at /link-social. */
async function isDeliberateLink(ctx: HookContext): Promise<boolean> {
    return ctx?.path === "/callback/:id" && (await linkInState());
}

/**
 * Ends every way into the account that existed before the takeover. Returns
 * the sign-in methods it removed.
 */
async function takeOver(
    ctx: NonNullable<HookContext>,
    db: Db,
    authUserId: string
): Promise<string[]> {
    const adapter = ctx.context.internalAdapter;
    const accounts = await adapter.findAccounts(authUserId);
    for (const account of accounts) await adapter.deleteAccount(account.id);
    await adapter.deleteUserSessions(authUserId);
    await revokeAssistantAccess(db, authUserId);
    return accounts.map(account => account.providerId);
}

/**
 * Assistant connections (OAuth consents and their tokens) and access keys.
 * /api/mcp checks consent on every call, so deleting it stops a token that
 * is still unexpired; keys are stamped revoked, as Settings does.
 */
export async function revokeAssistantAccess(db: Db, authUserId: string): Promise<void> {
    await db.transaction(async tx => {
        await tx.delete(authOauthConsent).where(eq(authOauthConsent.userId, authUserId));
        // Access tokens first: they reference the refresh token they came from.
        await tx.delete(authOauthAccessToken).where(eq(authOauthAccessToken.userId, authUserId));
        await tx.delete(authOauthRefreshToken).where(eq(authOauthRefreshToken.userId, authUserId));
        const [person] = await tx
            .select({ id: users.id })
            .from(users)
            .where(eq(users.userId, authUserId))
            .limit(1);
        if (person) {
            await tx
                .update(mcpAccessKeys)
                .set({ revokedAt: new Date() })
                .where(
                    and(
                        eq(mcpAccessKeys.userId, BigInt(person.id)),
                        isNull(mcpAccessKeys.revokedAt)
                    )
                );
        }
    });
}

export function accountLinkingHooks(db: Db): DatabaseHooks {
    return {
        account: {
            create: {
                before: async (account, ctx) => {
                    if (!ctx || account.providerId === PASSWORD) return;
                    if (!(await isSignIn(ctx))) return;
                    const user = await ctx.context.internalAdapter.findUserById(account.userId);
                    // A confirmed account links as it always has; only an
                    // unconfirmed one is taken over.
                    if (!user || user.emailVerified) return;
                    const removed = await takeOver(ctx, db, account.userId);
                    if (removed.length === 0) return;
                    const notice = formatTakeoverNotice(account.providerId, removed);
                    ctx.setCookie(TAKEOVER_NOTICE_COOKIE, notice, {
                        path: "/",
                        maxAge: 10 * 60,
                        sameSite: "lax",
                        secure: ctx.context.baseURL.startsWith("https://"),
                        httpOnly: false,
                    });
                },
                after: async (account, ctx) => {
                    if (!ctx || account.providerId === PASSWORD) return;
                    if (!(await isDeliberateLink(ctx))) return;
                    const user = await ctx.context.internalAdapter.findUserById(account.userId);
                    if (user && !user.emailVerified) {
                        await ctx.context.internalAdapter.updateUser(user.id, {
                            emailVerified: true,
                        });
                    }
                },
            },
        },
    };
}
