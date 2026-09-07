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

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, Section } from "~/components/layout/page-shell";
import { Field, SelectInput, TextArea, TextInput } from "~/components/field";
import { usePublishedActions, type SettingsSectionProps } from "../settings/contract";
import { Code, CommandBlock, StatusNote } from "../settings/ui";
import { IconTrash, IconX } from "../icons";
import { useAgents } from "./useMeetings";
import { initialsOf, personaColor, type AgentPersonaRecord, type WorkerNode } from "./types";

const ROUTES = [
    { value: "", label: "Default route" },
    { value: "fast", label: "Fast" },
    { value: "reasoning", label: "Reasoning" },
    { value: "vision", label: "Vision" },
];

export function AgentsPanel({ onActions }: SettingsSectionProps = {}) {
    const { data, loading, error, refresh } = useAgents();
    const [editing, setEditing] = useState<AgentPersonaRecord | "new" | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const personas = data?.personas.filter(p => !p.archived) ?? [];

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

    return (
        <>
            {notice && <StatusNote tone="ok">{notice}</StatusNote>}
            {error && <StatusNote tone="danger">{error}</StatusNote>}

            <Section
                title="Roster"
                description="Agents are copied into a meeting when it starts, so editing one changes who shows up next time — never what was said last time."
            >
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
                                node={data?.nodes.find(n => n.nodeId === persona.nodeId) ?? null}
                                onEdit={() => setEditing(persona)}
                                onArchive={() => void archive(persona)}
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

            {editing && (
                <AgentEditor
                    persona={editing === "new" ? null : editing}
                    nodes={data?.nodes ?? []}
                    onClose={() => setEditing(null)}
                    onSaved={async () => {
                        setEditing(null);
                        await refresh();
                    }}
                />
            )}
        </>
    );
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

function AgentCard({
    persona,
    node,
    onEdit,
    onArchive,
}: {
    persona: AgentPersonaRecord;
    node: WorkerNode | null;
    onEdit: () => void;
    onArchive: () => void;
}) {
    const color = personaColor(persona);
    return (
        <Card padding={16} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <span
                    style={{
                        width: 32,
                        height: 32,
                        borderRadius: 9,
                        background: color,
                        color: "white",
                        fontSize: 11,
                        fontWeight: 700,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                    }}
                >
                    {initialsOf(persona.displayName)}
                </span>
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
                {persona.systemPrompt}
            </p>

            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
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

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function AgentEditor({
    persona,
    nodes,
    onClose,
    onSaved,
}: {
    persona: AgentPersonaRecord | null;
    nodes: WorkerNode[];
    onClose: () => void;
    onSaved: () => Promise<void>;
}) {
    const [key, setKey] = useState(persona?.id ?? "");
    const [displayName, setDisplayName] = useState(persona?.displayName ?? "");
    const [role, setRole] = useState(persona?.role ?? "");
    const [systemPrompt, setSystemPrompt] = useState(persona?.systemPrompt ?? "");
    const [nodeId, setNodeId] = useState(persona?.nodeId ?? "");
    const [route, setRoute] = useState(persona?.route ?? "");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const isNew = persona === null;
    const canSave = Boolean(key.trim() && displayName.trim() && role.trim() && systemPrompt.trim());

    const save = async () => {
        if (!canSave) return;
        setSaving(true);
        setError(null);
        try {
            const response = await fetch(
                isNew ? "/api/collab/agents" : `/api/collab/agents/${persona.dbId}`,
                {
                    method: isNew ? "POST" : "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        key: key.trim(),
                        displayName: displayName.trim(),
                        role: role.trim(),
                        systemPrompt: systemPrompt.trim(),
                        nodeId: nodeId.trim() || null,
                        route: route || null,
                    }),
                }
            );
            if (!response.ok) {
                const payload = (await response.json().catch(() => ({}))) as { error?: string };
                throw new Error(payload.error ?? "Could not save the agent");
            }
            await onSaved();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not save the agent");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label={isNew ? "New agent" : `Edit ${displayName}`}
            onClick={onClose}
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.32)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 60,
                padding: 24,
            }}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    width: "min(620px, 100%)",
                    maxHeight: "88vh",
                    background: "var(--panel)",
                    border: "1px solid var(--line)",
                    borderRadius: 14,
                    boxShadow: "0 24px 60px rgba(0,0,0,0.22)",
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                }}
            >
                <div
                    style={{
                        padding: "16px 20px",
                        borderBottom: "1px solid var(--line)",
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                    }}
                >
                    <h2
                        className="serif"
                        style={{ flex: 1, fontSize: 20, margin: 0, color: "var(--ink)" }}
                    >
                        {isNew ? "New agent" : `Edit ${persona.displayName}`}
                    </h2>
                    <Button
                        variant="ghost"
                        onClick={onClose}
                        aria-label="Close"
                        style={{ padding: 6 }}
                    >
                        <IconX size={16} />
                    </Button>
                </div>

                <div style={{ flex: 1, overflowY: "auto", padding: "20px 20px 8px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                        <Field label="Display name">
                            <TextInput
                                value={displayName}
                                onChange={e => setDisplayName(e.target.value)}
                                placeholder="Dana"
                            />
                        </Field>
                        <Field label="Handle" hint="Written as @handle in transcripts.">
                            <TextInput
                                value={key}
                                onChange={e =>
                                    setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))
                                }
                                placeholder="finance"
                            />
                        </Field>
                    </div>

                    <Field
                        label="Role"
                        hint="One line. Shown in the room and injected into the prompt."
                    >
                        <TextInput
                            value={role}
                            onChange={e => setRole(e.target.value)}
                            placeholder="Finance partner"
                        />
                    </Field>

                    <Field
                        label="Standing instructions"
                        hint="How this agent behaves in every meeting. Be specific about what it owns and what it should refuse to answer."
                    >
                        <TextArea
                            value={systemPrompt}
                            onChange={e => setSystemPrompt(e.target.value)}
                            rows={6}
                        />
                    </Field>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                        <Field
                            label="Model route"
                            hint="Which configured route serves this agent's turns."
                        >
                            <SelectInput
                                value={route ?? ""}
                                onChange={e => setRoute(e.target.value)}
                            >
                                {ROUTES.map(option => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </SelectInput>
                        </Field>
                        <Field label="Runs on node" hint="Leave blank to run in this app process.">
                            <TextInput
                                value={nodeId ?? ""}
                                onChange={e => setNodeId(e.target.value)}
                                list="collab-node-ids"
                                placeholder="gpu-box-1"
                            />
                            <datalist id="collab-node-ids">
                                {nodes.map(node => (
                                    <option key={node.nodeId} value={node.nodeId} />
                                ))}
                            </datalist>
                        </Field>
                    </div>

                    {error && <StatusNote tone="danger">{error}</StatusNote>}
                </div>

                <div
                    style={{
                        padding: "14px 20px",
                        borderTop: "1px solid var(--line)",
                        background: "var(--line-2)",
                        display: "flex",
                        justifyContent: "flex-end",
                        gap: 10,
                    }}
                >
                    <Button variant="ghost" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button onClick={() => void save()} disabled={!canSave || saving}>
                        {saving ? "Saving…" : isNew ? "Create agent" : "Save changes"}
                    </Button>
                </div>
            </div>
        </div>
    );
}
