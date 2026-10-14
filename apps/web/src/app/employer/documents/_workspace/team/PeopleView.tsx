"use client";

/**
 * Everyone in the workspace, as cards: photo, name, title, role, groups. A
 * card opens the person's page; "Invite people" sits in the header for those
 * who may invite.
 */

import React, { useMemo, useState } from "react";
import { UserPlus } from "lucide-react";

import { ProfileAvatar } from "~/components/ProfileAvatar";
import { ToolLink } from "~/components/tool-app/ToolLink";
import { PageHeader } from "~/components/tools/PageHeader";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";

import type { Member } from "../settings/people/api";
import { plural } from "../settings/people/format";
import { teamPaths } from "./screens";
import { EmptyLine, FilterInput } from "./ui";

export function matchesPerson(member: Member, needle: string): boolean {
    if (!needle) return true;
    const haystack = [
        member.displayName,
        member.name,
        member.email,
        member.title ?? "",
        member.roleName,
        ...member.groups.map(g => g.name),
    ]
        .join("\n")
        .toLowerCase();
    return haystack.includes(needle);
}

export function PeopleView({
    members,
    canInvite,
    onInvite,
    manageLink,
}: {
    members: Member[];
    canInvite: boolean;
    onInvite: () => void;
    /** "Manage access" into Settings, for those who may open it. */
    manageLink?: React.ReactNode;
}) {
    const [query, setQuery] = useState("");
    const needle = query.trim().toLowerCase();
    const shown = useMemo(() => members.filter(m => matchesPerson(m, needle)), [members, needle]);

    return (
        <div className="mx-auto flex max-w-[1100px] flex-col gap-5">
            <PageHeader
                title="People"
                sub={
                    needle
                        ? `${shown.length} of ${plural(members.length, "person", "people")}`
                        : `${plural(members.length, "person", "people")} in the workspace. Open someone to see what you share with each other.`
                }
                actions={
                    <>
                        <FilterInput
                            value={query}
                            onChange={setQuery}
                            placeholder="Filter people"
                        />
                        {canInvite && (
                            <Button size="sm" onClick={onInvite} data-testid="team-invite">
                                <UserPlus className="size-3.5" />
                                Invite people
                            </Button>
                        )}
                        {manageLink}
                    </>
                }
            />

            {shown.length === 0 ? (
                <EmptyLine>
                    {needle ? `Nobody matches “${query.trim()}”.` : "Nobody else is here yet."}
                </EmptyLine>
            ) : (
                <ul
                    className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3 p-0"
                    data-testid="team-people"
                >
                    {shown.map(member => (
                        <li key={member.id} className="min-w-0">
                            <PersonCard member={member} />
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function PersonCard({ member }: { member: Member }) {
    const groups = member.groups.map(g => g.name).join(", ");
    return (
        <ToolLink
            href={teamPaths.person(member.id)}
            data-testid="team-person-row"
            className="border-line bg-panel hover:bg-panel-2 focus-visible:ring-brand flex h-full min-w-0 items-start gap-3 rounded-lg border p-3.5 no-underline outline-none focus-visible:ring-2"
        >
            <ProfileAvatar
                name={member.displayName}
                email={member.email}
                src={member.avatarUrl}
                className="size-10"
                fallbackClassName="text-xs"
            />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-ink truncate text-[13.5px] font-medium">
                    {member.displayName}
                    {member.isSelf && <span className="text-ink-3 font-normal"> (you)</span>}
                </span>
                <span className="text-ink-2 truncate text-[12px]" title={member.title ?? undefined}>
                    {member.title ?? member.email}
                </span>
                <span className="mt-1 flex min-w-0 items-center gap-1.5">
                    <Badge variant="secondary" className="shrink-0 px-1.5 text-[11px]">
                        {member.roleName}
                    </Badge>
                    {groups && (
                        <span className="text-ink-3 min-w-0 truncate text-[11.5px]" title={groups}>
                            {groups}
                        </span>
                    )}
                </span>
            </span>
        </ToolLink>
    );
}
