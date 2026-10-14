"use client";

/**
 * One person, inside the Team tab: who they are, their groups, what the two
 * of you share with each other — each row opens the thing — a way to share
 * something more, and what they have been doing.
 */

import React, { useCallback, useEffect, useState } from "react";

import { ProfileAvatar } from "~/components/ProfileAvatar";
import { Badge } from "~/components/ui/badge";
import { displayFolderPath } from "~/lib/folders/path";

import { errorMessage, type Member } from "../settings/people/api";
import { ActivityList } from "./ActivityList";
import { teamApi, type SharedItem } from "./api";
import { itemTarget, LEVEL_LABEL, shortAgo } from "./format";
import { SharePicker } from "./SharePicker";
import type { TeamTarget } from "./types";
import { BackButton, EmptyLine, ErrorLine, ItemIcon, LoadingRows, SectionHeading } from "./ui";

export function PersonPage({
    member,
    onBack,
    onOpenTarget,
    onShare,
    onOpenGroup,
}: {
    member: Member;
    onBack: () => void;
    onOpenTarget: (target: TeamTarget) => void;
    onShare?: (target: TeamTarget & { name: string }) => void;
    onOpenGroup: (groupId: number) => void;
}) {
    // Their name as this workspace shows it; headings truncate in a narrow rail.
    const name = member.displayName;
    const [shared, setShared] = useState<{
        sharedWithMe: SharedItem[];
        iShared: SharedItem[];
    } | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setError(null);
        try {
            setShared(await teamApi.sharedWith(member.id));
        } catch (err) {
            setError(errorMessage(err, "Couldn't load what you share."));
        }
    }, [member.id]);

    useEffect(() => {
        if (member.isSelf) return;
        setShared(null);
        void load();
    }, [member.isSelf, load]);

    const subtitle = [member.title, member.pronouns].filter(Boolean).join(" · ");

    return (
        <div className="pb-4" data-testid="team-person">
            <div className="px-3.5 pb-2 pt-1">
                <BackButton label="Team" onClick={onBack} />
            </div>

            <div className="flex items-start gap-3 px-3.5 pb-1 pt-1">
                <ProfileAvatar
                    name={member.displayName}
                    email={member.email}
                    src={member.avatarUrl}
                    className="size-11"
                    fallbackClassName="text-sm"
                />
                <div className="min-w-0 flex-1">
                    <h2 className="text-ink m-0 truncate text-[15px] font-semibold leading-tight">
                        {member.displayName}
                        {member.isSelf && <span className="text-ink-3 font-normal"> (you)</span>}
                    </h2>
                    {subtitle && (
                        <p className="text-ink-2 m-0 mt-0.5 truncate text-[12.5px]">{subtitle}</p>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary" className="px-1.5 text-[11px]">
                            {member.roleName}
                        </Badge>
                        {member.email && (
                            <span
                                className="text-ink-3 min-w-0 truncate text-[11.5px]"
                                title={member.email}
                            >
                                {member.email}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {member.groups.length > 0 && (
                <>
                    <SectionHeading>Groups</SectionHeading>
                    <div className="flex flex-wrap gap-1.5 px-3.5">
                        {member.groups.map(g => (
                            <Badge key={g.id} variant="outline" asChild className="text-[11.5px]">
                                <button
                                    type="button"
                                    onClick={() => onOpenGroup(g.id)}
                                    className="hover:bg-panel-2 cursor-pointer"
                                >
                                    {g.name}
                                </button>
                            </Badge>
                        ))}
                    </div>
                </>
            )}

            {!member.isSelf && (
                <>
                    {onShare && (
                        <div className="px-3.5 pt-3">
                            <SharePicker personName={name} onShare={onShare} />
                        </div>
                    )}

                    <SectionHeading>Shared with you by {name}</SectionHeading>
                    {error ? (
                        <ErrorLine message={error} onRetry={() => void load()} />
                    ) : shared === null ? (
                        <LoadingRows rows={2} />
                    ) : shared.sharedWithMe.length === 0 ? (
                        <EmptyLine>Nothing {name} has shared reaches you yet.</EmptyLine>
                    ) : (
                        <SharedList items={shared.sharedWithMe} onOpenTarget={onOpenTarget} />
                    )}

                    <SectionHeading>You shared with {name}</SectionHeading>
                    {error ? null : shared === null ? (
                        <LoadingRows rows={2} />
                    ) : shared.iShared.length === 0 ? (
                        <EmptyLine>You haven&apos;t shared anything with {name} yet.</EmptyLine>
                    ) : (
                        <SharedList items={shared.iShared} onOpenTarget={onOpenTarget} />
                    )}
                </>
            )}

            <SectionHeading>Activity</SectionHeading>
            <ActivityList
                actor={member.authUserId}
                pageSize={10}
                emptyText={
                    member.isSelf
                        ? "Nothing yet. What you add, share and move shows up here."
                        : `Nothing from ${name} that you can see yet.`
                }
                onOpenTarget={onOpenTarget}
                onOpenGroup={onOpenGroup}
            />
        </div>
    );
}

function SharedList({
    items,
    onOpenTarget,
}: {
    items: SharedItem[];
    onOpenTarget: (target: TeamTarget) => void;
}) {
    return (
        <ul className="m-0 list-none p-0" data-testid="team-shared-list">
            {items.map(item => (
                <li key={`${item.type}:${item.id}`}>
                    <button
                        type="button"
                        onClick={() => onOpenTarget(itemTarget(item))}
                        className="hover:bg-panel-2 focus-visible:bg-panel-2 flex w-full items-center gap-2.5 px-3.5 py-1.5 text-left outline-none"
                    >
                        <ItemIcon type={item.type} />
                        <span className="min-w-0 flex-1">
                            <span className="text-ink block truncate text-[12.5px]">
                                {item.type === "folder"
                                    ? displayFolderPath(item.path ?? item.name)
                                    : item.name}
                            </span>
                            <span className="text-ink-3 block truncate text-[11px]">
                                {LEVEL_LABEL[item.level]}
                                {item.viaGroup ? ` · via ${item.viaGroup}` : ""}
                                {` · ${shortAgo(item.at)}`}
                            </span>
                        </span>
                    </button>
                </li>
            ))}
        </ul>
    );
}
