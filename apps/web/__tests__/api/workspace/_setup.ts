/**
 * Shared wiring for the /api/workspace route tests: a fake database keyed by
 * real schema tables, a permission gate that honours the test's context, and
 * request builders. Each test file still declares its own `jest.mock` calls
 * (they must be hoisted in that file); this module only holds the helpers.
 */

import { NextResponse } from "next/server";

import type { WorkspaceContext } from "~/lib/require-workspace-context";
import type { Permission } from "~/lib/authz/permissions";

export function gateFor(ctx: WorkspaceContext) {
    return async (permission: Permission) =>
        ctx.can(permission)
            ? { success: true as const, data: ctx }
            : {
                  success: false as const,
                  response: NextResponse.json({ error: "Forbidden", permission }, { status: 403 }),
              };
}

export function jsonRequest(url: string, method: string, body?: unknown): Request {
    return new Request(`http://localhost${url}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}

export function params<T extends Record<string, string>>(value: T): { params: Promise<T> } {
    return { params: Promise.resolve(value) };
}

export function memberRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        id: 8,
        authUserId: "user-b",
        name: "Bea",
        email: "bea@example.com",
        role: "member",
        status: "active",
        joinedAt: new Date("2026-01-01T00:00:00Z"),
        lastActiveAt: null,
        ...overrides,
    };
}
