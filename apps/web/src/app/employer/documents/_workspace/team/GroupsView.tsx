"use client";

/**
 * The workspace's groups, as cards with faces and counts. Anyone but a Guest
 * may start one and then manages it (ADR-014); a card opens the group.
 */

import React, { useMemo, useState } from "react";
import { Plus, Users } from "lucide-react";

import { ToolLink } from "~/components/tool-app/ToolLink";
import { PageHeader } from "~/components/tools/PageHeader";
import { Button } from "~/components/ui/button";

import type { Group, Member } from "../settings/people/api";
import { plural } from "../settings/people/format";
import { teamPaths } from "./screens";
import { AvatarStack, EmptyLine, FilterInput } from "./ui";

export function GroupsView({
    groups,
    byId,
    selfAuthUserId,
    canCreate,
    onCreate,
    manageLink,
}: {
    groups: Group[];
    byId: Map<number, Member>;
    /** The viewer, to mark the groups they made. */
    selfAuthUserId: string | null;
    canCreate: boolean;
    onCreate: () => void;
    /** "Manage access" into Settings, for those who may open it. */
    manageLink?: React.ReactNode;
}) {
    const [query, setQuery] = useState("");
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
        <div className="mx-auto flex max-w-[1100px] flex-col gap-5">
            <PageHeader
                title="Groups"
                sub={
                    needle
                        ? `${shown.length} of ${plural(groups.length, "group")}`
                        : "Share a folder, file or chat with several people in one step."
                }
                actions={
                    <>
                        {groups.length > 0 && (
                            <FilterInput
                                value={query}
                                onChange={setQuery}
                                placeholder="Filter groups"
                            />
                        )}
                        {canCreate && (
                            <Button size="sm" onClick={onCreate} data-testid="team-new-group">
                                <Plus className="size-3.5" />
                                New group
                            </Button>
                        )}
                        {manageLink}
                    </>
                }
            />

            {groups.length === 0 ? (
                <EmptyLine flush>
                    No groups yet. A group lets you share with several people in one step.
                </EmptyLine>
            ) : shown.length === 0 ? (
                <EmptyLine flush>No group matches “{query.trim()}”.</EmptyLine>
            ) : (
                <ul
                    className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3 p-0"
                    data-testid="team-groups"
                >
                    {shown.map(group => {
                        const faces = group.members
                            .map(m => byId.get(m.id))
                            .filter((m): m is Member => m !== undefined);
                        return (
                            <li key={group.id} className="min-w-0">
                                <ToolLink
                                    href={teamPaths.group(group.id)}
                                    data-testid="team-group-row"
                                    className="border-line bg-panel hover:bg-panel-2 focus-visible:ring-brand flex h-full min-w-0 flex-col gap-2.5 rounded-lg border p-3.5 no-underline outline-none focus-visible:ring-2"
                                >
                                    <span className="flex min-w-0 items-center gap-2.5">
                                        <span className="bg-brand-soft text-brand-ink grid size-8 shrink-0 place-items-center rounded-full">
                                            <Users className="size-4" />
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="text-ink block truncate text-[13.5px] font-medium">
                                                {group.name}
                                            </span>
                                            <span className="text-ink-3 block truncate text-[11.5px]">
                                                {plural(group.memberCount, "member")}
                                                {selfAuthUserId &&
                                                group.createdBy === selfAuthUserId
                                                    ? " · Made by you"
                                                    : ""}
                                            </span>
                                        </span>
                                    </span>
                                    {group.description && (
                                        <span className="text-ink-2 line-clamp-2 text-[12px] leading-snug">
                                            {group.description}
                                        </span>
                                    )}
                                    {faces.length > 0 && <AvatarStack people={faces} max={5} />}
                                </ToolLink>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
