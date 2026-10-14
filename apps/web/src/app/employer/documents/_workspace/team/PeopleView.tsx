"use client";

/**
 * Everyone in the workspace: photo, name, title, role, groups. A row opens
 * the person's page; "Invite people" sits on top for those who may invite.
 */

import React, { useMemo } from "react";
import { UserPlus } from "lucide-react";

import { ProfileAvatar } from "~/components/ProfileAvatar";
import { Button } from "~/components/ui/button";

import type { Member } from "../settings/people/api";
import { plural } from "../settings/people/format";
import { EmptyLine, SectionHeading } from "./ui";

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
    query,
    canInvite,
    onInvite,
    onOpenPerson,
}: {
    members: Member[];
    query: string;
    canInvite: boolean;
    onInvite: () => void;
    onOpenPerson: (memberId: number) => void;
}) {
    const needle = query.trim().toLowerCase();
    const shown = useMemo(() => members.filter(m => matchesPerson(m, needle)), [members, needle]);

    return (
        <div className="pb-3">
            <SectionHeading
                action={
                    canInvite ? (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onInvite}
                            className="h-6 gap-1 px-2 text-[11.5px]"
                            data-testid="team-invite"
                        >
                            <UserPlus className="size-3.5" />
                            Invite people
                        </Button>
                    ) : undefined
                }
            >
                {needle
                    ? `${shown.length} of ${members.length}`
                    : plural(members.length, "person", "people")}
            </SectionHeading>

            {shown.length === 0 ? (
                <EmptyLine>
                    {needle ? `Nobody matches “${query.trim()}”.` : "Nobody else is here yet."}
                </EmptyLine>
            ) : (
                <ul className="m-0 list-none p-0" data-testid="team-people">
                    {shown.map(member => {
                        const line = [
                            member.title,
                            member.roleName,
                            member.groups.map(g => g.name).join(", "),
                        ]
                            .filter(Boolean)
                            .join(" · ");
                        return (
                            <li key={member.id}>
                                <button
                                    type="button"
                                    onClick={() => onOpenPerson(member.id)}
                                    data-testid="team-person-row"
                                    className="hover:bg-panel-2 focus-visible:bg-panel-2 flex min-h-11 w-full items-center gap-2.5 px-3.5 py-1.5 text-left outline-none"
                                >
                                    <ProfileAvatar
                                        name={member.displayName}
                                        email={member.email}
                                        src={member.avatarUrl}
                                        className="size-8"
                                        fallbackClassName="text-[10.5px]"
                                    />
                                    <span className="min-w-0 flex-1">
                                        <span className="text-ink block truncate text-[13px] font-medium">
                                            {member.displayName}
                                            {member.isSelf && (
                                                <span className="text-ink-3 font-normal">
                                                    {" "}
                                                    (you)
                                                </span>
                                            )}
                                        </span>
                                        <span
                                            className="text-ink-3 block truncate text-[11.5px]"
                                            title={line}
                                        >
                                            {line}
                                        </span>
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
