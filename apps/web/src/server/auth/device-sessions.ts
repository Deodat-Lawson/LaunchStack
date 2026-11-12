/**
 * Several accounts in one browser: Better Auth's multi-session plugin plus
 * one endpoint of ours that it lacks.
 *
 * How multi-session works (better-auth 1.7, plugins/multi-session): every
 * new session also gets a signed `<session cookie>_multi-<token>` cookie.
 * The plain session cookie stays the *active* account — it is what
 * getServerSession, the middleware and every route read — and
 * `/multi-session/set-active` swaps it for another remembered one.
 * `/multi-session/revoke` ends one account and makes the next remembered one
 * active; a plain `/sign-out` ends every account in the browser.
 *
 * The gap: a session that existed before the plugin was turned on has no
 * `_multi-` cookie. Adding a second account would then replace the session
 * cookie and leave the first account remembered nowhere, which is a
 * sign-out the person never asked for. `/device-sessions/remember` writes the
 * missing cookie for the session in hand; the account menu and the
 * add-account pages call it before anything else can replace the session.
 */

import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { multiSession } from "better-auth/plugins";

import { MAX_DEVICE_ACCOUNTS } from "~/lib/auth/device-accounts";

const MULTI_MARKER = "_multi-";

function cookieNames(header: string | null | undefined): string[] {
    if (!header) return [];
    return header
        .split(";")
        .map(part => part.split("=")[0]?.trim() ?? "")
        .filter(Boolean);
}

export function rememberDeviceSession(maximumSessions: number) {
    return {
        id: "launchstack-device-sessions",
        endpoints: {
            rememberDeviceSession: createAuthEndpoint(
                "/device-sessions/remember",
                { method: "POST", requireHeaders: true, use: [sessionMiddleware] },
                async ctx => {
                    const { token } = ctx.context.session.session;
                    const config = ctx.context.authCookies.sessionToken;
                    // The same name the multi-session plugin gives it, so its
                    // list, set-active and revoke endpoints find this cookie.
                    const name = `${config.name}${MULTI_MARKER}${token.toLowerCase()}`;
                    if (await ctx.getSignedCookie(name, ctx.context.secret)) {
                        return ctx.json({ remembered: true });
                    }
                    const held = cookieNames(ctx.headers?.get("cookie")).filter(n =>
                        n.includes(MULTI_MARKER)
                    ).length;
                    if (held >= maximumSessions) return ctx.json({ remembered: false });
                    await ctx.setSignedCookie(name, token, ctx.context.secret, config.attributes);
                    return ctx.json({ remembered: true });
                }
            ),
        },
    } satisfies BetterAuthPlugin;
}

/** The plugins that let one browser hold several accounts. */
export function deviceSessionPlugins() {
    return [
        multiSession({ maximumSessions: MAX_DEVICE_ACCOUNTS }),
        rememberDeviceSession(MAX_DEVICE_ACCOUNTS),
    ];
}
