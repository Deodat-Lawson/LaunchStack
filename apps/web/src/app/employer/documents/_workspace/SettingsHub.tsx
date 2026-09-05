"use client";

/**
 * One settings surface.
 *
 * Configuration used to be five screens with five different looks: processing
 * on its own page, company metadata on another with its own theme wrapper and
 * table of contents, analytics on a third, agents nowhere, and integrations
 * only in environment variables. They are all the same job — telling the
 * workspace how to behave — so they are one screen now.
 *
 * The chrome here owns the page title, the section header, and the single
 * action area. Sections are *bodies*: no page shell, no header of their own,
 * no second Save button. A section publishes what its primary action is (see
 * `settings/contract.ts`) and the chrome renders it in the same place every
 * time. That is what makes five sections read as one product rather than five.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";

import { Users } from "lucide-react";

import { Button } from "~/components/ui/button";
import { IconBuilding, IconChart, IconRobot, IconSettings, IconSlack } from "./icons";
import { StatusNote } from "./settings/ui";
import type { SettingsSectionActions } from "./settings/contract";

const PeopleAccessSection = dynamic(
    () => import("./settings/PeopleAccessSection").then(m => m.PeopleAccessSection),
    { loading: () => <SectionLoading /> }
);

const ProcessingSettings = dynamic(
    () => import("./settings/ProcessingSettings").then(m => m.ProcessingSettings),
    { loading: () => <SectionLoading /> }
);

const AgentsPanel = dynamic(() => import("./collab/AgentsPanel").then(m => m.AgentsPanel), {
    loading: () => <SectionLoading />,
});

const IntegrationsPanel = dynamic(
    () => import("./settings/IntegrationsPanel").then(m => m.IntegrationsPanel),
    { loading: () => <SectionLoading /> }
);

const MetadataView = dynamic(
    () => import("~/app/employer/metadata/MetadataView").then(m => m.MetadataView),
    { loading: () => <SectionLoading /> }
);

const StatisticsView = dynamic(
    () => import("~/app/employer/statistics/StatisticsView").then(m => m.StatisticsView),
    { loading: () => <SectionLoading /> }
);

export type SettingsSectionId =
    | "people"
    | "processing"
    | "agents"
    | "integrations"
    | "company"
    | "analytics";

interface SectionDef {
    id: SettingsSectionId;
    /** Rail label. Short. */
    label: string;
    /** Rail sub-label. One clause. */
    blurb: string;
    /** Header eyebrow. */
    eyebrow: string;
    /** Header title. Full sentence case. */
    title: string;
    /** Header description. Says what the section is *for*, not what it contains. */
    description: string;
    Icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
    /** Wide sections get the full column; forms stay readable at 840px. */
    wide?: boolean;
    /** URL hashes that land here, so old deep links keep working. */
    aliases: string[];
}

const SECTIONS: SectionDef[] = [
    {
        id: "people",
        label: "People and access",
        blurb: "Members, roles, folders",
        eyebrow: "People",
        title: "Who is in the workspace, and what they can see",
        description:
            "Members and their roles, invitations and join links, groups, custom roles, and the audit log. Who can open a folder is set on the folder itself; roles decide everything else.",
        Icon: Users,
        wide: true,
        aliases: [
            "people",
            "members",
            "team",
            "employees",
            "invitations",
            "roles",
            "groups",
            "audit",
        ],
    },
    {
        id: "processing",
        label: "Processing",
        blurb: "Embedding index and keys",
        eyebrow: "Processing",
        title: "How documents get indexed",
        description:
            "The embedding index behind semantic search, the credentials it uses, and any self-hosted endpoints. Changing the index schedules a reindex of the whole corpus.",
        Icon: IconSettings,
        aliases: ["processing", "byok", "embedding", "keys"],
    },
    {
        id: "agents",
        label: "Agents & nodes",
        blurb: "The meeting roster",
        eyebrow: "Agents",
        title: "Who shows up to a meeting",
        description:
            "Each agent is a seat in a meeting: a name, a role, and standing instructions. Agents can run in this app or on another machine you connect.",
        Icon: IconRobot,
        aliases: ["agents", "nodes", "roster"],
    },
    {
        id: "integrations",
        label: "Integrations",
        blurb: "Slack and the meeting hub",
        eyebrow: "Integrations",
        title: "What this workspace connects to",
        description:
            "Slack mirroring for meetings, and the hub that remote agent machines dial into. Both are optional and independent.",
        Icon: IconSlack,
        aliases: ["integrations", "slack", "hub"],
    },
    {
        id: "company",
        label: "Company profile",
        blurb: "Industry, people, markets",
        eyebrow: "Company",
        title: "What the AI knows about your company",
        description:
            "Extracted from your documents and editable by hand. Agents cite this when a meeting needs company context.",
        Icon: IconBuilding,
        wide: true,
        aliases: ["company", "metadata", "profile"],
    },
    {
        id: "analytics",
        label: "Analytics",
        blurb: "Documents, queries, activity",
        eyebrow: "Analytics",
        title: "How the workspace is being used",
        description:
            "Documents indexed, queries asked, and activity by team member. Refresh to pull the latest.",
        Icon: IconChart,
        wide: true,
        aliases: ["analytics", "statistics", "stats"],
    },
];

