"use client";

/**
 * Agents & nodes — the roster that meets, and the machines that run it.
 *
 * Body only. The header and the "New agent" button live in the settings
 * chrome, and everything here is built from the shared kit and layout components
 * so it reads as the same screen as Processing and Integrations rather than as
 * a bolted-on panel.
 *
 * The section is the roster managers' screen, but its buttons follow the same
 * rule as the Agents app (`lib/agents/roster-access.ts`) rather than assuming
 * who reached it.
 */

import React, { useCallback, useState } from "react";
import { useTranslations } from "next-intl";

import { Bot, RotateCcw } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, Section } from "~/components/layout/page-shell";
import {
    DEFAULT_AGENT_AUTONOMY,
    effectiveAutonomy,
    isAgentAutonomy,
    type AgentAutonomy,
} from "~/lib/agents/autonomy";
import { disabledTools } from "~/lib/agents/definition";
import { useAgentCopy } from "~/lib/agents/i18n";
import { agentRosterAccess } from "~/lib/agents/roster-access";
import { usePermissions } from "~/lib/use-permissions";
import { WorkspaceAnswerStyleRow } from "../settings/AnswerStyle";
import { usePublishedActions, type SettingsSectionProps } from "../settings/contract";
import { SettingRow } from "../settings/SettingRow";
import { Code, CommandBlock, StatusNote } from "../settings/ui";
import { Trash2 as IconTrash } from "lucide-react";
import { AgentAvatar } from "./AgentAvatar";
import { AgentEditor } from "./AgentEditor";
import { useAgents, useAgo } from "./useMeetings";
import { type AgentPersonaRecord, type WorkerNode } from "./types";

export function AgentsPanel({ onActions }: SettingsSectionProps = {}) {
    const t = useTranslations("collab.agentsPanel");
    const ts = useTranslations("collab.shared");
    const { data, loading, error, refresh } = useAgents();
    const { can } = usePermissions();
    const access = agentRosterAccess(can);
    const [editing, setEditing] = useState<AgentPersonaRecord | "new" | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const personas = data?.personas.filter(p => !p.archived) ?? [];
    const defaultAutonomy: AgentAutonomy = isAgentAutonomy(data?.defaults?.autonomy)
        ? data.defaults.autonomy
        : DEFAULT_AGENT_AUTONOMY;

    usePublishedActions(
        onActions,
        access.manageRoster
            ? {
                  primaryLabel: ts("newAgent"),
                  onPrimary: () => setEditing("new"),
                  disabled: loading && !data,
              }
            : {},
        [loading, data, access.manageRoster, ts]
    );

    const archive = useCallback(
        async (persona: AgentPersonaRecord) => {
            const response = await fetch(`/api/collab/agents/${persona.dbId}`, {
                method: "DELETE",
            });
            if (!response.ok) {
                const body = (await response.json().catch(() => ({}))) as { error?: string };
                setNotice(body.error ?? t("retireFailed"));
                return;
            }
            setNotice(t("retiredNotice", { name: persona.displayName }));
            await refresh();
        },
        [refresh, t]
    );

    const reset = useCallback(
        async (persona: AgentPersonaRecord) => {
            const response = await fetch(`/api/collab/agents/${persona.dbId}/reset`, {
                method: "POST",
            });
            if (!response.ok) {
                const body = (await response.json().catch(() => ({}))) as { error?: string };
                setNotice(body.error ?? t("restoreFailed"));
                return;
            }
            setNotice(ts("restoredNotice", { name: persona.displayName }));
            await refresh();
        },
        [refresh, t, ts]
    );

    return (
        <>
            {notice && <StatusNote tone="ok">{notice}</StatusNote>}
            {error && <StatusNote tone="danger">{error}</StatusNote>}

            <Section title={t("autonomyTitle")} description={t("autonomyDescription")}>
                <Card>
                    <SettingRow settingKey="agents.defaultAutonomy" />
                </Card>
            </Section>

            <Section
                title={t("defaultAssistantTitle")}
                description={t("defaultAssistantDescription")}
            >
                <Card>
                    <WorkspaceAnswerStyleRow />
                </Card>
            </Section>

            <Section title={t("rosterTitle")} description={t("rosterDescription")}>
                <StatusNote tone="muted" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Bot size={14} />
                    <span style={{ flex: 1 }}>
                        {t.rich("tryNote", { b: chunks => <strong>{chunks}</strong> })}
                    </span>
                </StatusNote>
                {loading && personas.length === 0 ? (
                    <StatusNote tone="muted">{ts("loadingAgents")}</StatusNote>
                ) : (
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(272px, 1fr))",
                            gap: 14,
                        }}
                    >
                        {personas.map(persona => (
                            <AgentCard
                                key={persona.dbId}
                                persona={persona}
                                defaultAutonomy={defaultAutonomy}
                                node={data?.nodes.find(n => n.nodeId === persona.nodeId) ?? null}
                                onEdit={access.editContent ? () => setEditing(persona) : undefined}
                                onArchive={
                                    access.manageRoster ? () => void archive(persona) : undefined
                                }
                                onReset={
                                    access.manageRoster && persona.builtin
                                        ? () => void reset(persona)
                                        : undefined
                                }
                            />
                        ))}
                    </div>
                )}
            </Section>

            <NodesSection
                nodes={data?.nodes ?? []}
                network={
                    data?.network ?? { enabled: false, hubId: null, hubPath: "/api/collab/hub" }
                }
                personas={personas}
            />

            <AgentEditor
                open={editing !== null}
                persona={editing === "new" || editing === null ? null : editing}
                contentOnly={!access.manageRoster}
                nodeIds={(data?.nodes ?? []).map(node => node.nodeId)}
                onClose={() => setEditing(null)}
                onSaved={async () => {
                    setEditing(null);
                    await refresh();
                }}
            />
        </>
    );
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

