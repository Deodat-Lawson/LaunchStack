"use client";

/**
 * The workspace's groups, with faces and counts. Anyone but a Guest may start
 * one and then manages it (ADR-014); a row opens the group.
 */

import React, { useMemo } from "react";
import { Plus, Users } from "lucide-react";

import { Button } from "~/components/ui/button";

import type { Group, Member } from "../settings/people/api";
import { plural } from "../settings/people/format";
import { AvatarStack, EmptyLine, SectionHeading } from "./ui";

export function GroupsView({
    groups,
    byId,
    query,
    selfAuthUserId,
    canCreate,
    onCreate,
    onOpenGroup,
}: {
    groups: Group[];
    byId: Map<number, Member>;
    query: string;
    /** The viewer, to mark the groups they made. */
    selfAuthUserId: string | null;
    canCreate: boolean;
    onCreate: () => void;
    onOpenGroup: (groupId: number) => void;
}) {
    const needle = query.trim().toLowerCase();
    const shown = useMemo(
        () =>
            groups.filter(
                g =>
                    !needle ||
                    g.name.toLowerCase().includes(needle) ||
                    (g.description ?? "").toLowerCase().includes(needle) ||
                    g.members.some(m =>
                        (byId.get(m.id)?.displayName ?? m.name).toLowerCase().includes(needle)
                    )
            ),
        [groups, needle, byId]
    );

    return (
        <div className="pb-3">
            <SectionHeading
                action={
                    canCreate ? (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onCreate}
                            className="h-6 gap-1 px-2 text-[11.5px]"
                            data-testid="team-new-group"
                        >
                            <Plus className="size-3.5" />
                            New group
                        </Button>
                    ) : undefined
                }
            >
                {needle ? `${shown.length} of ${groups.length}` : plural(groups.length, "group")}
            </SectionHeading>

            {groups.length === 0 ? (
                <EmptyLine>
                    No groups yet. A group lets you share with several people in one step.
                </EmptyLine>
            ) : shown.length === 0 ? (
                <EmptyLine>No group matches “{query.trim()}”.</EmptyLine>
            ) : (
                <ul className="m-0 list-none p-0" data-testid="team-groups">
                    {shown.map(group => {
                        const faces = group.members
                            .map(m => byId.get(m.id))
                            .filter((m): m is Member => m !== undefined);
                        return (
                            <li key={group.id}>
                                <button
                                    type="button"
                                    onClick={() => onOpenGroup(group.id)}
                                    className="hover:bg-panel-2 focus-visible:bg-panel-2 flex min-h-11 w-full items-center gap-2.5 px-3.5 py-1.5 text-left outline-none"
                                >
                                    <span className="bg-brand-soft text-brand-ink grid size-8 shrink-0 place-items-center rounded-full">
                                        <Users className="size-4" />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="text-ink block truncate text-[13px] font-medium">
                                            {group.name}
                                        </span>
                                        <span className="text-ink-3 block truncate text-[11.5px]">
                                            {plural(group.memberCount, "member")}
                                            {selfAuthUserId && group.createdBy === selfAuthUserId
                                                ? " · Made by you"
                                                : ""}
                                        </span>
                                    </span>
                                    <AvatarStack people={faces} />
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