const BY_ALIAS = new Map<string, SettingsSectionId>(
    SECTIONS.flatMap(s => s.aliases.map(alias => [alias, s.id] as const))
);

export interface SettingsHubProps {
    /** Inside the workspace shell rather than as a standalone page. */
    embedded?: boolean;
    initialSection?: SettingsSectionId;
}

export function SettingsHub({ embedded = false, initialSection }: SettingsHubProps) {
    const [section, setSection] = useState<SettingsSectionId>(initialSection ?? "processing");
    const [actions, setActions] = useState<SettingsSectionActions | null>(null);

    // `/employer/settings#byok`, `#metadata`, `#statistics` and friends were all
    // real destinations once. Keep every one of them working rather than quietly
    // dropping people on the first section.
    useEffect(() => {
        if (initialSection) return;
        if (typeof window === "undefined") return;
        const applyHash = () => {
            const hash = window.location.hash.replace("#", "").toLowerCase();
            const target = BY_ALIAS.get(hash);
            if (target) setSection(target);
        };
        applyHash();
        window.addEventListener("hashchange", applyHash);
        return () => window.removeEventListener("hashchange", applyHash);
    }, [initialSection]);

    // A section's published actions belong to that section. Dropping them on
    // every switch stops a stale Save button from outliving the form it saved.
    const selectSection = useCallback((next: SettingsSectionId) => {
        setActions(null);
        setSection(next);
    }, []);

    const registerActions = useCallback((next: SettingsSectionActions | null) => {
        setActions(next);
    }, []);

    const active = useMemo(() => SECTIONS.find(s => s.id === section) ?? SECTIONS[0]!, [section]);

    return (
        <div
            style={{
                display: "flex",
                height: embedded ? "100%" : "100vh",
                minHeight: 0,
                background: "var(--bg)",
                color: "var(--ink)",
            }}
        >
            <nav
                aria-label="Settings sections"
                style={{
                    width: 240,
                    flexShrink: 0,
                    borderRight: "1px solid var(--line)",
                    background: "var(--panel)",
                    padding: "18px 10px",
                    overflowY: "auto",
                }}
            >
                <div
                    className="mono"
                    style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        color: "var(--ink-3)",
                        padding: "0 10px 12px",
                    }}
                >
                    Settings
                </div>
                {SECTIONS.map(item => {
                    const isActive = item.id === section;
                    return (
                        <button
                            key={item.id}
                            onClick={() => selectSection(item.id)}
                            aria-current={isActive ? "page" : undefined}
                            style={{
                                width: "100%",
                                textAlign: "left",
                                display: "flex",
                                gap: 10,
                                alignItems: "flex-start",
                                padding: "9px 10px",
                                borderRadius: 9,
                                marginBottom: 2,
                                background: isActive ? "var(--accent-soft)" : "transparent",
                                color: isActive ? "var(--accent-ink)" : "var(--ink-2)",
                                transition: "background 120ms",
                            }}
                            onMouseEnter={e => {
                                if (!isActive) e.currentTarget.style.background = "var(--line-2)";
                            }}
                            onMouseLeave={e => {
                                if (!isActive) e.currentTarget.style.background = "transparent";
                            }}
                        >
                            <item.Icon
                                size={15}
                                style={{ marginTop: 1, flexShrink: 0, opacity: 0.85 }}
                            />
                            <span style={{ minWidth: 0 }}>
                                <span
                                    style={{
                                        display: "block",
                                        fontSize: 13,
                                        fontWeight: isActive ? 600 : 500,
                                    }}
                                >
                                    {item.label}
                                </span>
                                <span
                                    style={{
                                        display: "block",
                                        fontSize: 11,
                                        color: "var(--ink-3)",
                                        marginTop: 1,
                                        lineHeight: 1.4,
                                    }}
                                >
                                    {item.blurb}
                                </span>
                            </span>
                        </button>
                    );
                })}
            </nav>

            <div
                style={{
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    flexDirection: "column",
                    minHeight: 0,
                }}
            >
                <SectionHeader definition={active} actions={actions} />

                <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                    <div
                        style={{
                            maxWidth: active.wide ? 1200 : 840,
                            width: "100%",
                            margin: "0 auto",
                            padding: "24px 28px 72px",
                        }}
                    >
                        <SectionBody id={active.id} onActions={registerActions} />
                    </div>
                </div>
            </div>
        </div>
    );
}

