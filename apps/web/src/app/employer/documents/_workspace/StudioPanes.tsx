"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  IconChevronRight,
  IconPlus,
  IconShield,
  IconSparkle,
} from "./icons";

const FORMAT_OPTIONS = ["Email", "Blog post", "LinkedIn post", "X thread", "One-pager"];
const TONE_OPTIONS = ["Warm", "Formal", "Technical", "Punchy", "Analytical"];
const LENGTH_OPTIONS = ["Short (<150w)", "Medium (~300w)", "Long (~800w)"];

const REWRITE_INTENTS = [
  "Punchier · half the length",
  "Plainer English",
  "Active voice",
  "Cut hedges",
  "More formal",
  "Match our blog voice",
];

interface PaneProps {
  onClose: () => void;
}

function PaneShell({
  eyebrow,
  title,
  body,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  body?: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
        <div
          className="mono"
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: "var(--ink-3)",
            textTransform: "uppercase",
            marginBottom: 6,
          }}
        >
          {eyebrow}
        </div>
        <h2
          className="serif"
          style={{
            fontSize: 28,
            lineHeight: 1.15,
            letterSpacing: "-0.02em",
            color: "var(--ink)",
            margin: "0 0 10px",
          }}
        >
          {title}
        </h2>
        {body && (
          <div
            style={{
              fontSize: 13,
              lineHeight: 1.6,
              color: "var(--ink-3)",
              marginBottom: 22,
            }}
          >
            {body}
          </div>
        )}
        {children}
      </div>
      <div
        style={{
          padding: "14px 24px",
          borderTop: "1px solid var(--line)",
          background: "var(--line-2)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        {footer}
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <div
      className="mono"
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.08em",
        color: "var(--ink-3)",
        textTransform: "uppercase",
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 11px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: active ? 600 : 500,
        border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
        background: active ? "var(--accent-soft)" : "var(--panel)",
        color: active ? "var(--accent-ink)" : "var(--ink-2)",
        transition: "background 120ms, border-color 120ms, color 120ms",
      }}
    >
      {children}
    </button>
  );
}

function PrimaryCTA({
  onClick,
  children,
  disabled,
}: {
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "9px 16px",
        borderRadius: 8,
        background: disabled ? "var(--line)" : "var(--accent)",
        color: disabled ? "var(--ink-3)" : "white",
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        boxShadow: disabled ? "none" : "0 2px 10px var(--accent-glow)",
      }}
    >
      {children}
    </button>
  );
}

function SecondaryLink({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 12,
        fontWeight: 500,
        color: "var(--ink-2)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = "var(--accent)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--ink-2)";
      }}
    >
      {children}
    </button>
  );
}

export function DraftPane({ onClose }: PaneProps) {
  const router = useRouter();
  const [prompt, setPrompt] = useState(
    "A cold email to launch partners, warm, ~120 words, CTA = 15 min chat.",
  );
  const [format, setFormat] = useState(FORMAT_OPTIONS[0]!);
  const [tone, setTone] = useState(TONE_OPTIONS[0]!);
  const [length, setLength] = useState(LENGTH_OPTIONS[1]!);

  const open = () => {
    const params = new URLSearchParams();
    params.set("view", "generator");
    if (prompt.trim()) params.set("prompt", prompt.trim());
    if (format) params.set("format", format);
    if (tone) params.set("tone", tone);
    if (length) params.set("length", length);
    router.push(`/employer/documents?${params.toString()}`);
    onClose();
  };

  return (
    <PaneShell
      eyebrow="Compose"
      title="Draft something new"
      body="Pinned sources are passed in as context. The full generator opens with these settings pre-filled."
      footer={
        <>
          <SecondaryLink onClick={onClose}>Cancel</SecondaryLink>
          <div style={{ flex: 1 }} />
          <PrimaryCTA onClick={open}>
            <IconSparkle size={13} />
            Open full generator <IconChevronRight size={12} />
          </PrimaryCTA>
        </>
      }
    >
      <div style={{ marginBottom: 18 }}>
        <FieldLabel>What should I write?</FieldLabel>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: 9,
            border: "1px solid var(--line)",
            background: "var(--panel)",
            fontSize: 14,
            lineHeight: 1.55,
            color: "var(--ink)",
            outline: "none",
            resize: "vertical",
            fontFamily: "inherit",
          }}
        />
      </div>

      <div style={{ marginBottom: 18 }}>
        <FieldLabel>Format</FieldLabel>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {FORMAT_OPTIONS.map((o) => (
            <Chip key={o} active={format === o} onClick={() => setFormat(o)}>
              {o}
            </Chip>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 18,
          marginBottom: 18,
        }}
      >
        <div>
          <FieldLabel>Tone</FieldLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {TONE_OPTIONS.map((o) => (
              <Chip key={o} active={tone === o} onClick={() => setTone(o)}>
                {o}
              </Chip>
            ))}
          </div>
        </div>
        <div>
          <FieldLabel>Length</FieldLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {LENGTH_OPTIONS.map((o) => (
              <Chip key={o} active={length === o} onClick={() => setLength(o)}>
                {o}
              </Chip>
            ))}
          </div>
        </div>
      </div>
    </PaneShell>
  );
}

