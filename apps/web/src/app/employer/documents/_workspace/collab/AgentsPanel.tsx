"use client";

/**
 * Agents & nodes — the roster that meets, and the machines that run it.
 *
 * Body only. The header and the "New agent" button live in the settings
 * chrome, and everything here is built from the shared kit and layout components
 * so it reads as the same screen as Processing and Integrations rather than as
 * a bolted-on panel.
 */

import React, { useCallback, useState } from "react";

import { Bot, RotateCcw } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, Section } from "~/components/layout/page-shell";
import {
    AGENT_AUTONOMY_META,
    DEFAULT_AGENT_AUTONOMY,
    effectiveAutonomy,
    isAgentAutonomy,
    type AgentAutonomy,
} from "~/lib/agents/autonomy";
import { AGENT_MODE_META, agentTool, disabledTools } from "~/lib/agents/definition";
import { usePublishedActions, type SettingsSectionProps } from "../settings/contract";
import { SettingRow } from "../settings/SettingRow";
import { Code, CommandBlock, StatusNote } from "../settings/ui";
import { Trash2 as IconTrash } from "lucide-react";
import { AgentAvatar } from "./AgentAvatar";
import { AgentEditor } from "./AgentEditor";
import { useAgents } from "./useMeetings";
import { type AgentPersonaRecord, type WorkerNode } from "./types";