function AgentCard({
    persona,
    defaultAutonomy,
    node,
    onEdit,
    onArchive,
    onReset,
}: {
    persona: AgentPersonaRecord;
    defaultAutonomy: AgentAutonomy;
    node: WorkerNode | null;
    onEdit?: () => void;
    onArchive?: () => void;
    onReset?: () => void;
}) {
    const t = useTranslations("collab.agentsPanel");
    const ts = useTranslations("collab.shared");
    const tc = useTranslations("common");
    const copy = useAgentCopy();
    const autonomy = effectiveAutonomy(persona.autonomy, defaultAutonomy);
    const inheritsAutonomy = !isAgentAutonomy(persona.autonomy);
    const denied = disabledTools(persona.tools);
    return (
        <Card padding={16} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <AgentAvatar agent={persona} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>
                        {persona.displayName}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{persona.role}</div>
                </div>
                <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
                    @{persona.id}
                </span>
            </div>

            <p
                style={{
                    margin: 0,
                    fontSize: 12.5,
                    lineHeight: 1.55,
                    color: "var(--ink-2)",
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                }}
            >
                {persona.description || persona.systemPrompt}
            </p>

            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span
                    title={
                        inheritsAutonomy
                            ? t("inheritsTitle", {
                                  description: copy.autonomyDescription(autonomy),
                              })
                            : copy.autonomyDescription(autonomy)
                    }
                >
                    <Badge variant={autonomy === "full" ? "secondary" : "warn"}>
                        {inheritsAutonomy
                            ? ts("autonomyDefault", { level: copy.autonomyLabel(autonomy) })
                            : copy.autonomyLabel(autonomy)}
                    </Badge>
                </span>
                {persona.mode !== "all" && (
                    <span title={copy.modeDescription(persona.mode)}>
                        <Badge variant="info">{copy.modeLabel(persona.mode)}</Badge>
                    </span>
                )}
                {denied.map(tool => (
                    <span key={tool} title={t("toolOffTitle", { tool: copy.toolLabel(tool) })}>
                        <Badge variant="outline">
                            {t("noTool", { tool: copy.toolLabel(tool).toLowerCase() })}
                        </Badge>
                    </span>
                ))}
                {persona.route && <Badge variant="secondary">{persona.route}</Badge>}
                {persona.nodeId ? (
                    <span
                        title={
                            node?.connected
                                ? t("nodeConnected", { node: persona.nodeId })
                                : t("nodeDisconnected", { node: persona.nodeId })
                        }
                    >
                        <Badge variant={node?.connected ? "success" : "warn"}>
                            {node?.connected
                                ? t("nodeOnline", { node: persona.nodeId })
                                : t("nodeOffline", { node: persona.nodeId })}
                        </Badge>
                    </span>
                ) : (
                    <Badge variant="secondary">{t("runsHere")}</Badge>
                )}
                <div style={{ flex: 1 }} />
                {onEdit && (
                    <Button
                        variant="ghost"
                        onClick={onEdit}
                        className="px-2.5 py-[5px] text-[12px]"
                    >
                        {tc("actions.edit")}
                    </Button>
                )}
                {onReset && (
                    <Button
                        variant="ghost"
                        onClick={onReset}
                        title={ts("restoreShipped")}
                        aria-label={t("restoreAria", { name: persona.displayName })}
                        className="px-2 py-[5px]"
                    >
                        <RotateCcw size={13} />
                    </Button>
                )}
                {onArchive && (
                    <Button
                        variant="ghost"
                        onClick={onArchive}
                        title={t("retireTitle")}
                        aria-label={t("retireAria", { name: persona.displayName })}
                        className="px-2 py-[5px]"
                    >
                        <IconTrash size={13} />
                    </Button>
                )}
            </div>
        </Card>
    );
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

function NodesSection({
    nodes,
    network,
    personas,
}: {
    nodes: WorkerNode[];
    network: { enabled: boolean; hubId: string | null; hubPath: string };
    personas: AgentPersonaRecord[];
}) {
    const t = useTranslations("collab.agentsPanel");
    const ago = useAgo();
    const origin = typeof window === "undefined" ? "https://your-app" : window.location.origin;
    const command = [
        `COLLAB_HUB_URL=${origin}${network.hubPath} \\`,
        `COLLAB_NODE_ID=gpu-box-1 \\`,
        `COLLAB_SECRET=<the value of COLLAB_HUB_SECRET> \\`,
        `COLLAB_PERSONAS=${
            personas
                .map(p => p.id)
                .slice(0, 2)
                .join(",") || "analyst"
        } \\`,
        `LLM_BASE_URL=http://localhost:11434/v1 LLM_MODEL=qwen2.5 \\`,
        `pnpm --filter @launchstack/web collab:worker`,
    ].join("\n");

    return (
        <Section title={t("machinesTitle")} description={t("machinesDescription")}>
            {!network.enabled ? (
                <StatusNote tone="warn">
                    {t.rich("remoteOff", { code: chunks => <Code>{chunks}</Code> })}
                </StatusNote>
            ) : (
                <StatusNote tone="ok">
                    {t.rich("hubAccepting", {
                        hubId: network.hubId ?? "",
                        hubPath: network.hubPath,
                        code: chunks => <Code>{chunks}</Code>,
                    })}
                </StatusNote>
            )}

            {nodes.length > 0 && (
                <Card padding={0} style={{ marginBottom: 14 }}>
                    {nodes.map((node, index) => (
                        <div
                            key={node.nodeId}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 11,
                                padding: "12px 20px",
                                borderTop: index === 0 ? "none" : "1px solid var(--line)",
                            }}
                        >
                            <span
                                style={{
                                    width: 7,
                                    height: 7,
                                    borderRadius: "50%",
                                    background: node.connected
                                        ? "oklch(0.58 0.15 165)"
                                        : "var(--ink-3)",
                                    opacity: node.connected ? 1 : 0.5,
                                    flexShrink: 0,
                                }}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                                    {node.label ?? node.nodeId}
                                </div>
                                <div
                                    className="mono"
                                    style={{ fontSize: 11, color: "var(--ink-3)" }}
                                >
                                    {t("nodeServes", {
                                        node: node.nodeId,
                                        agents:
                                            node.personaIds.length > 0
                                                ? node.personaIds.join(", ")
                                                : t("anyAgent"),
                                    })}
                                </div>
                            </div>
                            <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                                {node.connected
                                    ? t("connected")
                                    : t("lastSeen", {
                                          when: ago(node.lastSeenAt, { seconds: true }),
                                      })}
                            </span>
                        </div>
                    ))}
                </Card>
            )}

            <CommandBlock title={t("connectTitle")} command={command} />
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 10, lineHeight: 1.6 }}>
                {t.rich("nodeNote", { code: chunks => <Code>{chunks}</Code> })}
            </div>
        </Section>
    );
}
