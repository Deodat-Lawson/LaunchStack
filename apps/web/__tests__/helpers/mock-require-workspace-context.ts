/**
 * The module stub for `jest.mock("~/lib/require-workspace-context", ...)`.
 *
 * Routes now reach the context through `requireWorkspacePermission` as often
 * as through `requireWorkspaceContext`. The real permission helper calls the
 * module-internal context resolver, which a mocked export cannot intercept,
 * so this stub derives it from the same resolver the test controls — a test
 * that hands back a Member context gets its 403 without stubbing twice.
 *
 * Deliberately does not `jest.requireActual` the real module: that would pull
 * the auth and database graph into every route test.
 *
 * Usage (the factory is hoisted, so reach the resolver through a `mock`-prefixed
 * variable or a function):
 *
 *   const mockRequireWorkspaceContext = jest.fn();
 *   jest.mock("~/lib/require-workspace-context", () =>
 *       jest
 *           .requireActual("../helpers/mock-require-workspace-context")
 *           .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
 *   );
 */

import { NextResponse } from "next/server";

import type { Permission } from "~/lib/authz/permissions";
import type { WorkspaceContext, WorkspaceContextResult } from "~/lib/require-workspace-context";

/** What a test hands back — a plain `Response` is fine for the failure leg. */
export type StubbedContextResult =
    | WorkspaceContextResult
    | { success: true; data: WorkspaceContext }
    | { success: false; response: Response };

export function forbiddenForPermission(permission?: Permission): NextResponse {
    return NextResponse.json(
        { error: "Forbidden", ...(permission ? { permission } : {}) },
        { status: 403 }
    );
}

export function workspaceContextModuleMock(
    resolve: () => StubbedContextResult | Promise<StubbedContextResult>
) {
    return {
        requireWorkspaceContext: () => Promise.resolve(resolve()),
        requireWorkspacePermission: async (permission: Permission) => {
            const ctx = await resolve();
            if (!ctx.success) return ctx;
            if (!ctx.data.can(permission)) {
                return { success: false as const, response: forbiddenForPermission(permission) };
            }
            return ctx;
        },
        forbiddenForPermission,
        forbiddenForRole: () => forbiddenForPermission(),
    };
}
