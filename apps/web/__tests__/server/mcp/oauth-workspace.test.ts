/**
 * Every assistant OAuth grant is bound to one workspace: the post-login hook
 * decides whether the person must pick one, the consent reference is the
 * workspace, and the access token carries it — refused for non-members.
 */
import { mcpOauthWorkspaceChoices } from "~/server/db/schema/mcp";
import { userCompanyMemberships } from "~/server/db/schema/identity";
import {
    workspaceAccessTokenClaims,
    workspacePostLogin,
} from "~/server/mcp/oauth-workspace";

import { fakeDb } from "../../helpers/fake-db";

// The hooks take the auth module's Drizzle client as a parameter.
const db = fakeDb.db as never;
const user = { id: "auth-user-1" };
const session = { id: "session-1" };
const memberships = (...ids: number[]) => ids.map(companyId => ({ companyId: BigInt(companyId) }));

beforeEach(() => fakeDb.reset());

describe("workspacePostLogin.shouldRedirect", () => {
    const hooks = workspacePostLogin(db, "/oauth/workspace");

    it("skips the picker for someone in exactly one workspace", async () => {
        fakeDb.onSelect(userCompanyMemberships, memberships(50));
        await expect(
            hooks.shouldRedirect({ user, session, isContinuation: false })
        ).resolves.toBe(false);
    });

    it("always shows the picker on a fresh authorize for someone in several", async () => {
        fakeDb.onSelect(userCompanyMemberships, memberships(50, 62));
        // Even with a pick on file from an earlier flow in this browser.
        fakeDb.onSelect(mcpOauthWorkspaceChoices, [{ companyId: BigInt(62) }]);
        await expect(
            hooks.shouldRedirect({ user, session, isContinuation: false })
        ).resolves.toBe(true);
    });

    it("lets the flow continue once a workspace they belong to was picked", async () => {
        fakeDb.onSelect(userCompanyMemberships, memberships(50, 62));
        fakeDb.onSelect(mcpOauthWorkspaceChoices, [{ companyId: BigInt(62) }]);
        await expect(
            hooks.shouldRedirect({ user, session, isContinuation: true })
        ).resolves.toBe(false);
    });

    it("sends them back to the picker when the pick is not one of their workspaces", async () => {
        fakeDb.onSelect(userCompanyMemberships, memberships(50, 62));
        fakeDb.onSelect(mcpOauthWorkspaceChoices, [{ companyId: BigInt(99) }]);
        await expect(
            hooks.shouldRedirect({ user, session, isContinuation: true })
        ).resolves.toBe(true);
    });
});

describe("workspacePostLogin.consentReferenceId", () => {
    const hooks = workspacePostLogin(db, "/oauth/workspace");

    it("is the only workspace for a single-workspace person", async () => {
        fakeDb.onSelect(userCompanyMemberships, memberships(50));
        await expect(hooks.consentReferenceId({ user, session })).resolves.toBe("50");
    });

    it("is the picked workspace otherwise", async () => {
        fakeDb.onSelect(userCompanyMemberships, memberships(50, 62));
        fakeDb.onSelect(mcpOauthWorkspaceChoices, [{ companyId: BigInt(62) }]);
        await expect(hooks.consentReferenceId({ user, session })).resolves.toBe("62");
    });

    it("refuses a grant with no workspace", async () => {
        fakeDb.onSelect(userCompanyMemberships, memberships(50, 62));
        fakeDb.onSelect(mcpOauthWorkspaceChoices, []);
        await expect(hooks.consentReferenceId({ user, session })).rejects.toMatchObject({
            status: "FORBIDDEN",
        });
    });
});

describe("workspaceAccessTokenClaims", () => {
    const claims = workspaceAccessTokenClaims(db);

    it("puts the workspace in the token for an active member", async () => {
        fakeDb.onSelect(userCompanyMemberships, memberships(50, 62));
        await expect(claims({ user, referenceId: "62" })).resolves.toEqual({
            launchstack_workspace: "62",
        });
    });

    it("refuses to issue or refresh a token for someone no longer in the workspace", async () => {
        fakeDb.onSelect(userCompanyMemberships, memberships(50));
        await expect(claims({ user, referenceId: "62" })).rejects.toMatchObject({
            status: "FORBIDDEN",
        });
    });

    it("adds nothing when there is no person or no workspace", async () => {
        await expect(claims({ user: null, referenceId: "62" })).resolves.toEqual({});
        await expect(claims({ user })).resolves.toEqual({});
    });
});