export function RewritePane({ onClose }: PaneProps) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [intent, setIntent] = useState(REWRITE_INTENTS[0]!);

  const open = () => {
    const params = new URLSearchParams();
    params.set("view", "rewrite");
    if (text.trim()) params.set("text", text.trim().slice(0, 2000));
    if (intent) params.set("intent", intent);
    router.push(`/employer/documents?${params.toString()}`);
    onClose();
  };

  return (
    <PaneShell
      eyebrow="Rewrite"
      title="Improve existing prose"
      body="Paste a draft, pick an intent. We rewrite it using your in-scope sources as style references."
      footer={
        <>
          <SecondaryLink onClick={onClose}>Cancel</SecondaryLink>
          <div style={{ flex: 1 }} />
          <PrimaryCTA onClick={open} disabled={!text.trim()}>
            <IconSparkle size={13} />
            Open rewrite view <IconChevronRight size={12} />
          </PrimaryCTA>
        </>
      }
    >
      <div style={{ marginBottom: 18 }}>
        <FieldLabel>Original</FieldLabel>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste the text you want rewritten…"
          rows={6}
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: 9,
            border: "1px solid var(--line)",
            background: "var(--panel)",
            fontSize: 14,
            lineHeight: 1.55,
            color: "var(--ink)",
            outline: "none",
            resize: "vertical",
            fontFamily: "inherit",
          }}
        />
      </div>

      <div>
        <FieldLabel>What should change?</FieldLabel>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {REWRITE_INTENTS.map((o) => (
            <Chip key={o} active={intent === o} onClick={() => setIntent(o)}>
              {o}
            </Chip>
          ))}
        </div>
      </div>
    </PaneShell>
  );
}

export function NotesPane({ onClose }: PaneProps) {
  const router = useRouter();
  return (
    <PaneShell
      eyebrow="Notes"
      title="Thinking attached to sources"
      body="Pin quick notes next to the source that sparked them. Searchable alongside every other source in your library."
      footer={
        <>
          <SecondaryLink onClick={onClose}>Cancel</SecondaryLink>
          <div style={{ flex: 1 }} />
          <PrimaryCTA
            onClick={() => {
              router.push("/employer/documents?view=notes");
              onClose();
            }}
          >
            <IconPlus size={13} />
            Open notes <IconChevronRight size={12} />
          </PrimaryCTA>
        </>
      }
    >
      <div
        style={{
          padding: 16,
          borderRadius: 10,
          background: "var(--panel-2)",
          border: "1px dashed var(--line)",
          color: "var(--ink-3)",
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        Select a source in the rail, then open its notes from here. Every note
        stays tied to the document it came from, so the context never drifts.
      </div>
    </PaneShell>
  );
}

export function PredictiveGapsPane({ onClose }: PaneProps) {
  const router = useRouter();
  return (
    <PaneShell
      eyebrow="Predictive gaps"
      title="What's missing from this document"
      body="Runs across the active document and flags cross-references that point to attachments that don't exist, numeric inconsistencies, and missing schedules."
      footer={
        <>
          <SecondaryLink onClick={onClose}>Cancel</SecondaryLink>
          <div style={{ flex: 1 }} />
          <PrimaryCTA
            onClick={() => {
              router.push("/employer/documents?view=predictive-analysis");
              onClose();
            }}
          >
            <IconShield size={13} />
            Run on current document <IconChevronRight size={12} />
          </PrimaryCTA>
        </>
      }
    >
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {[
          "Cross-references Schedules, Exhibits, Appendices against the actual corpus",
          "Domain-aware: Contract / Financial / Compliance / Research / HR / Educational",
          "Findings link back to the source span that triggered them",
        ].map((b) => (
          <li
            key={b}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              fontSize: 13,
              color: "var(--ink-2)",
              lineHeight: 1.55,
            }}
          >
            <span
              style={{
                marginTop: 7,
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "var(--accent)",
                flexShrink: 0,
              }}
            />
            {b}
          </li>
        ))}
      </ul>
    </PaneShell>
  );
}

