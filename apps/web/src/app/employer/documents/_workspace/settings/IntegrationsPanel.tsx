"use client";

/**
 * Integrations — workspace connections, Slack mirroring and the meeting hub.
 *
 * Body only; the header and any action live in the settings chrome. The
 * workspace-connections section is live per-tenant state (connect/disconnect
 * happens in Add source → Connect); the Slack/hub sections below it are a
 * readout of environment-variable configuration.
 */

import React, { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ContextTarget } from "~/components/context-menu";

import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Card, Section } from "~/components/layout/page-shell";
import { useAgents } from "../collab/useMeetings";
import { AssistantOAuthClients } from "./AssistantOAuthClients";
import { usePublishedActions, type SettingsSectionProps } from "./contract";
import { Code, StatusNote, StatusRow } from "./ui";

const PROVIDER_LABELS: Record<string, string> = {
    "google-drive": "Google Drive",
    slack: "Slack",
    github: "GitHub",
    gmail: "Gmail",
    notion: "Notion",
    linkedin: "LinkedIn",
    bluesky: "Bluesky",
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
        /** A per-user connection (Gmail) — the caller's own, never a colleague's. */
        personal?: boolean;
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

interface GoogleConnectionStatus {
    enabled: boolean;
    connected: boolean;
    accountEmail?: string | null;
    connectUrl?: string;
}

/** `<code>` inside a message, drawn as the settings `Code` token. */
const code = (chunks: ReactNode) => <Code>{chunks}</Code>;

function GoogleDriveSection() {
    const t = useTranslations("settings.integrations");
    const tc = useTranslations("common");
    const [status, setStatus] = useState<GoogleConnectionStatus | null>(null);
    const [busy, setBusy] = useState(false);
    /** Whether a Disconnect from the menu is waiting on the confirm dialog. */
    const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

    const refresh = useCallback(async () => {
        try {
            const res = await fetch("/api/connectors/google");
            setStatus(res.ok ? ((await res.json()) as GoogleConnectionStatus) : null);
        } catch {
            setStatus(null);
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const disconnect = useCallback(async () => {
        setBusy(true);
        try {
            await fetch("/api/connectors/google", { method: "DELETE" });
        } finally {
            setBusy(false);
            void refresh();
        }
    }, [refresh]);

    return (
        <Section title="Google Drive" description={t("drive.description")}>
            <ContextTarget
                target={{
                    kind: "drive-connection",
                    label: t("drive.actions"),
                    items: () =>
                        !status?.enabled
                            ? []
                            : [
                                  {
                                      type: "item" as const,
                                      id: "connect",
                                      label: status.connected
                                          ? t("reconnectMenu")
                                          : t("drive.connectMenu"),
                                      icon: "refresh" as const,
                                      onSelect: () => {
                                          window.location.href =
                                              status.connectUrl ??
                                              "/api/connectors/google/oauth/start";
                                      },
                                  },
                                  ...(status.connected
                                      ? [
                                            { type: "separator" as const, id: "sep" },
                                            {
                                                type: "item" as const,
                                                id: "disconnect",
                                                label: t("disconnectMenu"),
                                                icon: "disconnect" as const,
                                                danger: true,
                                                disabled: busy,
                                                onSelect: () => setConfirmingDisconnect(true),
                                            },
                                        ]
                                      : []),
                              ],
                }}
            >
                <Card>
                    {!status ? (
                        <StatusNote tone="muted">{t("checking")}</StatusNote>
                    ) : !status.enabled ? (
                        <StatusRow
                            label={t("drive.linking")}
                            ok={false}
                            detail={t.rich("drive.setup", { code })}
                        />
                    ) : (
                        <>
                            <StatusRow
                                label={t("drive.account")}
                                ok={status.connected}
                                detail={
                                    status.connected
                                        ? t.rich("drive.connectedAs", {
                                              email: status.accountEmail ?? t("drive.unknown"),
                                              code,
                                          })
                                        : t("drive.notConnected")
                                }
                            />
                            <div style={{ display: "flex", gap: 8, paddingTop: 10 }}>
                                <Button
                                    size="sm"
                                    variant={status.connected ? "outline" : "default"}
                                    asChild
                                >
                                    <a
                                        href={
                                            status.connectUrl ??
                                            "/api/connectors/google/oauth/start"
                                        }
                                    >
                                        {status.connected
                                            ? t("drive.reconnect")
                                            : t("drive.connect")}
                                    </a>
                                </Button>
                                {status.connected && (
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => void disconnect()}
                                        disabled={busy}
                                    >
                                        {busy ? t("disconnecting") : tc("actions.disconnect")}
                                    </Button>
                                )}
                            </div>
                        </>
                    )}
                </Card>
            </ContextTarget>
            <ConfirmDialog
                open={confirmingDisconnect}
                onOpenChange={setConfirmingDisconnect}
                title={t("drive.confirmTitle")}
                description={t("drive.confirmBody")}
                confirmLabel={tc("actions.disconnect")}
                onConfirm={() => void disconnect()}
            />
        </Section>
    );
}

/** The commands, and where each is described in `settings.integrations.slackCommands`. */
const SLACK_COMMANDS = [
    ["!takeover [@agent]", "takeover"],
    ["!release", "release"],
    ["!pause / !resume", "pause"],
    ["!run 3", "run"],
    ["!end", "end"],
    ["!help", "help"],
] as const;

/** Which Add-source tab reconnects a provider — the same map the workspace uses. */
const RECONNECT_TAB: Record<string, string> = {
    "google-drive": "drive",
    slack: "slack",
    github: "github",
    notion: "notion",
};

/** Social accounts are connected from Growth › Brand › Accounts, not Add source. */
const BRAND_ACCOUNTS_HREF = "/employer/documents?feature=growth&at=/brand/accounts";

function reconnectHref(provider: string): string | null {
    if (provider === "linkedin" || provider === "bluesky") return BRAND_ACCOUNTS_HREF;
    const tab = RECONNECT_TAB[provider];
    return tab ? `/employer/documents?add=1&tab=${tab}` : null;
}

export function IntegrationsPanel({ onActions }: SettingsSectionProps) {
    const t = useTranslations("settings.integrations");
    const tc = useTranslations("common");
    const router = useRouter();
    const { data, loading, refresh } = useAgents();
    const connectors = useConnectorsOverview();
    const refreshConnectors = connectors.refresh;
    const [disconnecting, setDisconnecting] = useState<string | null>(null);
    /** The connection a Disconnect from its menu has been asked for, pending the confirm dialog. */
    const [pendingDisconnect, setPendingDisconnect] = useState<{
        id: string;
        label: string;
        personal: boolean;
    } | null>(null);
    const origin = typeof window === "undefined" ? "https://your-app" : window.location.origin;

    const refreshAll = useCallback(() => {
        void refresh();
        void refreshConnectors();
    }, [refresh, refreshConnectors]);

    usePublishedActions(
        onActions,
        {
            primaryLabel: t("recheck"),
            primaryBusyLabel: t("rechecking"),
            onPrimary: refreshAll,
            busy: loading || connectors.loading,
        },
        [refreshAll, loading, connectors.loading, t]
    );

    const disconnect = async (connectionId: string, label: string, personal = false) => {
        setDisconnecting(connectionId);
        try {
            // A member's own Gmail row is theirs to remove; the generic route
            // is the management-gated path for workspace connections.
            const res = await fetch(
                personal ? "/api/connectors/gmail" : `/api/connectors/connections/${connectionId}`,
                { method: "DELETE" }
            );
            if (res.ok) {
                toast.success(t("disconnectedToast", { label }));
                await refreshConnectors();
            } else {
                toast.error(t("disconnectFailedToast", { label }));
            }
        } finally {
            setDisconnecting(null);
        }
    };

    if (loading && !data) {
        return <StatusNote tone="muted">{t("checking")}</StatusNote>;
    }

    const configuredProviders = Object.entries(connectors.data?.providers ?? {}).filter(
        ([, value]) => value.configured
    );

    return (
        <>
            <GoogleDriveSection />

            <Section title={t("connections.title")} description={t("connections.description")}>
                <Card>
                    {connectors.loading && !connectors.data ? (
                        <StatusNote tone="muted">{t("connections.checking")}</StatusNote>
                    ) : (connectors.data?.connections.length ?? 0) === 0 ? (
                        <StatusNote tone="muted">
                            {configuredProviders.length > 0
                                ? t("connections.noneAvailable", {
                                      list: configuredProviders
                                          .map(([key]) => PROVIDER_LABELS[key] ?? key)
                                          .join(t("listSeparator")),
                                  })
                                : t.rich("connections.noClients", { code })}
                        </StatusNote>
                    ) : (
                        connectors.data?.connections.map(row => {
                            const label = PROVIDER_LABELS[row.provider] ?? row.provider;
                            const reconnectTo = reconnectHref(row.provider);
                            return (
                                <ContextTarget
                                    key={row.id}
                                    target={{
                                        kind: "connection",
                                        id: row.id,
                                        label: t("connections.actionsFor", { label }),
                                        data: row,
                                        items: () => [
                                            ...(reconnectTo
                                                ? [
                                                      {
                                                          type: "item" as const,
                                                          id: "reconnect",
                                                          label: t("reconnectMenu"),
                                                          icon: "refresh" as const,
                                                          onSelect: () => router.push(reconnectTo),
                                                      },
                                                  ]
                                                : []),
                                            { type: "separator" as const, id: "sep" },
                                            {
                                                type: "item" as const,
                                                id: "disconnect",
                                                label: t("disconnectMenu"),
                                                icon: "disconnect" as const,
                                                danger: true,
                                                disabled: disconnecting === row.id,
                                                onSelect: () =>
                                                    setPendingDisconnect({
                                                        id: row.id,
                                                        label,
                                                        personal: Boolean(row.personal),
                                                    }),
                                            },
                                        ],
                                    }}
                                >
                                    <StatusRow
                                        label={label}
                                        ok={row.status === "active"}
                                        detail={
                                            <>
                                                {row.displayName ?? t("connections.connected")}
                                                {row.personal
                                                    ? ` · ${t("connections.personal")}`
                                                    : row.grantedBy
                                                      ? ` · ${t("connections.connectedBy", { who: row.grantedBy })}`
                                                      : ""}
                                                {row.status !== "active"
                                                    ? ` · ${row.status}${row.statusDetail ? ` — ${row.statusDetail}` : ""}`
                                                    : ""}{" "}
                                                <button
                                                    onClick={() =>
                                                        void disconnect(row.id, label, row.personal)
                                                    }
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
                                                        ? t("removing")
                                                        : tc("actions.disconnect")}
                                                </button>
                                            </>
                                        }
                                    />
                                </ContextTarget>
                            );
                        })
                    )}
                </Card>
                <ConfirmDialog
                    open={pendingDisconnect !== null}
                    onOpenChange={next => {
                        if (!next) setPendingDisconnect(null);
                    }}
                    title={t("connections.confirmTitle", { label: pendingDisconnect?.label ?? "" })}
                    description={t("connections.confirmBody")}
                    confirmLabel={tc("actions.disconnect")}
                    onConfirm={() => {
                        const target = pendingDisconnect;
                        setPendingDisconnect(null);
                        if (target) void disconnect(target.id, target.label, target.personal);
                    }}
                />
            </Section>

            <AssistantOAuthClients />

            <Section title="Slack" description={t("slack.description")}>
                <Card>
                    <StatusRow
                        label={t("slack.post")}
                        ok={data?.slack.canPost ?? false}
                        detail={
                            data?.slack.canPost
                                ? t("slack.postOn")
                                : t.rich("slack.postOff", { code })
                        }
                    />
                    <StatusRow
                        label={t("slack.receive")}
                        ok={data?.slack.canReceive ?? false}
                        detail={
                            data?.slack.canReceive
                                ? t("slack.receiveOn")
                                : t.rich("slack.receiveOff", { code })
                        }
                    />
                </Card>
            </Section>

            <Section title={t("setup.title")} description={t("setup.description")}>
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
                            {t.rich("setup.step1", {
                                url: `${origin}/api/collab/slack/events`,
                                strong: chunks => <strong>{chunks}</strong>,
                                code,
                            })}
                        </li>
                        <li>{t.rich("setup.step2", { code })}</li>
                        <li>{t("setup.step3")}</li>
                    </ol>
                </Card>
            </Section>

            <Section title={t("controls.title")} description={t("controls.description")}>
                <Card padding={0}>
                    <dl style={{ margin: 0 }}>
                        {SLACK_COMMANDS.map(([command, key], index) => (
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
                                    {t(`slackCommands.${key}`)}
                                </dd>
                            </div>
                        ))}
                    </dl>
                </Card>
            </Section>

            <Section title={t("hub.title")} description={t("hub.description")}>
                <Card>
                    <StatusRow
                        label={t("hub.accept")}
                        ok={data?.network.enabled ?? false}
                        detail={
                            data?.network.enabled
                                ? t.rich("hub.listening", {
                                      hubId: data.network.hubId ?? "",
                                      url: `${origin}/api/collab/hub`,
                                      code,
                                  })
                                : t.rich("hub.off", { code })
                        }
                    />
                </Card>
            </Section>
        </>
    );
}
