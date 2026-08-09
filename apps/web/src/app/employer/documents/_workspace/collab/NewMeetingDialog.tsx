"use client";

/**
 * Start a meeting: objective, agenda, who is in the room, how the floor moves,
 * and whether it mirrors to Slack.
 *
 * The form defaults are chosen so the fastest path — type an objective, press
 * start — produces a sensible meeting. Everything else is progressive detail.
 */

import React, { useEffect, useMemo, useState } from "react";

import { IconHash, IconServer, IconSlack, IconX } from "../icons";
import { useAgents } from "./useMeetings";
import { initialsOf, personaColor, type AgentPersonaRecord } from "./types";

export interface NewMeetingDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (meetingId: string) => void;
}

const TURN_POLICIES = [
  {
    id: "round_robin",
    label: "Round robin",
    desc: "Everyone speaks in turn. Predictable, and no one dominates.",
  },
  {
    id: "moderated",
    label: "Moderated",
    desc: "A chair opens, closes, and hands the floor to whoever they name.",
  },
  {
    id: "reactive",
    label: "Reactive",
    desc: "Whoever was addressed speaks next; otherwise the closest role picks it up.",
  },
] as const;

export function NewMeetingDialog({ open, onClose, onCreated }: NewMeetingDialogProps) {
  const { data, loading } = useAgents();
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [agenda, setAgenda] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [policy, setPolicy] = useState<(typeof TURN_POLICIES)[number]["id"]>("round_robin");
  const [moderator, setModerator] = useState<string>("");
  const [maxTurns, setMaxTurns] = useState(10);
  const [slackChannelId, setSlackChannelId] = useState("");
  const [mirror, setMirror] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const personas = useMemo(() => data?.personas.filter((p) => !p.archived) ?? [], [data]);

  // Pre-select the first three so the picker starts from a working room.
  useEffect(() => {
    if (!open || personas.length === 0 || selected.length > 0) return;
    setSelected(personas.slice(0, 3).map((p) => p.id));
  }, [open, personas, selected.length]);

  useEffect(() => {
    if (policy === "moderated" && !moderator && selected.length > 0) setModerator(selected[0]!);
  }, [policy, moderator, selected]);

  if (!open) return null;

  const canSubmit = title.trim().length > 0 && objective.trim().length > 0 && selected.length > 0;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/collab/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          objective: objective.trim(),
          agenda: agenda
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
          participantKeys: selected,
          turnPolicy: policy,
          moderatorKey: policy === "moderated" ? moderator || undefined : undefined,
          maxTurns,
          slackChannelId: slackChannelId.trim() || undefined,
          slackMirrorEnabled: mirror && slackChannelId.trim().length > 0,
          slackUseAgentIdentity: true,
          autoStart: true,
        }),
      });
      const body = (await response.json()) as {
        meeting?: { id: string };
        error?: string;
      };
      if (!response.ok || !body.meeting) throw new Error(body.error ?? "Could not start the meeting");
      onCreated(body.meeting.id);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the meeting");
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setTitle("");
    setObjective("");
    setAgenda("");
    setSelected([]);
    setPolicy("round_robin");
    setModerator("");
    setMaxTurns(10);
    setSlackChannelId("");
    setMirror(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Start a meeting"
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
          width: "min(720px, 100%)",
          maxHeight: "min(88vh, 900px)",
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
            padding: "16px 20px 14px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div style={{ flex: 1 }}>
            <div
              className="mono"
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--ink-3)",
              }}
            >
              New meeting
            </div>
            <h2 className="serif" style={{ fontSize: 22, margin: "4px 0 0", color: "var(--ink)" }}>
              Open a channel and put the agents in it
            </h2>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ color: "var(--ink-3)" }}>
            <IconX size={16} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "18px 20px 20px" }}>
          <FormField label="Title" hint="Becomes the channel name.">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Q3 pricing review"
              style={inputStyle}
              autoFocus
            />
          </FormField>

          <FormField
            label="Objective"
            hint="What the meeting has to produce. Every agent sees this on every turn."
          >
            <textarea
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              rows={2}
              placeholder="Agree a Q3 price change and name who ships it"
              style={{ ...inputStyle, resize: "vertical", minHeight: 56, fontFamily: "inherit" }}
            />
          </FormField>

          <FormField label="Agenda" hint="One item per line. Optional.">
            <textarea
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
              rows={3}
              placeholder={"Current margin\nProposed change\nOwner and timing"}
              style={{ ...inputStyle, resize: "vertical", minHeight: 66, fontFamily: "inherit" }}
            />
          </FormField>

          <FormField
            label="In the room"
            hint={
              loading
                ? "Loading your agents…"
                : `${selected.length} selected. Manage the roster in Settings → Agents.`
            }
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {personas.map((persona) => (
                <PersonaToggle
                  key={persona.id}
                  persona={persona}
                  selected={selected.includes(persona.id)}
                  onToggle={() =>
                    setSelected((prev) =>
                      prev.includes(persona.id)
                        ? prev.filter((id) => id !== persona.id)
                        : [...prev, persona.id],
                    )
                  }
                />
              ))}
              {!loading && personas.length === 0 && (
                <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                  No agents yet — add one in Settings → Agents.
                </span>
              )}
            </div>
          </FormField>

          <FormField label="How the floor moves">
            <div style={{ display: "grid", gap: 7 }}>
              {TURN_POLICIES.map((option) => (
                <label
                  key={option.id}
                  style={{
                    display: "flex",
                    gap: 9,
                    alignItems: "flex-start",
                    padding: "9px 11px",
                    border: `1px solid ${policy === option.id ? "var(--accent)" : "var(--line)"}`,
                    borderRadius: 9,
                    background: policy === option.id ? "var(--accent-soft)" : "var(--panel-2)",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="turn-policy"
                    checked={policy === option.id}
                    onChange={() => setPolicy(option.id)}
                    style={{ marginTop: 2 }}
                  />
                  <span>
                    <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>
                      {option.label}
                    </span>
                    <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-3)", marginTop: 1 }}>
                      {option.desc}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </FormField>

          {policy === "moderated" && (
            <FormField label="Chair">
              <select
                value={moderator}
                onChange={(e) => setModerator(e.target.value)}
                style={inputStyle}
              >
                {selected.map((key) => {
                  const persona = personas.find((p) => p.id === key);
                  return (
                    <option key={key} value={key}>
                      {persona?.displayName ?? key} (@{key})
                    </option>
                  );
                })}
              </select>
            </FormField>
          )}

          <FormField
            label="Turn limit"
            hint="A hard stop. The meeting also ends early once the objective is met."
          >
            <input
              type="number"
              min={1}
              max={60}
              value={maxTurns}
              onChange={(e) => setMaxTurns(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
              style={{ ...inputStyle, width: 120 }}
            />
          </FormField>

          <FormField
            label="Slack mirror"
            hint={
              data?.slack.canPost
                ? "Turns are posted to this channel, and messages people write there come back here."
                : `Set ${data?.slack.missing.join(" and ") ?? "SLACK_BOT_TOKEN"} to enable mirroring.`
            }
          >
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ color: "var(--ink-3)", display: "flex" }}>
                <IconSlack size={15} />
              </span>
              <input
                value={slackChannelId}
                onChange={(e) => setSlackChannelId(e.target.value)}
                placeholder="C0123456789"
                disabled={!data?.slack.canPost}
                style={{ ...inputStyle, flex: 1 }}
              />
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  color: "var(--ink-2)",
                  whiteSpace: "nowrap",
                }}
              >
                <input
                  type="checkbox"
                  checked={mirror}
                  disabled={!data?.slack.canPost || slackChannelId.trim().length === 0}
                  onChange={(e) => setMirror(e.target.checked)}
                />
                Mirror
              </label>
            </div>
          </FormField>

          {error && (
            <div
              style={{
                marginTop: 4,
                padding: "9px 12px",
                borderRadius: 8,
                fontSize: 12.5,
                color: "var(--danger)",
                background: "oklch(0.97 0.03 25)",
                border: "1px solid oklch(0.9 0.06 25)",
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--line)",
            background: "var(--line-2)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11.5,
              color: "var(--ink-3)",
            }}
          >
            <IconHash size={12} />
            {title.trim() ? slugPreview(title) : "channel-name"}
          </span>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ fontSize: 12.5, color: "var(--ink-2)", fontWeight: 500 }}>
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={!canSubmit || submitting}
            style={{
              padding: "9px 16px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              background: canSubmit ? "var(--accent)" : "var(--line)",
              color: canSubmit ? "white" : "var(--ink-3)",
              cursor: canSubmit && !submitting ? "pointer" : "not-allowed",
              boxShadow: canSubmit ? "0 2px 10px var(--accent-glow)" : "none",
            }}
          >
            {submitting ? "Starting…" : "Start meeting"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PersonaToggle({
  persona,
  selected,
  onToggle,
}: {
  persona: AgentPersonaRecord;
  selected: boolean;
  onToggle: () => void;
}) {
  const color = personaColor(persona);
  return (
    <button
      onClick={onToggle}
      title={`${persona.role}${persona.nodeId ? ` · runs on node ${persona.nodeId}` : ""}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "5px 11px 5px 5px",
        borderRadius: 999,
        border: `1px solid ${selected ? color : "var(--line)"}`,
        background: selected ? "var(--panel-2)" : "transparent",
        color: "var(--ink-2)",
        fontSize: 12,
      }}
    >
      <span
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: selected ? color : "var(--line)",
          color: selected ? "white" : "var(--ink-3)",
          fontSize: 9,
          fontWeight: 700,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {initialsOf(persona.displayName)}
      </span>
      <span style={{ fontWeight: selected ? 600 : 500 }}>{persona.displayName}</span>
      <span style={{ fontSize: 10.5, color: "var(--ink-3)" }}>{persona.role}</span>
      {persona.nodeId && <IconServer size={10} style={{ opacity: 0.6 }} />}
    </button>
  );
}

function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label
        style={{
          display: "block",
          fontSize: 11.5,
          fontWeight: 600,
          color: "var(--ink-2)",
          marginBottom: 5,
        }}
      >
        {label}
      </label>
      {children}
      {hint && (
        <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4, lineHeight: 1.5 }}>{hint}</div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "var(--panel-2)",
  color: "var(--ink)",
  fontSize: 13,
  outline: "none",
};

function slugPreview(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72) || "meeting"
  );
}
