"use client";

/**
 * The Team tab (ADR-014 §7): People · Groups · Activity, as a Studio tab with
 * its screens across the top like every other tool.
 *
 * - **People** — everyone, with photo, title, role and groups. A person's
 *   page shows what the two of you share with each other, lets you share
 *   something more, and lists what they have been doing.
 * - **Groups** — members start groups and manage the ones they made;
 *   `groups.manage` manages all.
 * - **Activity** — who added, shared, moved, renamed or deleted what, limited
 *   to what you can see now, by day, narrowed by person and kind.
 *
 * It used to be a third tab of the sidebar. The sidebar makes, files and
 * shares sources; who is on the team and what they have been doing is a
 * place of its own. Roles, invitations, join links and the audit log stay
 * in Workspace › People and access — "Manage access" opens that tab for
 * those who may change them. Guests (no `members.view`) get one line saying
 * why there is no list.
 */

import React, { useCallback, useMemo, useState } from "react";
import { Activity, Settings2, UserRound, Users, UsersRound } from "lucide-react";

import { EmptyState } from "~/components/tools/EmptyState";
import { PageHeader } from "~/components/tools/PageHeader";
import {
    ToolFrame,
    ToolMark,
    ToolNotFound,
    type ToolNavGroup,
} from "~/components/tool-app/ToolFrame";
import { ToolLink } from "~/components/tool-app/ToolLink";
import {
    ToolNavProvider,
    useToolNav,
    useToolSearchParams,
    type ToolHost,
} from "~/components/tool-app/nav";
import { Button } from "~/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { workspaceHref } from "~/lib/settings/surfaces";
import { usePermissions } from "~/lib/use-permissions";
import {
    ACTIVITY_KINDS,
    ACTIVITY_KIND_IDS,
    isActivityKind,
    type ActivityKind,
} from "~/lib/workspace-activity-kinds";

import type { Member } from "../settings/people/api";
import { GroupDialog } from "../settings/people/GroupsTab";
import { ActivityList } from "./ActivityList";
import { GroupPage } from "./GroupPage";
import { GroupsView } from "./GroupsView";
import { InviteDialog } from "./InviteDialog";
import { PeopleView } from "./PeopleView";
import { PersonPage } from "./PersonPage";
import { mayCreateGroups } from "./rules";
import { TEAM_HOME, TEAM_ROOTS, teamPaths, teamScreenFor } from "./screens";
import type { TeamTarget } from "./types";
import { ErrorLine, FilterInput, LoadingRows } from "./ui";
import { useTeamDirectory } from "./useTeamDirectory";

export interface TeamToolProps {
    /** What the workspace hands a tool's tab: focus, a location, memory. */
    host?: ToolHost;
    /** Open a file, folder or chat a row points at, and show it in the sidebar. */
    onOpenTarget?: (target: TeamTarget) => void;
    /** Open the Share dialog on something (from a person's page). */
    onShare?: (target: TeamTarget & { name: string }) => void;
}

export function TeamTool({ host, ...props }: TeamToolProps) {
    return (
        <ToolNavProvider toolId="team" roots={TEAM_ROOTS} home={TEAM_HOME} host={host}>
            <TeamFrame {...props} />
        </ToolNavProvider>
    );
}

const SCREENS: ToolNavGroup[] = [
    {
        id: "team",
        items: [
            { to: teamPaths.people(), label: "People", icon: UserRound },
            { to: teamPaths.groups(), label: "Groups", icon: Users },
            { to: teamPaths.activity(), label: "Activity", icon: Activity },
        ],
    },
];

const ABOUT =
    "Who is in the workspace, the groups you share with, and what everyone has been doing. Roles, invitations, join links and the audit log are in Workspace › People and access.";

/** Where "Manage access" goes: the Workspace tab's screen with roles, invitations and the audit log. */
export const MANAGE_ACCESS_HREF = workspaceHref("people");

const noop = () => undefined;

