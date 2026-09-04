"use client";

/**
 * What the signed-in person may do in the active workspace.
 *
 * One fetch of `POST /api/fetchUserInfo` per page load, shared by every
 * component that asks — the answer lives in a module-level store so twenty
 * `usePermissions()` calls cost one request, and an in-flight request is
 * reused rather than repeated.
 *
 * Fails closed: `can()` answers `false` until the answer has arrived. A menu
 * that gates on this shows nothing sensitive during the first paint instead
 * of flashing an admin tile at a viewer.
 *
 * After anything that changes the person's own role or status, call
 * `invalidatePermissions()` so the next render refetches.
 */

import React, { useCallback, useEffect, useSyncExternalStore } from "react";
import {
    isMembershipStatus,
    permissionsFromList,
    type MembershipStatus,
    type Permission,
} from "~/lib/authz/permissions";

export interface PermissionsSnapshot {
    /** The server has answered (successfully or not). */
    loaded: boolean;
    /** Role slug (`owner`, `admin`, a custom slug…) or null before load / without a workspace. */
    role: string | null;
    /** Display name of the role. */
    roleName: string | null;
    status: MembershipStatus | null;
    companyId: number | null;
    /** Workspace name, when the server reports one. */
    workspaceName: string | null;
    permissions: ReadonlySet<Permission>;
    /** Why the load failed, in words. Null when it succeeded. */
    error: string | null;
}

const NO_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>();

const INITIAL: PermissionsSnapshot = Object.freeze({
    loaded: false,
    role: null,
    roleName: null,
    status: null,
    companyId: null,
    workspaceName: null,
    permissions: NO_PERMISSIONS,
    error: null,
});

let snapshot: PermissionsSnapshot = INITIAL;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function getSnapshot(): PermissionsSnapshot {
    return snapshot;
}

function getServerSnapshot(): PermissionsSnapshot {
    return INITIAL;
}

/**
 * Turns the `/api/fetchUserInfo` payload into a snapshot. Pure, so the shape
 * the hook depends on is testable without a network.
 */
export function parseUserInfo(raw: unknown): Omit<PermissionsSnapshot, "loaded" | "error"> {
    const data = (raw ?? {}) as Record<string, unknown>;
    const status = isMembershipStatus(data.membershipStatus) ? data.membershipStatus : null;
    const permissions = Array.isArray(data.permissions)
        ? permissionsFromList(data.permissions)
        : new Set<Permission>();
    const companyIdRaw = data.companyId;
    const companyId =
        typeof companyIdRaw === "number"
            ? companyIdRaw
            : typeof companyIdRaw === "string" && companyIdRaw.trim() !== ""
              ? Number(companyIdRaw)
              : null;
    return {
        role: typeof data.role === "string" ? data.role : null,
        roleName: typeof data.roleName === "string" ? data.roleName : null,
        status,
        companyId: companyId !== null && Number.isFinite(companyId) ? companyId : null,
        workspaceName: typeof data.company === "string" ? data.company : null,
        // A suspended or pending membership holds nothing, whatever the server sent.
        permissions: status === "active" || status === null ? permissions : NO_PERMISSIONS,
    };
}

async function load(force = false): Promise<void> {
    if (inflight) return inflight;
    if (snapshot.loaded && !force) return;
    inflight = (async () => {
        try {
            const res = await fetch("/api/fetchUserInfo", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
            });
            if (!res.ok) {
                const body = (await res.json().catch(() => ({}))) as { error?: string };
                snapshot = {
                    ...INITIAL,
                    loaded: true,
                    error:
                        body.error ??
                        (res.status === 401
                            ? "You are signed out."
                            : `Could not load your permissions (${res.status}).`),
                };
                return;
            }
            const data: unknown = await res.json();
            snapshot = { ...parseUserInfo(data), loaded: true, error: null };
        } catch (err) {
            snapshot = {
                ...INITIAL,
                loaded: true,
                error: err instanceof Error ? err.message : "Could not load your permissions.",
            };
        } finally {
            inflight = null;
            emit();
        }
    })();
    return inflight;
}

/** Forget the cached answer and fetch again. Call after a role or status change. */
export function invalidatePermissions(): Promise<void> {
    snapshot = { ...snapshot, loaded: false };
    emit();
    return load(true);
}

/** Test seam: return the store to its pristine state. */
export function resetPermissionsForTests(): void {
    snapshot = INITIAL;
    inflight = null;
    listeners.clear();
}

export interface UsePermissionsResult extends PermissionsSnapshot {
    /**
     * Whether the person holds `permission`. False until loaded. A missing
     * requirement (`undefined`) is "no gate", so callers can write
     * `can(feature.requires)` for optional gates.
     */
    can: (permission: Permission | undefined) => boolean;
    /** Refetch now. */
    refresh: () => Promise<void>;
}

export function usePermissions(): UsePermissionsResult {
    const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

    useEffect(() => {
        void load();
    }, []);

    const can = useCallback(
        (permission: Permission | undefined): boolean => {
            if (permission === undefined) return true;
            if (!snap.loaded) return false;
            return snap.permissions.has(permission);
        },
        [snap]
    );

    return { ...snap, can, refresh: invalidatePermissions };
}

/**
 * Renders `children` only for someone who holds `permission`; `fallback`
 * (nothing by default) otherwise — including while loading.
 */
export function Can({
    permission,
    children,
    fallback = null,
}: {
    permission: Permission;
    children: React.ReactNode;
    fallback?: React.ReactNode;
}): React.ReactElement | null {
    const { can } = usePermissions();
    return React.createElement(React.Fragment, null, can(permission) ? children : fallback);
}
