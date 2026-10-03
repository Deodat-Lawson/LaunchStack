/**
 * Binds every assistant OAuth grant to one workspace.
 *
 * better-auth's OAuth provider has a "post login" step built for exactly this
 * (pick an organisation after sign-in). LaunchStack uses it so the token an
 * assistant gets acts as one person in one workspace:
 *
 *   authorize → signed in? → postLogin.shouldRedirect
 *     one active workspace  → no picker; that workspace is the reference
 *     several               → /oauth/workspace, then /oauth2/continue
 *   → consent (stored per workspace: consentReferenceId)
 *   → token, carrying the workspace in a claim (accessTokenClaims)
 *
 * The pick is held in `mcp_oauth_workspace_choices`, keyed by the browser
 * session AND the authorization request it belongs to (`flowKeyOf`), between
 * the picker and better-auth asking for the reference. Per request because
 * one browser can run two connections at once: a pick made for one must
 * never bind the other's token. better-auth exposes the request it is
 * resuming (`getOAuthProviderState`) on the continue and consent calls, which
 * is where the reference is read. Not on the session row: the session cookie
 * cache would serve a stale copy.
 *
 * Membership is checked at every step, and again whenever a token is
 * refreshed (accessTokenClaims throws for a removed member, so the refresh
 * fails and the assistant has to connect again).
 *
 * Takes the auth module's own Drizzle client: this runs inside the auth
 * instance, which is in the middleware bundle and must not pull in the engine.
 */
import { createHash } from "node:crypto";

import { getOAuthProviderState } from "@better-auth/oauth-provider";
import { APIError } from "better-auth/api";
import { and, eq, gt } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

// The schema barrel, as the middleware itself imports it: this module loads
// with the auth instance, and route tests that mock the barrel stay intact.
import { mcpOauthWorkspaceChoices, userCompanyMemberships, users } from "~/server/db/schema";
import { MCP_WORKSPACE_CLAIM } from "./config";

// Any schema: callers pass the auth module's client, typed for auth tables only.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = PostgresJsDatabase<any>;

/** A pick older than this no longer counts; the flow asks again. */
export const WORKSPACE_CHOICE_TTL_MS = 15 * 60 * 1000;

export async function activeWorkspaceIds(db: Db, authUserId: string): Promise<string[]> {
    const rows = await db
        .select({ companyId: userCompanyMemberships.companyId })
        .from(userCompanyMemberships)
        .innerJoin(users, eq(users.id, userCompanyMemberships.userId))
        .where(and(eq(users.userId, authUserId), eq(userCompanyMemberships.status, "active")));
    return rows.map(r => String(r.companyId));
}

/**
 * Identifies one authorization request: the parameters that stay the same on
 * every screen of the flow (the signed query is re-issued between screens,
 * but these are copied through). Null when there is no client to key on.
 */
export function flowKeyOf(query: string | URLSearchParams): string | null {
    const params = typeof query === "string" ? new URLSearchParams(query) : query;
    const clientId = params.get("client_id");
    if (!clientId) return null;
    const parts = ["client_id", "state", "code_challenge", "redirect_uri", "nonce"].map(
        name => `${name}=${params.get(name) ?? ""}`
    );
    return createHash("sha256").update(parts.join("&")).digest("hex");
}

/** The flow key of the authorization request better-auth is resuming, if any. */
async function currentFlowKey(): Promise<string | null> {
    const state = await getOAuthProviderState().catch(() => null);
    return state?.query ? flowKeyOf(state.query) : null;
}

async function freshChoice(db: Db, sessionId: string, flowKey: string): Promise<string | null> {
    const [row] = await db
        .select({ companyId: mcpOauthWorkspaceChoices.companyId })
        .from(mcpOauthWorkspaceChoices)
        .where(
            and(
                eq(mcpOauthWorkspaceChoices.sessionId, sessionId),
                eq(mcpOauthWorkspaceChoices.flowKey, flowKey),
                gt(
                    mcpOauthWorkspaceChoices.chosenAt,
                    new Date(Date.now() - WORKSPACE_CHOICE_TTL_MS)
                )
            )
        );
    return row ? String(row.companyId) : null;
}

/**
 * The workspace this grant is for, or null when the person still has to pick
 * (or has nothing to pick from).
 */
export async function resolveGrantWorkspace(
    db: Db,
    authUserId: string,
    sessionId: string,
    flowKey: string | null
): Promise<string | null> {
    const workspaces = await activeWorkspaceIds(db, authUserId);
    if (workspaces.length === 1) return workspaces[0]!;
    if (!flowKey) return null;
    const chosen = await freshChoice(db, sessionId, flowKey);
    return chosen && workspaces.includes(chosen) ? chosen : null;
}

/** Records the picker's choice for one authorization request. Callers have checked membership. */
export async function recordWorkspaceChoice(
    db: Db,
    sessionId: string,
    flowKey: string,
    companyId: bigint
): Promise<void> {
    await db
        .insert(mcpOauthWorkspaceChoices)
        .values({ sessionId, flowKey, companyId, chosenAt: new Date() })
        .onConflictDoUpdate({
            target: [mcpOauthWorkspaceChoices.sessionId, mcpOauthWorkspaceChoices.flowKey],
            set: { companyId, chosenAt: new Date() },
        });
}

interface HookUser {
    id: string;
}
interface HookSession {
    id: string;
}

/** better-auth `postLogin` options for the mcp() plugin. */
export function workspacePostLogin(db: Db, page: string) {
    return {
        page,
        shouldRedirect: async ({
            user,
            session,
            isContinuation,
        }: {
            user: HookUser;
            session: HookSession;
            isContinuation: boolean;
        }): Promise<boolean> => {
            const workspaces = await activeWorkspaceIds(db, user.id);
            if (workspaces.length === 1) return false;
            // A fresh authorize always shows the picker, even with a pick
            // still on file from an earlier flow in this browser.
            if (!isContinuation) return true;
            const flowKey = await currentFlowKey();
            return (await resolveGrantWorkspace(db, user.id, session.id, flowKey)) === null;
        },
        consentReferenceId: async ({
            user,
            session,
        }: {
            user: HookUser;
            session: HookSession;
        }): Promise<string> => {
            const workspace = await resolveGrantWorkspace(
                db,
                user.id,
                session.id,
                await currentFlowKey()
            );
            // better-auth: "YOU must fail in this function" when a reference
            // is required and missing. A grant with no workspace would be
            // a token that can read nothing — refuse it outright.
            if (!workspace) {
                throw new APIError("FORBIDDEN", {
                    error: "access_denied",
                    error_description: "No workspace chosen for this connection",
                });
            }
            return workspace;
        },
    };
}

/**
 * better-auth `customAccessTokenClaims`: puts the workspace in the token, and
 * refuses tokens (including refreshes) for someone no longer in it.
 */
export function workspaceAccessTokenClaims(db: Db) {
    return async ({
        user,
        referenceId,
    }: {
        user?: HookUser | null;
        referenceId?: string;
    }): Promise<Record<string, string>> => {
        if (!user || !referenceId) return {};
        const workspaces = await activeWorkspaceIds(db, user.id);
        if (!workspaces.includes(referenceId)) {
            throw new APIError("FORBIDDEN", {
                error: "access_denied",
                error_description: "Not an active member of the connected workspace",
            });
        }
        return { [MCP_WORKSPACE_CLAIM]: referenceId };
    };
}
