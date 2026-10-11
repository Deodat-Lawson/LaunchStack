"use client";

/**
 * The Team tab of the rail (ADR-014 §7): People · Groups · Activity.
 *
 * - **People** — everyone, with photo, title, role and groups. A person's page
 *   shows what the two of you share with each other, lets you share something
 *   more, and lists what they have been doing.
 * - **Groups** — members start groups and manage the ones they made;
 *   `groups.manage` manages all.
 * - **Activity** — who added, shared, moved, renamed or deleted what, limited
 *   to what you can see now.
 *
 * Pages open inside the panel with a named "‹ Team" / "‹ Groups" button back.
 * The rail's filter box narrows whichever list is showing. Guests don't see
 * the member list (no `members.view`), so the tab says so in one line.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Activity, UserRound, Users } from "lucide-react";

import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { usePermissions } from "~/lib/use-permissions";

import { GroupDialog } from "../settings/people/GroupsTab";
import { ActivityList } from "./ActivityList";
import { GroupPage } from "./GroupPage";
import { GroupsView } from "./GroupsView";
import { InviteDialog } from "./InviteDialog";
import { PeopleView } from "./PeopleView";
import { PersonPage } from "./PersonPage";
import { mayCreateGroups } from "./rules";
import type { TeamRailProps } from "./types";
import { ErrorLine, LoadingRows, SectionHeading } from "./ui";
import { useTeamDirectory } from "./useTeamDirectory";

type TeamView = "people" | "groups" | "activity";

const VIEW_KEY = "launchstack.team.view";

function savedView(): TeamView {
    try {
        const raw = localStorage.getItem(VIEW_KEY);
        if (raw === "groups" || raw === "activity") return raw;
    } catch {
        // Private mode: start on People.
    }
    return "people";
}

export function TeamPanel({ query, onOpenTarget, onShare }: TeamRailProps) {
    const { loaded, can, role } = usePermissions();
    const allowed = loaded && can("members.view");
    const directory = useTeamDirectory(allowed);

    const [view, setView] = useState<TeamView>("people");
    const [personId, setPersonId] = useState<number | null>(null);
    const [groupId, setGroupId] = useState<number | null>(null);
    const [inviting, setInviting] = useState(false);
    const [creatingGroup, setCreatingGroup] = useState(false);

    useEffect(() => setView(savedView()), []);

    const switchView = useCallback((next: TeamView) => {
        setView(next);
        setPersonId(null);
        setGroupId(null);
        try {
            localStorage.setItem(VIEW_KEY, next);
        } catch {
            // Not remembered; harmless.
        }
    }, []);

    const openPerson = useCallback((id: number) => {
        setView("people");
        setGroupId(null);
        setPersonId(id);
    }, []);

    const openGroup = useCallback((id: number) => {
        setView("groups");
        setPersonId(null);
        setGroupId(id);
    }, []);

    if (!loaded) {
        return (
            <div className="min-h-0 flex-1" data-testid="team-panel">
                <LoadingRows />
            </div>
        );
    }

    if (!allowed) {
        return (
            <div className="min-h-0 flex-1" data-testid="team-panel">
                <p className="text-ink-3 m-0 px-4 py-3 text-[12.5px] leading-relaxed">
                    Your role sees only what is shared with you, so the team list is hidden. New
                    shares arrive in the inbox.
                </p>
            </div>
        );
    }

    const person = personId !== null ? directory.byId.get(personId) : undefined;
    const group = groupId !== null ? directory.groups.find(g => g.id === groupId) : undefined;
    const self = directory.members.find(m => m.isSelf);

    let body: React.ReactNode;
    if (view === "activity") {
        body = (
            <>
                <SectionHeading>Latest</SectionHeading>
                <ActivityList
                    query={query}
                    emptyText="Nothing yet. Adding, sharing and moving files shows up here."
                    onOpenTarget={onOpenTarget}
                    onOpenGroup={openGroup}
                />
            </>
        );
    } else if (directory.loading) {
        body = <LoadingRows />;
    } else if (directory.error) {
        body = <ErrorLine message={directory.error} onRetry={() => void directory.reload()} />;
    } else if (view === "people" && person) {
        body = (
            <PersonPage
                key={person.id}
                member={person}
                onBack={() => setPersonId(null)}
                onOpenTarget={onOpenTarget}
                onShare={onShare}
                onOpenGroup={openGroup}
            />
        );
    } else if (view === "groups" && group) {
        body = (
            <GroupPage
                key={group.id}
                group={group}
                members={directory.members}
                byId={directory.byId}
                onBack={() => setGroupId(null)}
                onOpenPerson={openPerson}
                onChanged={g => {
                    directory.upsertGroup(g);
                    // A person's groups line comes from the member list.
                    void directory.reload();
                }}
                onDeleted={id => {
                    setGroupId(null);
                    directory.dropGroup(id);
                    void directory.reload();
                }}
            />
        );
    } else if (view === "groups") {
        body = (
            <GroupsView
                groups={directory.groups}
                byId={directory.byId}
                query={query}
                selfAuthUserId={self?.authUserId ?? null}
                canCreate={mayCreateGroups(can, role)}
                onCreate={() => setCreatingGroup(true)}
                onOpenGroup={openGroup}
            />
        );
    } else {
        body = (
            <PeopleView
                members={directory.members}
                query={query}
                canInvite={can("members.invite")}
                onInvite={() => setInviting(true)}
                onOpenPerson={openPerson}
            />
        );
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col" data-testid="team-panel">
            <div className="px-3.5 pb-1">
                <ToggleGroup
                    type="single"
                    value={view}
                    onValueChange={next => {
                        if (next) switchView(next as TeamView);
                    }}
                    aria-label="Team view"
                    className="border-line grid grid-cols-3 gap-0.5 rounded-lg border p-0.5"
                >
                    <ToggleGroupItem
                        value="people"
                        aria-label="People"
                        data-testid="team-view-people"
                        className="h-7 gap-1 rounded-md px-1.5 text-[12px]"
                    >
                        <UserRound className="size-3.5" />
                        People
                    </ToggleGroupItem>
                    <ToggleGroupItem
                        value="groups"
                        aria-label="Groups"
                        data-testid="team-view-groups"
                        className="h-7 gap-1 rounded-md px-1.5 text-[12px]"
                    >
                        <Users className="size-3.5" />
                        Groups
                    </ToggleGroupItem>
                    <ToggleGroupItem
                        value="activity"
                        aria-label="Activity"
                        data-testid="team-view-activity"
                        className="h-7 gap-1 rounded-md px-1.5 text-[12px]"
                    >
                        <Activity className="size-3.5" />
                        Activity
                    </ToggleGroupItem>
                </ToggleGroup>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>

            <InviteDialog open={inviting} onClose={() => setInviting(false)} />
            <GroupDialog
                group={creatingGroup ? "new" : null}
                onClose={() => setCreatingGroup(false)}
                onSaved={g => {
                    setCreatingGroup(false);
                    directory.upsertGroup(g);
                    openGroup(g.id);
                }}
            />
        </div>
    );
}
