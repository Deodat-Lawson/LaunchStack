"use client";

/**
 * Integrations — workspace connections, Slack mirroring and the meeting hub.
 *
 * Body only; the header and any action live in the settings chrome. The
 * workspace-connections section is live per-tenant state (connect/disconnect
 * happens in Add source → Connect); the Slack/hub sections below it are a
 * readout of environment-variable configuration.
 */

import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Card, Section } from "~/components/layout/page-shell";
import { useAgents } from "../collab/useMeetings";
import { usePublishedActions, type SettingsSectionProps } from "./contract";
import { Code, StatusNote, StatusRow } from "./ui";

const PROVIDER_LABELS: Record<string, string> = {
    "google-drive": "Google Drive",
    slack: "Slack",
    github: "GitHub",
};

interface ConnectorsOverview {
    providers: Record<string, { configured: boolean }>;
    connections: Array<{
        id: string;
        provider: string;
        displayName: string | null;
        status: string;
        statusDetail: string | null;
        grantedBy: string | null;
        createdAt: string;
    }>;
}

/** Workspace connections, from the connectors overview route. */
function useConnectorsOverview() {
    const [data, setData] = useState<ConnectorsOverview | null>(null);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/connectors");
            if (res.ok) {
                const payload = (await res.json()) as { data?: ConnectorsOverview };
                setData(payload.data ?? null);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    return { data, loading, refresh };
}

const SLACK_COMMANDS: Array<[string, string]> = [
    ["!takeover [@agent]", "Pause the agents and take the floor, optionally in an agent's seat"],
    ["!release", "Hand control back to the agents"],
    ["!pause / !resume", "Stop or restart agent turns"],
    ["!run 3", "Let the agents take up to three more turns"],
    ["!end", "Close the meeting and produce minutes"],
    ["!help", "Post the command reference into the channel"],
];

export function IntegrationsPanel({ onActions }: SettingsSectionProps) {
    const { data, loading, refresh } = useAgents();
    const connectors = useConnectorsOverview();
    const refreshConnectors = connectors.refresh;
    const [disconnecting, setDisconnecting] = useState<string | null>(null);
    const origin = typeof window === "undefined" ? "https://your-app" : window.location.origin;

    const refreshAll = useCallback(() => {
        void refresh();
        void refreshConnectors();
    }, [refresh, refreshConnectors]);

    usePublishedActions(
        onActions,
        {
            primaryLabel: "Recheck",
            primaryBusyLabel: "Checking…",
            onPrimary: refreshAll,
            busy: loading || connectors.loading,
        },
        [refreshAll, loading, connectors.loading]
    );

    const disconnect = async (connectionId: string, label: string) => {
        setDisconnecting(connectionId);
        try {
            const res = await fetch(`/api/connectors/connections/${connectionId}`, {
                method: "DELETE",
            });
            if (res.ok) {
                toast.success(`${label} disconnected`);
                await refreshConnectors();
            } else {
                toast.error(`Could not disconnect ${label}`);
            }
        } finally {
            setDisconnecting(null);
        }
    };

    if (loading && !data) {
        return <StatusNote tone="muted">Checking configuration…</StatusNote>;
    }

    const configuredProviders = Object.entries(connectors.data?.providers ?? {}).filter(
        ([, value]) => value.configured
    );

    return (
        <>
            <Section
                title="Workspace connections"
                description="Accounts this workspace has connected. Connecting happens in the documents workspace under Add source → Connect; tokens are encrypted at rest and never leave the server."
            >
                <Card>
                    {connectors.loading && !connectors.data ? (
                        <StatusNote tone="muted">Checking connections…</StatusNote>
                    ) : (connectors.data?.connections.length ?? 0) === 0 ? (
                        <StatusNote tone="muted">
                            {configuredProviders.length > 0 ? (
                                <>
                                    Nothing connected yet. Available on this server:{" "}
                                    {configuredProviders
                                        .map(([key]) => PROVIDER_LABELS[key] ?? key)
                                        .join(", ")}
                                    .
                                </>
                            ) : (
                                <>
                                    No provider OAuth clients are configured. Set the client-id /
                                    client-secret pairs described in <Code>.env.example</Code>{" "}
                                    (Workspace connections block) plus{" "}
                                    <Code>EMBEDDING_SECRETS_KEY</Code>.
                                </>
                            )}
                        </StatusNote>
                    ) : (
                        connectors.data?.connections.map(row => {
                            const label = PROVIDER_LABELS[row.provider] ?? row.provider;
                            return (
                                <StatusRow
                                    key={row.id}
                                    label={label}
                                    ok={row.status === "active"}
                                    detail={
                                        <>
                                            {row.displayName ?? "connected"}
                                            {row.grantedBy
                                                ? ` · connected by ${row.grantedBy}`
                                                : ""}
                                            {row.status !== "active"
                                                ? ` · ${row.status}${row.statusDetail ? ` — ${row.statusDetail}` : ""}`
                                                : ""}{" "}
                                            <button
                                                onClick={() => void disconnect(row.id, label)}
                                                disabled={disconnecting === row.id}
                                                style={{
                                                    fontSize: 12,
                                                    fontWeight: 600,
                                                    color: "var(--ink-2)",
                                                    padding: "2px 8px",
                                                    borderRadius: 6,
                                                    border: "1px solid var(--line)",
                                                    cursor:
                                                        disconnecting === row.id
                                                            ? "wait"
                                                            : "pointer",
                                                }}
                                            >
                                                {disconnecting === row.id
                                                    ? "Removing…"
                                                    : "Disconnect"}
                                            </button>
                                        </>
                                    }
                                />
                            );
                        })
                    )}
                </Card>
            </Section>

            <Section
                title="Slack"
                description="Hold a meeting in a real Slack channel. Agent turns are posted there, and anything a person writes back lands in the same transcript."
            >
                <Card>
                    <StatusRow
                        label="Post to Slack"
                        ok={data?.slack.canPost ?? false}
                        detail={
                            data?.slack.canPost ? (
                                "Meeting turns are mirrored into the linked channel."
                            ) : (
                                <>
                                    Set <Code>SLACK_BOT_TOKEN</Code> with <Code>chat:write</Code> on
                                    a Slack app installed to your workspace.
                                </>
                            )
                        }
                    />
                    <StatusRow
                        label="Receive from Slack"
                        ok={data?.slack.canReceive ?? false}
                        detail={
                            data?.slack.canReceive ? (
                                "Messages people write in Slack are added to the meeting, including the controls below."
                            ) : (
                                <>
                                    Set <Code>SLACK_SIGNING_SECRET</Code> so inbound Events API
                                    deliveries can be verified.
                                </>
                            )
                        }
                    />
                </Card>
            </Section>

            <Section
                title="Slack app setup"
                description="Two things to configure on the Slack side, once per workspace."
            >
                <Card>
                    <ol
                        style={{
                            margin: 0,
                            paddingLeft: 20,
                            fontSize: 13,
                            lineHeight: 1.75,
                            color: "var(--ink-2)",
                        }}
                    >
                        <li>
                            Point <strong>Event Subscriptions</strong> at{" "}
                            <Code>{origin}/api/collab/slack/events</Code>.
                        </li>
                        <li>
                            Subscribe to <Code>message.channels</Code>, plus{" "}
                            <Code>message.groups</Code> for private channels.
                        </li>
                        <li>
                            Invite the bot to the channel, then paste that channel id when starting
                            a meeting.
                        </li>
                    </ol>
                </Card>
            </Section>

            <Section
                title="In-channel controls"
                description="What someone can type in Slack to steer a running meeting. Prefixed with ! rather than / so no extra Slack app configuration is needed."
            >
                <Card padding={0}>
                    <dl style={{ margin: 0 }}>
                        {SLACK_COMMANDS.map(([command, description], index) => (
                            <div
                                key={command}
                                style={{
                                    display: "flex",
                                    gap: 14,
                                    alignItems: "baseline",
                                    flexWrap: "wrap",
                                    padding: "11px 20px",
                                    borderTop: index === 0 ? "none" : "1px solid var(--line)",
                                }}
                            >
                                <dt
                                    className="mono"
                                    style={{
                                        fontSize: 12,
                                        color: "var(--accent-ink)",
                                        minWidth: 168,
                                        flexShrink: 0,
                                    }}
                                >
                                    {command}
                                </dt>
                                <dd
                                    style={{
                                        margin: 0,
                                        fontSize: 12.5,
                                        color: "var(--ink-2)",
                                        lineHeight: 1.55,
                                        flex: 1,
                                    }}
                                >
                                    {description}
                                </dd>
                            </div>
                        ))}
                    </dl>
                </Card>
            </Section>

            <Section
                title="Meeting hub"
                description="The endpoint agent worker machines dial into. Which machines are attached, and how to connect one, lives under Agents & nodes."
            >
                <Card>
                    <StatusRow
                        label="Accept remote agent nodes"
                        ok={data?.network.enabled ?? false}
                        detail={
                            data?.network.enabled ? (
                                <>
                                    Hub <Code>{data.network.hubId}</Code> is listening at{" "}
                                    <Code>{origin}/api/collab/hub</Code>.
                                </>
                            ) : (
                                <>
                                    Set <Code>COLLAB_HUB_SECRET</Code> to let worker machines
                                    register. Without it, every agent runs in this process.
                                </>
                            )
                        }
                    />
                </Card>
            </Section>
        </>
    );
}
