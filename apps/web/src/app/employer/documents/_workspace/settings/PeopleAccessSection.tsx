"use client";

/**
 * People and access — one Settings section, five tabs.
 *
 * Body only: the chrome owns the header and the single primary action, which
 * here is "Invite people" (it switches to the Invitations tab). Each tab
 * loads its own data and gates its own controls on the viewer's permissions;
 * the section as a whole is behind `members.view`.
 */

import React, { useEffect, useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { usePermissions } from "~/lib/use-permissions";

import { usePublishedActions, type SettingsSectionProps } from "./contract";
import { StatusNote } from "./ui";
import { AuditTab } from "./people/AuditTab";
import { GroupsTab } from "./people/GroupsTab";
import { InvitationsTab } from "./people/InvitationsTab";
import { MembersTab } from "./people/MembersTab";
import { RolesTab } from "./people/RolesTab";
import { WorkspaceSettingsCard } from "./people/WorkspaceSettingsCard";

type TabId = "members" | "invitations" | "groups" | "roles" | "audit";

/** URL hashes that open a particular tab, so deep links from elsewhere work. */
const TAB_ALIASES: Record<string, TabId> = {
    members: "members",
    people: "members",
    team: "members",
    employees: "members",
    invitations: "invitations",
    invites: "invitations",
    "join-links": "invitations",
    groups: "groups",
    roles: "roles",
    audit: "audit",
};

function tabFromHash(): TabId {
    if (typeof window === "undefined") return "members";
    const hash = window.location.hash.replace("#", "").toLowerCase();
    return TAB_ALIASES[hash] ?? "members";
}

export function PeopleAccessSection({ onActions }: SettingsSectionProps) {
    const { loaded, can, error } = usePermissions();
    const [tab, setTab] = useState<TabId>("members");

    useEffect(() => {
        setTab(tabFromHash());
        const onHash = () => setTab(tabFromHash());
        window.addEventListener("hashchange", onHash);
        return () => window.removeEventListener("hashchange", onHash);
    }, []);

    const canInvite = loaded && can("members.invite");
    usePublishedActions(
        onActions,
        canInvite
            ? {
                  primaryLabel: "Invite people",
                  onPrimary: () => setTab("invitations"),
              }
            : {},
        [canInvite]
    );

    if (!loaded) return <StatusNote tone="muted">Loading…</StatusNote>;
    if (error) return <StatusNote tone="danger">{error}</StatusNote>;
    if (!can("members.view")) {
        return (
            <StatusNote tone="muted">
                Seeing who is in the workspace isn&apos;t part of your role. Ask an admin if you
                need it.
            </StatusNote>
        );
    }

    return (
        <div className="flex flex-col gap-6">
            {can("settings.manage") && <WorkspaceSettingsCard />}

            <Tabs value={tab} onValueChange={value => setTab(value as TabId)}>
                <TabsList aria-label="People and access">
                    <TabsTrigger value="members">Members</TabsTrigger>
                    <TabsTrigger value="invitations">Invitations</TabsTrigger>
                    <TabsTrigger value="groups">Groups</TabsTrigger>
                    <TabsTrigger value="roles">Roles</TabsTrigger>
                    <TabsTrigger value="audit">Audit</TabsTrigger>
                </TabsList>
                <TabsContent value="members" className="pt-3">
                    <MembersTab can={can} />
                </TabsContent>
                <TabsContent value="invitations" className="pt-3">
                    <InvitationsTab can={can} />
                </TabsContent>
                <TabsContent value="groups" className="pt-3">
                    <GroupsTab can={can} />
                </TabsContent>
                <TabsContent value="roles" className="pt-3">
                    <RolesTab can={can} />
                </TabsContent>
                <TabsContent value="audit" className="pt-3">
                    <AuditTab can={can} />
                </TabsContent>
            </Tabs>
        </div>
    );
}
