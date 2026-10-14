"use client";

/**
 * The people and groups the Team tab draws, loaded once per visit and shared
 * by its views — a person's page shows their groups, a group's page shows its
 * people, and both read the same lists.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { errorMessage, peopleApi, type Group, type Member } from "../settings/people/api";

export interface TeamDirectory {
    /** Active members, in the server's order (role, then name). */
    members: Member[];
    groups: Group[];
    byId: Map<number, Member>;
    loading: boolean;
    error: string | null;
    reload: () => Promise<void>;
    /** Put a group the server just returned in place (or add it). */
    upsertGroup: (group: Group) => void;
    dropGroup: (id: number) => void;
}

export function useTeamDirectory(enabled: boolean): TeamDirectory {
    const [members, setMembers] = useState<Member[]>([]);
    const [groups, setGroups] = useState<Group[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const reload = useCallback(async () => {
        setError(null);
        try {
            const [mem, gr] = await Promise.all([
                peopleApi.members.list(),
                peopleApi.groups.list().catch(() => ({ groups: [] as Group[] })),
            ]);
            setMembers(mem.members.filter(m => m.status === "active"));
            setGroups(gr.groups);
        } catch (err) {
            setError(errorMessage(err, "Couldn't load the team."));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (enabled) void reload();
    }, [enabled, reload]);

    const upsertGroup = useCallback((group: Group) => {
        setGroups(prev => {
            const next = prev.some(g => g.id === group.id)
                ? prev.map(g => (g.id === group.id ? group : g))
                : [...prev, group];
            return next.sort((a, b) => a.name.localeCompare(b.name));
        });
    }, []);

    const dropGroup = useCallback((id: number) => {
        setGroups(prev => prev.filter(g => g.id !== id));
    }, []);

    const byId = useMemo(() => new Map(members.map(m => [m.id, m])), [members]);

    return { members, groups, byId, loading, error, reload, upsertGroup, dropGroup };
}