/**
 * The one header and the one action area. Everything a section wants to offer
 * as a primary action arrives here.
 */
function SectionHeader({
    definition,
    actions,
}: {
    definition: SectionDef;
    actions: SettingsSectionActions | null;
}) {
    const busyLabel = actions?.primaryBusyLabel ?? `${actions?.primaryLabel ?? ""}…`;

    return (
        <header
            style={{
                flexShrink: 0,
                borderBottom: "1px solid var(--line)",
                background: "var(--panel)",
                padding: "18px 28px 16px",
            }}
        >
            <div
                style={{
                    maxWidth: definition.wide ? 1200 : 840,
                    margin: "0 auto",
                    width: "100%",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 16,
                }}
            >
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                        className="mono"
                        style={{
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: "0.1em",
                            color: "var(--ink-3)",
                            textTransform: "uppercase",
                            marginBottom: 5,
                        }}
                    >
                        {definition.eyebrow}
                    </div>
                    <h1
                        className="serif"
                        style={{
                            fontSize: 26,
                            lineHeight: 1.15,
                            letterSpacing: "-0.02em",
                            color: "var(--ink)",
                            margin: 0,
                        }}
                    >
                        {definition.title}
                    </h1>
                    <p
                        style={{
                            fontSize: 13,
                            color: "var(--ink-3)",
                            margin: "7px 0 0",
                            lineHeight: 1.55,
                            maxWidth: 660,
                        }}
                    >
                        {definition.description}
                    </p>
                </div>

                {(actions?.secondary ?? actions?.primaryLabel) && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                        {actions?.secondary}
                        {actions?.primaryLabel && (
                            <Button
                                onClick={() => void actions.onPrimary?.()}
                                disabled={actions.busy ?? actions.disabled ?? false}
                                style={{ padding: "9px 16px" }}
                            >
                                {actions.busy ? busyLabel : actions.primaryLabel}
                            </Button>
                        )}
                    </div>
                )}
            </div>
        </header>
    );
}

function SectionBody({
    id,
    onActions,
}: {
    id: SettingsSectionId;
    onActions: (actions: SettingsSectionActions | null) => void;
}) {
    switch (id) {
        case "people":
            return <PeopleAccessSection onActions={onActions} />;
        case "processing":
            return <ProcessingSettings onActions={onActions} />;
        case "agents":
            return <AgentsPanel onActions={onActions} />;
        case "integrations":
            return <IntegrationsPanel onActions={onActions} />;
        case "company":
            return <MetadataView bare onActions={onActions} />;
        case "analytics":
            return <StatisticsView bare onActions={onActions} />;
    }
}

function SectionLoading() {
    return <StatusNote tone="muted">Loading…</StatusNote>;
}

/** Resolves a URL hash to a section id. Exported for the redirect shims. */
export function settingsSectionFromHash(hash: string): SettingsSectionId | null {
    return BY_ALIAS.get(hash.replace("#", "").toLowerCase()) ?? null;
}