export function AgentsPanel({ onActions }: SettingsSectionProps = {}) {
    const { data, loading, error, refresh } = useAgents();
    const [editing, setEditing] = useState<AgentPersonaRecord | "new" | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const personas = data?.personas.filter(p => !p.archived) ?? [];
    const defaultAutonomy: AgentAutonomy = isAgentAutonomy(data?.defaults?.autonomy)
        ? data.defaults.autonomy
        : DEFAULT_AGENT_AUTONOMY;

    usePublishedActions(
        onActions,
        {
            primaryLabel: "New agent",
            onPrimary: () => setEditing("new"),
            disabled: loading && !data,
        },
        [loading, data]
    );

    const archive = useCallback(
        async (persona: AgentPersonaRecord) => {
            const response = await fetch(`/api/collab/agents/${persona.dbId}`, {
                method: "DELETE",
            });
            if (!response.ok) {
                const body = (await response.json().catch(() => ({}))) as { error?: string };
                setNotice(body.error ?? "Could not retire that agent");
                return;
            }
            setNotice(`${persona.displayName} retired. Past transcripts keep their name.`);
            await refresh();
        },
        [refresh]
    );

    const reset = useCallback(
        async (persona: AgentPersonaRecord) => {
            const response = await fetch(`/api/collab/agents/${persona.dbId}/reset`, {
                method: "POST",
            });
            if (!response.ok) {
                const body = (await response.json().catch(() => ({}))) as { error?: string };
                setNotice(body.error ?? "Could not restore that agent");
                return;
            }
            setNotice(`${persona.displayName} restored to the shipped definition.`);
            await refresh();
        },
        [refresh]
    );

    return (
        <>
            {notice && <StatusNote tone="ok">{notice}</StatusNote>}
            {error && <StatusNote tone="danger">{error}</StatusNote>}

            <Section
                title="Autonomy"
                description="How much an agent may do without a person in the loop. The room's least autonomous agent decides what a meeting may do; the API refuses the rest."
            >
                <Card>
                    <SettingRow settingKey="agents.defaultAutonomy" />
                </Card>
            </Section>

            <Section
                title="The default assistant"
                description="How Launchstack answers in chat when no agent is picked. Each agent carries its own style, so this is the one place a style is a chat setting rather than an agent setting."
            >
                <Card>
                    <SettingRow settingKey="chat.responseStyle" />
                </Card>
            </Section>

            <Section
                title="Roster"
                description="The same agents sit in meetings, answer in chat when picked or @mentioned, and can be tried out on the Agents app. Editing one changes what it does next time — never what it said last time."
            >
                <StatusNote tone="muted" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Bot size={14} />
                    <span style={{ flex: 1 }}>
                        Try an agent before putting it in a room, or import one from a definition
                        file, in <strong>Studio → Agents</strong>.
                    </span>
                </StatusNote>
                {loading && personas.length === 0 ? (
                    <StatusNote tone="muted">Loading agents…</StatusNote>
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
                                onEdit={() => setEditing(persona)}
                                onArchive={() => void archive(persona)}
                                onReset={persona.builtin ? () => void reset(persona) : undefined}
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
    onEdit: () => void;
    onArchive: () => void;
    onReset?: () => void;
}) {
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
                        (inheritsAutonomy ? "Inherits the workspace default. " : "") +
                        AGENT_AUTONOMY_META[autonomy].description
                    }
                >
                    <Badge variant={autonomy === "full" ? "secondary" : "warn"}>
                        {AGENT_AUTONOMY_META[autonomy].label}
                        {inheritsAutonomy ? " · default" : ""}
                    </Badge>
                </span>
                {persona.mode !== "all" && (
                    <span title={AGENT_MODE_META[persona.mode].description}>
                        <Badge variant="info">{AGENT_MODE_META[persona.mode].label}</Badge>
                    </span>
                )}
                {denied.map(tool => (
                    <span key={tool} title={`${agentTool(tool)?.label ?? tool} is switched off`}>
                        <Badge variant="outline">
                            no {(agentTool(tool)?.label ?? tool).toLowerCase()}
                        </Badge>
                    </span>
                ))}
                {persona.route && <Badge variant="secondary">{persona.route}</Badge>}
                {persona.nodeId ? (
                    <span
                        title={
                            node?.connected
                                ? `Node "${persona.nodeId}" is connected`
                                : `Node "${persona.nodeId}" is not connected — turns for this agent will fail until it registers`
                        }
                    >
                        <Badge variant={node?.connected ? "success" : "warn"}>
                            {persona.nodeId} · {node?.connected ? "online" : "offline"}
                        </Badge>
                    </span>
                ) : (
                    <Badge variant="secondary">runs here</Badge>
                )}
                <div style={{ flex: 1 }} />
                <Button
                    variant="ghost"
                    onClick={onEdit}
                    style={{ padding: "5px 10px", fontSize: 12 }}
                >
                    Edit
                </Button>
                {onReset && (
                    <Button
                        variant="ghost"
                        onClick={onReset}
                        title="Restore the shipped definition"
                        aria-label={`Restore ${persona.displayName}`}
                        style={{ padding: "5px 8px" }}
                    >
                        <RotateCcw size={13} />
                    </Button>
                )}
                <Button
                    variant="ghost"
                    onClick={onArchive}
                    title="Retire agent"
                    aria-label={`Retire ${persona.displayName}`}
                    style={{ padding: "5px 8px" }}
                >
                    <IconTrash size={13} />
                </Button>
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
        <Section
            title="Machines"
            description="An agent can run on a different machine from this app. The worker dials in and answers turn requests — all outbound, so it needs no public address of its own."
        >
            {!network.enabled ? (
                <StatusNote tone="warn">
                    Remote agents are off. Set <Code>COLLAB_HUB_SECRET</Code> on this deployment to
                    accept worker machines — until then every agent runs in this process.
                </StatusNote>
            ) : (
                <StatusNote tone="ok">
                    Hub <Code>{network.hubId}</Code> is accepting nodes at{" "}
                    <Code>{network.hubPath}</Code>.
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
                                    {node.nodeId} · serves{" "}
                                    {node.personaIds.length > 0
                                        ? node.personaIds.join(", ")
                                        : "any agent"}
                                </div>
                            </div>
                            <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                                {node.connected
                                    ? "connected"
                                    : `last seen ${relativeTime(node.lastSeenAt)}`}
                            </span>
                        </div>
                    ))}
                </Card>
            )}

            <CommandBlock title="Connect a machine" command={command} />
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 10, lineHeight: 1.6 }}>
                Set an agent&apos;s node id to that <Code>COLLAB_NODE_ID</Code> and its turns are
                produced on that machine, against that machine&apos;s model. Each message records
                the node that served it, so a transcript shows where every turn came from.
            </div>
        </Section>
    );
}

function relativeTime(epochMs: number): string {
    if (!epochMs) return "never";
    const seconds = Math.max(0, Math.round((Date.now() - epochMs) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
    if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
    return `${Math.round(seconds / 86_400)}d ago`;
}