export function MarketingPipelinePane({ onClose }: PaneProps) {
  const router = useRouter();
  const [goal, setGoal] = useState("Launch announcement");
  const GOALS = [
    "Launch announcement",
    "Thought-leadership",
    "Case study",
    "Fundraising update",
    "Hiring pitch",
  ];
  const CHANNELS = [
    { id: "linkedin", label: "LinkedIn post", tone: "Warm · professional" },
    { id: "x", label: "X thread", tone: "Punchy · concise" },
    { id: "blog", label: "Blog post", tone: "Long-form · narrative" },
    { id: "email", label: "Customer email", tone: "Conversational · direct" },
  ];
  return (
    <PaneShell
      eyebrow="Marketing"
      title="Multi-channel campaign"
      body="One prompt, multiple channels. The pipeline generates a platform-tuned draft for each and lets you approve or regenerate per channel."
      footer={
        <>
          <SecondaryLink onClick={onClose}>Cancel</SecondaryLink>
          <div style={{ flex: 1 }} />
          <PrimaryCTA
            onClick={() => {
              const params = new URLSearchParams();
              params.set("goal", goal);
              router.push(`/employer/tools/marketing-pipeline?${params.toString()}`);
              onClose();
            }}
          >
            <IconSparkle size={13} />
            Open pipeline <IconChevronRight size={12} />
          </PrimaryCTA>
        </>
      }
    >
      <div style={{ marginBottom: 20 }}>
        <FieldLabel>Campaign goal</FieldLabel>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {GOALS.map((g) => (
            <Chip key={g} active={goal === g} onClick={() => setGoal(g)}>
              {g}
            </Chip>
          ))}
        </div>
      </div>

      <div>
        <FieldLabel>Channels that will be generated</FieldLabel>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
          }}
        >
          {CHANNELS.map((c) => (
            <div
              key={c.id}
              style={{
                padding: "12px 14px",
                borderRadius: 10,
                border: "1px solid var(--line)",
                background: "var(--panel-2)",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                {c.label}
              </div>
              <div
                className="mono"
                style={{
                  fontSize: 10,
                  color: "var(--ink-3)",
                  marginTop: 2,
                  letterSpacing: "0.03em",
                }}
              >
                {c.tone}
              </div>
            </div>
          ))}
        </div>
      </div>
    </PaneShell>
  );
}

export function WorkflowsPane({ onClose }: PaneProps) {
  return (
    <PaneShell
      eyebrow="Automate"
      title="Workflows (coming soon)"
      body="Chain source-aware steps: 'Every Friday, summarize new customer interviews, draft a Slack update, queue it for review.' Currently in design."
      footer={
        <>
          <SecondaryLink onClick={onClose}>Close</SecondaryLink>
          <div style={{ flex: 1 }} />
          <button
            disabled
            style={{
              fontSize: 13,
              fontWeight: 600,
              padding: "9px 16px",
              borderRadius: 8,
              background: "var(--line)",
              color: "var(--ink-3)",
              cursor: "not-allowed",
            }}
          >
            Coming soon
          </button>
        </>
      }
    >
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {[
          "Scheduled or event-triggered",
          "Composable actions: query, draft, rewrite, export, notify",
          "Dry-run preview before first run",
        ].map((b) => (
          <li
            key={b}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              fontSize: 13,
              color: "var(--ink-2)",
              lineHeight: 1.55,
            }}
          >
            <span
              style={{
                marginTop: 7,
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "var(--accent)",
                flexShrink: 0,
              }}
            />
            {b}
          </li>
        ))}
      </ul>
    </PaneShell>
  );
}

export function DefaultLinkPane({
  onClose,
  eyebrow,
  title,
  body,
  bullets,
  href,
  ctaLabel,
}: PaneProps & {
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
  href: string;
  ctaLabel: string;
}) {
  const router = useRouter();
  return (
    <PaneShell
      eyebrow={eyebrow}
      title={title}
      body={body}
      footer={
        <>
          <SecondaryLink onClick={onClose}>Cancel</SecondaryLink>
          <div style={{ flex: 1 }} />
          <PrimaryCTA
            onClick={() => {
              router.push(href);
              onClose();
            }}
          >
            {ctaLabel} <IconChevronRight size={12} />
          </PrimaryCTA>
        </>
      }
    >
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          marginBottom: 22,
        }}
      >
        {bullets.map((b) => (
          <li
            key={b}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              fontSize: 13,
              color: "var(--ink-2)",
              lineHeight: 1.55,
            }}
          >
            <span
              style={{
                marginTop: 7,
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "var(--accent)",
                flexShrink: 0,
              }}
            />
            {b}
          </li>
        ))}
      </ul>
    </PaneShell>
  );
}