function TeamFrame({ onOpenTarget = noop, onShare }: Omit<TeamToolProps, "host">) {
    const { path, navigate } = useToolNav();
    const { loaded, can, role } = usePermissions();
    const allowed = loaded && can("members.view");
    const directory = useTeamDirectory(allowed);
    const [inviting, setInviting] = useState(false);
    const [creatingGroup, setCreatingGroup] = useState(false);

    const openGroup = useCallback((id: number) => navigate(teamPaths.group(id)), [navigate]);

    const manageLink =
        loaded && can("settings.manage") ? (
            <Button asChild variant="outline" size="sm">
                <ToolLink
                    href={MANAGE_ACCESS_HREF}
                    data-testid="team-manage-access"
                    title="Roles, invitations, join links and the audit log"
                >
                    <Settings2 className="size-3.5" />
                    Manage access
                </ToolLink>
            </Button>
        ) : undefined;

    const screen = teamScreenFor(path);
    const self = directory.members.find(m => m.isSelf);

    let body: React.ReactNode;
    if (!loaded) {
        body = <ScreenLoading />;
    } else if (!allowed) {
        body = (
            <EmptyState
                className="mx-auto max-w-[1100px]"
                title="The team list isn't part of your role"
                body="You see only what is shared with you. New shares arrive in the inbox bell at the top of the sidebar."
            />
        );
    } else if (screen.kind === "activity") {
        body = (
            <ActivityScreen
                members={directory.members}
                membersLoading={directory.loading}
                onOpenTarget={onOpenTarget}
                onOpenGroup={openGroup}
            />
        );
    } else if (screen.kind === "not-found") {
        body = <ToolNotFound home={TEAM_HOME} homeLabel="People" />;
    } else if (directory.loading) {
        body = <ScreenLoading />;
    } else if (directory.error) {
        body = (
            <div className="mx-auto max-w-[1100px]">
                <ErrorLine
                    flush
                    message={directory.error}
                    onRetry={() => void directory.reload()}
                />
            </div>
        );
    } else if (screen.kind === "people") {
        body = (
            <PeopleView
                members={directory.members}
                canInvite={can("members.invite")}
                onInvite={() => setInviting(true)}
                manageLink={manageLink}
            />
        );
    } else if (screen.kind === "person") {
        const person = directory.byId.get(screen.id);
        body = person ? (
            <PersonPage
                key={person.id}
                member={person}
                onBack={() => navigate(teamPaths.people())}
                onOpenTarget={onOpenTarget}
                onShare={onShare}
                onOpenGroup={openGroup}
            />
        ) : (
            <ToolNotFound
                home={TEAM_HOME}
                homeLabel="People"
                title="This person is no longer here"
                body="They may have left the workspace, or the link is from somewhere else."
            />
        );
    } else if (screen.kind === "groups") {
        body = (
            <GroupsView
                groups={directory.groups}
                byId={directory.byId}
                selfAuthUserId={self?.authUserId ?? null}
                canCreate={mayCreateGroups(can, role)}
                onCreate={() => setCreatingGroup(true)}
                manageLink={manageLink}
            />
        );
    } else {
        const group = directory.groups.find(g => g.id === screen.id);
        body = group ? (
            <GroupPage
                key={group.id}
                group={group}
                members={directory.members}
                byId={directory.byId}
                onBack={() => navigate(teamPaths.groups())}
                onChanged={g => {
                    directory.upsertGroup(g);
                    // A person's groups line comes from the member list.
                    void directory.reload();
                }}
                onDeleted={id => {
                    navigate(teamPaths.groups(), { replace: true });
                    directory.dropGroup(id);
                    void directory.reload();
                }}
            />
        ) : (
            <ToolNotFound
                home={teamPaths.groups()}
                homeLabel="Groups"
                title="This group is no longer here"
                body="It may have been deleted, or the link is from somewhere else."
            />
        );
    }

    return (
        <ToolFrame
            title="Team"
            mark={<ToolMark icon={UsersRound} />}
            groups={allowed ? SCREENS : undefined}
            about={ABOUT}
        >
            <div data-testid="team-tool">{body}</div>
            <InviteDialog open={inviting} onClose={() => setInviting(false)} />
            <GroupDialog
                group={creatingGroup ? "new" : null}
                onClose={() => setCreatingGroup(false)}
                onSaved={g => {
                    setCreatingGroup(false);
                    directory.upsertGroup(g);
                    navigate(teamPaths.group(g.id));
                }}
            />
        </ToolFrame>
    );
}

