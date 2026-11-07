"use client";

/**
 * One person, in the Team tab: who they are and their groups, then two
 * columns — what the two of you share with each other (each row opens the
 * thing, and "Share something…" adds more) beside what they have been doing.
 * The columns stack in a narrow tab.
 */

import React, { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { ProfileAvatar } from "~/components/ProfileAvatar";
import { ToolLink } from "~/components/tool-app/ToolLink";
import { Badge } from "~/components/ui/badge";
import { useRoleLabel } from "~/lib/authz/i18n";
import { displayFolderPath } from "~/lib/folders/path";

import { type Member } from "../settings/people/api";
import { useErrorText } from "../settings/people/ui";
import { ActivityList } from "./ActivityList";
import { teamApi, type SharedItem } from "./api";
import { itemTarget, shortAgo, useTeamFormat } from "./format";
import { teamPaths } from "./screens";
import { SharePicker } from "./SharePicker";
import type { TeamTarget } from "./types";
import { BackButton, EmptyLine, ErrorLine, ItemIcon, LoadingRows, Panel } from "./ui";

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
    const t = useTranslations("team.personPage");
    const errorText = useErrorText();
    const tTeam = useTranslations("team");
    const roleLabel = useRoleLabel();
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
            setError(errorText(err, t("loadError")));
        }
    }, [member.id, t, errorText]);

    useEffect(() => {
        if (member.isSelf) return;
        setShared(null);
        void load();
    }, [member.isSelf, load]);

    const subtitle = [member.title, member.pronouns].filter(Boolean).join(" · ");

    const activity = (
        <Panel
            title={member.isSelf ? t("yourActivity") : t("activity")}
            testId="team-person-activity"
        >
            <ActivityList
                actor={member.authUserId}
                pageSize={15}
                emptyText={member.isSelf ? t("emptySelf") : t("emptyOther", { name })}
                onOpenTarget={onOpenTarget}
                onOpenGroup={onOpenGroup}
            />
        </Panel>
    );

    return (
        <div className="mx-auto flex max-w-[1100px] flex-col gap-5" data-testid="team-person">
            <div>
                <BackButton label={t("back")} onClick={onBack} />
            </div>

            <header className="@max-md:flex-col flex items-start gap-4">
                <ProfileAvatar
                    name={member.displayName}
                    email={member.email}
                    src={member.avatarUrl}
                    className="size-16"
                    fallbackClassName="text-lg"
                />
                <div className="min-w-0 flex-1">
                    <h1 className="display text-ink m-0 text-[26px] leading-[1.15] tracking-[-0.02em]">
                        {member.displayName}
                        {member.isSelf && (
                            <span className="text-ink-3 font-normal">{tTeam("you")}</span>
                        )}
                    </h1>
                    {subtitle && <p className="text-ink-2 m-0 mt-1 text-[13px]">{subtitle}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary" className="px-1.5 text-[11px]">
                            {roleLabel(member.role, member.roleName)}
                        </Badge>
                        {member.groups.map(g => (
                            <Badge key={g.id} variant="outline" asChild className="text-[11.5px]">
                                <ToolLink
                                    href={teamPaths.group(g.id)}
                                    className="hover:bg-panel-2 no-underline"
                                >
                                    {g.name}
                                </ToolLink>
                            </Badge>
                        ))}
                        {member.email && (
                            <span
                                className="text-ink-3 min-w-0 truncate text-[12px]"
                                title={member.email}
                            >
                                {member.email}
                            </span>
                        )}
                    </div>
                </div>
                {!member.isSelf && onShare && (
                    <div className="@max-md:w-full w-48 shrink-0">
                        <SharePicker personName={name} onShare={onShare} />
                    </div>
                )}
            </header>

            {member.isSelf ? (
                activity
            ) : (
                <div className="@max-lg:grid-cols-1 grid grid-cols-2 items-start gap-4">
                    <div className="flex min-w-0 flex-col gap-4">
                        <Panel title={t("sharedWithYou", { name })} testId="team-shared-with-me">
                            {error ? (
                                <ErrorLine message={error} onRetry={() => void load()} />
                            ) : shared === null ? (
                                <LoadingRows rows={2} />
                            ) : shared.sharedWithMe.length === 0 ? (
                                <EmptyLine>{t("nothingShared", { name })}</EmptyLine>
                            ) : (
                                <SharedList
                                    items={shared.sharedWithMe}
                                    onOpenTarget={onOpenTarget}
                                />
                            )}
                        </Panel>
                        <Panel title={t("youShared", { name })} testId="team-i-shared">
                            {error ? null : shared === null ? (
                                <LoadingRows rows={2} />
                            ) : shared.iShared.length === 0 ? (
                                <EmptyLine>{t("nothingYouShared", { name })}</EmptyLine>
                            ) : (
                                <SharedList items={shared.iShared} onOpenTarget={onOpenTarget} />
                            )}
                        </Panel>
                    </div>
                    {activity}
                </div>
            )}
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
    const t = useTranslations("team.personPage");
    const tTeam = useTranslations("team");
    const f = useTeamFormat();
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
                                {tTeam(`levels.${item.level}`)}
                                {item.viaGroup ? ` · ${t("via", { group: item.viaGroup })}` : ""}
                                {` · ${shortAgo(f, item.at)}`}
                            </span>
                        </span>
                    </button>
                </li>
            ))}
        </ul>
    );
}
