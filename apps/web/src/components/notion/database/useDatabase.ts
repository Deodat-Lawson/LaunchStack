"use client";

/**
 * Database state: the schema, the views, and the rows.
 *
 * Every mutation is applied locally first and then persisted, because a
 * database grid that waits for a round-trip before showing a typed character
 * feels broken. Failures re-fetch rather than trying to invert the edit — the
 * server is the authority and a reload is cheap.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
    DatabaseProperty,
    DatabaseView,
    WorkspaceDatabaseDto,
    WorkspacePageDto,
} from "~/types/workspace";

export interface DatabaseState {
    database: WorkspaceDatabaseDto | null;
    rows: WorkspacePageDto[];
    loading: boolean;
    error: string | null;
    reload: () => Promise<void>;
    patchDatabase: (patch: Partial<WorkspaceDatabaseDto>) => Promise<void>;
    setProperties: (properties: DatabaseProperty[]) => Promise<void>;
    setViews: (views: DatabaseView[]) => Promise<void>;
    createRow: (values?: Record<string, unknown>) => Promise<WorkspacePageDto | null>;
    updateRow: (
        rowId: string,
        patch: { title?: string; properties?: Record<string, unknown>; icon?: unknown }
    ) => Promise<void>;
    deleteRow: (rowId: string) => Promise<void>;
}

export function useDatabase(databaseId: string | null, pageId: string): DatabaseState {
    const [database, setDatabase] = useState<WorkspaceDatabaseDto | null>(null);
    const [rows, setRows] = useState<WorkspacePageDto[]>([]);
    const [loading, setLoading] = useState(Boolean(databaseId));
    const [error, setError] = useState<string | null>(null);

    const reload = useCallback(async () => {
        if (!databaseId) return;
        setLoading(true);
        try {
            const response = await fetch(`/api/workspace/databases/${databaseId}`);
            if (!response.ok) {
                setError("This database could not be loaded.");
                return;
            }
            const data = (await response.json()) as {
                database: WorkspaceDatabaseDto;
                rows: WorkspacePageDto[];
            };
            setDatabase(data.database);
            setRows(data.rows);
            setError(null);
        } catch {
            setError("This database could not be loaded.");
        } finally {
            setLoading(false);
        }
    }, [databaseId]);

    useEffect(() => {
        void reload();
    }, [reload]);

    const patchDatabase = useCallback(
        async (patch: Partial<WorkspaceDatabaseDto>) => {
            if (!databaseId) return;
            setDatabase((current) => (current ? { ...current, ...patch } : current));
            const response = await fetch(`/api/workspace/databases/${databaseId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(patch),
            });
            if (!response.ok) await reload();
        },
        [databaseId, reload]
    );

    const setProperties = useCallback(
        (properties: DatabaseProperty[]) => patchDatabase({ properties }),
        [patchDatabase]
    );

    const setViews = useCallback(
        (views: DatabaseView[]) => patchDatabase({ views }),
        [patchDatabase]
    );

    const createRow = useCallback(
        async (values: Record<string, unknown> = {}) => {
            if (!databaseId) return null;
            const response = await fetch("/api/workspace/pages", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    parentPageId: pageId,
                    parentType: "database",
                    databaseId,
                    title: "",
                    properties: values,
                }),
            });
            if (!response.ok) return null;
            const data = (await response.json()) as { page: WorkspacePageDto };
            setRows((current) => [...current, data.page]);
            return data.page;
        },
        [databaseId, pageId]
    );

    const updateRow = useCallback(
        async (
            rowId: string,
            patch: { title?: string; properties?: Record<string, unknown>; icon?: unknown }
        ) => {
            setRows((current) =>
                current.map((row) =>
                    row.id === rowId
                        ? {
                              ...row,
                              ...(patch.title !== undefined ? { title: patch.title } : {}),
                              ...(patch.properties !== undefined
                                  ? { properties: patch.properties }
                                  : {}),
                          }
                        : row
                )
            );
            const response = await fetch(`/api/workspace/pages/${rowId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(patch),
            });
            if (!response.ok) await reload();
        },
        [reload]
    );

    const deleteRow = useCallback(
        async (rowId: string) => {
            setRows((current) => current.filter((row) => row.id !== rowId));
            const response = await fetch(`/api/workspace/pages/${rowId}`, {
                method: "DELETE",
            });
            if (!response.ok) await reload();
        },
        [reload]
    );

    return useMemo(
        () => ({
            database,
            rows,
            loading,
            error,
            reload,
            patchDatabase,
            setProperties,
            setViews,
            createRow,
            updateRow,
            deleteRow,
        }),
        [
            database,
            rows,
            loading,
            error,
            reload,
            patchDatabase,
            setProperties,
            setViews,
            createRow,
            updateRow,
            deleteRow,
        ]
    );
}