/** Loading rows at the screen's width, lined up with where its heading will be. */
function ScreenLoading() {
    return (
        <div className="mx-auto max-w-[1100px]">
            <LoadingRows flush />
        </div>
    );
}

const EVERYONE = "everyone";
const ALL_KINDS = "all";

/**
 * Everything the reader may see, newest first, by day. The person and kind
 * live in the screen's query (`?person=8&kind=shared`), so Back, Forward and
 * "Copy link" keep them; the filter text is for the moment and stays local.
 */
function ActivityScreen({
    members,
    membersLoading,
    onOpenTarget,
    onOpenGroup,
}: {
    members: Member[];
    /** The member list is on its way: a `?person=` can't be read yet. */
    membersLoading: boolean;
    onOpenTarget: (target: TeamTarget) => void;
    onOpenGroup: (groupId: number) => void;
}) {
    const { navigate } = useToolNav();
    const params = useToolSearchParams();
    const [query, setQuery] = useState("");

    const personParam = params.get("person");
    const person = useMemo(
        () =>
            personParam && /^\d+$/.test(personParam)
                ? members.find(m => m.id === Number(personParam))
                : undefined,
        [members, personParam]
    );
    const kindParam = params.get("kind");
    const kind: ActivityKind | undefined =
        kindParam && isActivityKind(kindParam) ? kindParam : undefined;

    const setFilter = (next: { person?: string | null; kind?: string | null }) => {
        const search = new URLSearchParams(params);
        for (const [key, value] of Object.entries(next)) {
            if (value === undefined) continue;
            if (value === null) search.delete(key);
            else search.set(key, value);
        }
        const text = search.toString();
        navigate(text ? `?${text}` : "?", { replace: true });
    };

    const filtered = person !== undefined || kind !== undefined;

    return (
        <div className="mx-auto flex max-w-[1100px] flex-col gap-5">
            <PageHeader
                title="Activity"
                sub="Who added, shared, moved, renamed or deleted what. Only what you can open shows here."
                actions={
                    <>
                        <FilterInput
                            value={query}
                            onChange={setQuery}
                            placeholder="Filter activity"
                        />
                        <Select
                            value={person ? String(person.id) : EVERYONE}
                            onValueChange={v => setFilter({ person: v === EVERYONE ? null : v })}
                        >
                            <SelectTrigger
                                className="@max-md:w-full h-8 w-44 text-xs"
                                aria-label="Whose activity"
                                data-testid="team-activity-person"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={EVERYONE}>Everyone</SelectItem>
                                {members.map(m => (
                                    <SelectItem key={m.id} value={String(m.id)}>
                                        {m.isSelf ? `${m.displayName} (you)` : m.displayName}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Select
                            value={kind ?? ALL_KINDS}
                            onValueChange={v => setFilter({ kind: v === ALL_KINDS ? null : v })}
                        >
                            <SelectTrigger
                                className="@max-md:w-full h-8 w-44 text-xs"
                                aria-label="What kind of activity"
                                data-testid="team-activity-kind"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ALL_KINDS}>All activity</SelectItem>
                                {ACTIVITY_KIND_IDS.map(id => (
                                    <SelectItem key={id} value={id}>
                                        {ACTIVITY_KINDS[id].label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </>
                }
            />
            <section className="border-line bg-panel min-w-0 rounded-lg border pb-2">
                {/* A link naming a person waits for the member list, so it
                    never shows everyone's rows first and then theirs. */}
                {personParam && membersLoading ? (
                    <LoadingRows rows={5} />
                ) : (
                    <ActivityList
                        key={`${person?.authUserId ?? EVERYONE}:${kind ?? ALL_KINDS}`}
                        actor={person?.authUserId}
                        kind={kind}
                        query={query}
                        groupByDay
                        pageSize={40}
                        emptyText={
                            filtered
                                ? "Nothing matches these filters yet."
                                : "Nothing yet. Adding, sharing and moving files shows up here."
                        }
                        onOpenTarget={onOpenTarget}
                        onOpenGroup={onOpenGroup}
                    />
                )}
            </section>
        </div>
    );
}
