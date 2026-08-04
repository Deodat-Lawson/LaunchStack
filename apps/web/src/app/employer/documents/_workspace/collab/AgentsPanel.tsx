"use client";

/**
 * The agent roster and the machines that serve it.
 *
 * This lives inside Settings rather than as its own top-level destination:
 * defining an agent is configuration, and it belongs next to the models,
 * keys, and integrations it depends on. Running the agents is a different
 * act, and that lives in Meetings.
 */

import React, { useCallback, useState } from "react";

import { IconBroadcast, IconCopy, IconPlus, IconServer, IconTrash, IconX } from "../icons";
import { useAgents } from "./useMeetings";
import { initialsOf, personaColor, type AgentPersonaRecord, type WorkerNode } from "./types";

const ROUTES = [
  { value: "", label: "Default route" },
  { value: "fast", label: "Fast" },
  { value: "reasoning", label: "Reasoning" },
  { value: "vision", label: "Vision" },
];

export function AgentsPanel() {
  const { data, loading, error, refresh } = useAgents();
  const [editing, setEditing] = useState<AgentPersonaRecord | "new" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const personas = data?.personas.filter((p) => !p.archived) ?? [];

  const archive = useCallback(
    async (persona: AgentPersonaRecord) => {
      const response = await fetch(`/api/collab/agents/${persona.dbId}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setNotice(body.error ?? "Could not retire that agent");
        return;
      }
      setNotice(`${persona.displayName} retired. Past transcripts keep their name.`);
      await refresh();
    },
    [refresh],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <section>
        <SectionHead
          title="Agents"
          description="Each agent is a seat in a meeting: a name, a role, and standing instructions. Agents are copied into a meeting when it starts, so editing one never rewrites a transcript."
          action={
            <button onClick={() => setEditing("new")} style={primaryButtonStyle}>
              <IconPlus size={13} /> New agent
            </button>
          }
        />

        {notice && (
          <div
            style={{
              marginBottom: 12,
              padding: "9px 12px",
              borderRadius: 8,
              fontSize: 12.5,
              background: "var(--accent-soft)",
              color: "var(--accent-ink)",
              border: "1px solid var(--accent-glow)",
            }}
          >
            {notice}
          </div>
        )}
        {error && <ErrorNote message={error} />}

        {loading && personas.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--ink-3)" }}>Loading agents…</div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(272px, 1fr))",
              gap: 12,
            }}
          >
            {personas.map((persona) => (
              <AgentCard
                key={persona.dbId}
                persona={persona}
                node={data?.nodes.find((n) => n.nodeId === persona.nodeId) ?? null}
                onEdit={() => setEditing(persona)}
                onArchive={() => void archive(persona)}
              />
            ))}
          </div>
        )}
      </section>

      <NetworkSection
        nodes={data?.nodes ?? []}
        network={data?.network ?? { enabled: false, hubId: null, hubPath: "/api/collab/hub" }}
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
    </div>
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
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 11,
        background: "var(--panel-2)",
        padding: "13px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 9,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
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
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{persona.displayName}</div>
          <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{persona.role}</div>
        </div>
        <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)" }}>
          @{persona.id}
        </span>
      </div>

      <p
        style={{
          margin: 0,
          fontSize: 12,
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
        {persona.route && <MetaTag>{persona.route}</MetaTag>}
        {persona.nodeId ? (
          <span
            title={
              node?.connected
                ? `Node "${persona.nodeId}" is connected`
                : `Node "${persona.nodeId}" is not connected — turns for this agent will fail until it registers`
            }
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 10.5,
              padding: "1px 7px",
              borderRadius: 5,
              border: `1px solid ${node?.connected ? "oklch(0.58 0.15 165)" : "oklch(0.7 0.14 50)"}`,
              color: node?.connected ? "oklch(0.45 0.14 165)" : "oklch(0.45 0.13 55)",
            }}
          >
            <IconServer size={9} />
            {persona.nodeId}
            {node?.connected ? " · online" : " · offline"}
          </span>
        ) : (
          <MetaTag>runs here</MetaTag>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={onEdit} style={subtleButtonStyle}>
          Edit
        </button>
        <button onClick={onArchive} title="Retire agent" style={{ ...subtleButtonStyle, padding: "4px 6px" }}>
          <IconTrash size={12} />
        </button>
      </div>
    </div>
  );
}

function MetaTag({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="mono"
      style={{
        fontSize: 10,
        padding: "1px 6px",
        borderRadius: 5,
        border: "1px solid var(--line)",
        color: "var(--ink-3)",
      }}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

function NetworkSection({
  nodes,
  network,
  personas,
}: {
  nodes: WorkerNode[];
  network: { enabled: boolean; hubId: string | null; hubPath: string };
  personas: AgentPersonaRecord[];
}) {
  const [copied, setCopied] = useState(false);
  const origin = typeof window === "undefined" ? "https://your-app" : window.location.origin;
  const example = [
    `COLLAB_HUB_URL=${origin}${network.hubPath} \\`,
    `COLLAB_NODE_ID=gpu-box-1 \\`,
    `COLLAB_SECRET=<the value of COLLAB_HUB_SECRET> \\`,
    `COLLAB_PERSONAS=${personas.map((p) => p.id).slice(0, 2).join(",") || "analyst"} \\`,
    `LLM_BASE_URL=http://localhost:11434/v1 LLM_MODEL=qwen2.5 \\`,
    `pnpm --filter @launchstack/web collab:worker`,
  ].join("\n");

  return (
    <section>
      <SectionHead
        title="Agent nodes"
        description="An agent can run on a different machine from this app. The worker dials in, registers the agents it serves, and answers turn requests — all outbound, so it needs no public address of its own."
      />

      {!network.enabled ? (
        <Callout tone="warn">
          Remote agents are disabled. Set <code style={codeStyle}>COLLAB_HUB_SECRET</code> on this
          deployment to accept worker nodes — until then, every agent runs in this process.
        </Callout>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            color: "var(--ink-2)",
            marginBottom: 12,
          }}
        >
          <IconBroadcast size={14} style={{ color: "oklch(0.55 0.14 165)" }} />
          Hub <span className="mono">{network.hubId}</span> is accepting nodes at{" "}
          <span className="mono">{network.hubPath}</span>.
        </div>
      )}

      {nodes.length > 0 && (
        <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
          {nodes.map((node) => (
            <div
              key={node.nodeId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                border: "1px solid var(--line)",
                borderRadius: 9,
                background: "var(--panel-2)",
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: node.connected ? "oklch(0.58 0.15 165)" : "var(--ink-4, var(--ink-3))",
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>
                  {node.label ?? node.nodeId}
                </div>
                <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)" }}>
                  {node.nodeId} · serves {node.personaIds.length > 0 ? node.personaIds.join(", ") : "any agent"}
                </div>
              </div>
              <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                {node.connected ? "connected" : "last seen " + relativeTime(node.lastSeenAt)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          border: "1px solid var(--line)",
          borderRadius: 10,
          background: "var(--panel-2)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <span
            className="mono"
            style={{
              flex: 1,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
            }}
          >
            Connect a machine
          </span>
          <button
            onClick={() => {
              void navigator.clipboard?.writeText(example).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              });
            }}
            style={{ ...subtleButtonStyle, display: "inline-flex", alignItems: "center", gap: 5 }}
          >
            <IconCopy size={11} /> {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre
          className="mono"
          style={{
            margin: 0,
            padding: "12px 14px",
            fontSize: 11.5,
            lineHeight: 1.7,
            color: "var(--ink-2)",
            overflowX: "auto",
            whiteSpace: "pre",
          }}
        >
          {example}
        </pre>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 8, lineHeight: 1.6 }}>
        Set an agent&apos;s node id to that <span className="mono">COLLAB_NODE_ID</span> and its turns
        are produced on that machine, against that machine&apos;s model. Turns carry the node that
        served them, so the transcript shows where each message came from.
      </div>
    </section>
  );
}

function relativeTime(epochMs: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - epochMs) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
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
  const canSave = key.trim() && displayName.trim() && role.trim() && systemPrompt.trim();

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const body = {
        key: key.trim(),
        displayName: displayName.trim(),
        role: role.trim(),
        systemPrompt: systemPrompt.trim(),
        nodeId: nodeId.trim() || null,
        route: (route || null) as "fast" | "reasoning" | "vision" | null,
      };
      const response = await fetch(
        isNew ? "/api/collab/agents" : `/api/collab/agents/${persona.dbId}`,
        {
          method: isNew ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
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
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(600px, 100%)",
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
            padding: "15px 18px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <h3 className="serif" style={{ flex: 1, fontSize: 19, margin: 0, color: "var(--ink)" }}>
            {isNew ? "New agent" : `Edit ${persona.displayName}`}
          </h3>
          <button onClick={onClose} aria-label="Close" style={{ color: "var(--ink-3)" }}>
            <IconX size={16} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Labeled label="Display name">
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Dana"
                style={editorInputStyle}
              />
            </Labeled>
            <Labeled label="Handle" hint="Used as @handle in transcripts.">
              <input
                value={key}
                onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                placeholder="finance"
                style={editorInputStyle}
              />
            </Labeled>
          </div>

          <Labeled label="Role" hint="One line. Shown in the room and injected into the prompt.">
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="Finance partner"
              style={editorInputStyle}
            />
          </Labeled>

          <Labeled
            label="Standing instructions"
            hint="How this agent should behave in every meeting. Be specific about what it owns and what it should refuse to answer."
          >
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={6}
              style={{ ...editorInputStyle, resize: "vertical", fontFamily: "inherit", lineHeight: 1.55 }}
            />
          </Labeled>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Labeled label="Model route" hint="Which configured route serves this agent's turns.">
              <select value={route ?? ""} onChange={(e) => setRoute(e.target.value)} style={editorInputStyle}>
                {ROUTES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Labeled>
            <Labeled label="Runs on node" hint="Leave blank to run in this app process.">
              <input
                value={nodeId ?? ""}
                onChange={(e) => setNodeId(e.target.value)}
                list="collab-node-ids"
                placeholder="gpu-box-1"
                style={editorInputStyle}
              />
              <datalist id="collab-node-ids">
                {nodes.map((node) => (
                  <option key={node.nodeId} value={node.nodeId} />
                ))}
              </datalist>
            </Labeled>
          </div>

          {error && <ErrorNote message={error} />}
        </div>

        <div
          style={{
            padding: "12px 18px",
            borderTop: "1px solid var(--line)",
            background: "var(--line-2)",
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
          }}
        >
          <button onClick={onClose} style={{ fontSize: 12.5, color: "var(--ink-2)", fontWeight: 500 }}>
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={!canSave || saving}
            style={{
              ...primaryButtonStyle,
              background: canSave ? "var(--accent)" : "var(--line)",
              color: canSave ? "white" : "var(--ink-3)",
              cursor: canSave && !saving ? "pointer" : "not-allowed",
            }}
          >
            {saving ? "Saving…" : isNew ? "Create agent" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

export function SectionHead({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 14 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 className="serif" style={{ fontSize: 19, margin: 0, color: "var(--ink)" }}>
          {title}
        </h3>
        {description && (
          <p style={{ margin: "5px 0 0", fontSize: 12.5, lineHeight: 1.6, color: "var(--ink-3)", maxWidth: 640 }}>
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

function Labeled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "var(--ink-2)", marginBottom: 5 }}>
        {label}
      </label>
      {children}
      {hint && <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4, lineHeight: 1.5 }}>{hint}</div>}
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div
      style={{
        marginTop: 10,
        padding: "9px 12px",
        borderRadius: 8,
        fontSize: 12.5,
        color: "var(--danger)",
        background: "oklch(0.97 0.03 25)",
        border: "1px solid oklch(0.9 0.06 25)",
      }}
    >
      {message}
    </div>
  );
}

export function Callout({ tone, children }: { tone: "warn" | "info"; children: React.ReactNode }) {
  const warn = tone === "warn";
  return (
    <div
      style={{
        padding: "10px 13px",
        borderRadius: 9,
        fontSize: 12.5,
        lineHeight: 1.6,
        marginBottom: 12,
        background: warn ? "oklch(0.97 0.04 75)" : "var(--panel-2)",
        border: `1px solid ${warn ? "oklch(0.88 0.1 75)" : "var(--line)"}`,
        color: warn ? "oklch(0.42 0.12 60)" : "var(--ink-2)",
      }}
    >
      {children}
    </div>
  );
}

const primaryButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 14px",
  borderRadius: 8,
  background: "var(--accent)",
  color: "white",
  fontSize: 12.5,
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const subtleButtonStyle: React.CSSProperties = {
  padding: "4px 9px",
  borderRadius: 6,
  border: "1px solid var(--line)",
  background: "var(--panel)",
  color: "var(--ink-2)",
  fontSize: 11.5,
  fontWeight: 500,
};

const editorInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "var(--panel-2)",
  color: "var(--ink)",
  fontSize: 13,
  outline: "none",
};

export const codeStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  fontSize: 11.5,
  padding: "1px 5px",
  borderRadius: 4,
  background: "var(--line-2)",
  border: "1px solid var(--line)",
};
