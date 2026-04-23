"use client";

import { useEffect, useMemo, useState } from "react";
import { IconBolt, IconX } from "./icons";
import {
  DefaultLinkPane,
  DraftPane,
  MarketingPipelinePane,
  NotesPane,
  PredictiveGapsPane,
  RewritePane,
  WorkflowsPane,
} from "./StudioPanes";
import { DEMOTED_FEATURES } from "./types";

export interface StudioDrawerProps {
  open: boolean;
  initialFeatureId?: string | null;
  onClose: () => void;
  /**
   * When `true`, renders as a flex sibling that fills the remaining workspace
   * width (replacing the chat area). When `false` (default), keeps the legacy
   * right-side overlay behavior with its own backdrop.
   */
  inline?: boolean;
}

// Feature ids whose panes need custom UI (not just a link-out).
const CUSTOM_PANE_IDS = new Set([
  "draft",
  "rewrite",
  "notes",
  "audit",
  "workflows",
]);

// The full Studio menu lists the 9 "relocated" features from the prototype,
// plus a "marketing" entry so the pipeline is discoverable from here too.
const MARKETING_FEATURE = {
  id: "marketing",
  label: "Marketing pipeline",
  Icon: DEMOTED_FEATURES.find((f) => f.id === "draft")!.Icon,
  desc: "Multi-channel campaigns from your company knowledge",
  href: "/employer/tools/marketing-pipeline",
};

// Link-out descriptions used by DefaultLinkPane.
const LINK_DETAILS: Record<
  string,
  {
    eyebrow: string;
    title: string;
    body: string;
    bullets: string[];
    ctaLabel: string;
  }
> = {
  analytics: {
    eyebrow: "Analytics",
    title: "Queries, accuracy, gap trends",
    body: "A running view of how the workspace is used — top queries, miss rates, documents that need attention.",
    bullets: [
      "Query volume and hit rate by week",
      "Documents with the most unresolved gaps",
      "Model and provider usage breakdown",
    ],
    ctaLabel: "Open analytics",
  },
  team: {
    eyebrow: "Workspace",
    title: "Invite codes, roles, approvals",
    body: "Manage who can access the workspace. Invite codes, pending approvals, role assignment all live on a dedicated page.",
    bullets: [
      "Generate one-time invite codes (employer / employee)",
      "Approve pending employee signups",
      "Owner / employer / employee role assignment",
    ],
    ctaLabel: "Open employees",
  },
  profile: {
    eyebrow: "Company profile",
    title: "AI-extracted company intel",
    body: "Everything the workspace uses to tailor suggestions: product, audience, voice, and keys. Extracted from your docs; editable at any time.",
    bullets: [
      "Product, stage, audience, voice",
      "API keys + embedding configuration",
      "Override any field manually",
    ],
    ctaLabel: "Open settings",
  },
  deploy: {
    eyebrow: "Self-host / BYOK",
    title: "Vercel, Docker, your own keys",
    body: "Run Launchstack in your own environment with your own API keys. Full deployment guide is in the repo.",
    bullets: [
      "Bring your own OpenAI / Anthropic / Gemini key",
      "Vercel one-click or Docker Compose",
      "Postgres with pgvector for embeddings · optional Neo4j for graph",
    ],
    ctaLabel: "Open BYOK settings",
  },
  marketing: {
    eyebrow: "Marketing",
    title: "Multi-channel campaigns",
    body: "Generate platform-tuned drafts across LinkedIn, X, blog, and email from a single campaign prompt.",
    bullets: [
      "One prompt, multiple channels",
      "Voice matched to your pinned sources",
      "Approve or regenerate per channel",
    ],
    ctaLabel: "Open pipeline",
  },
};

export function StudioDrawer({
  open,
  initialFeatureId,
  onClose,
  inline = false,
}: StudioDrawerProps) {
  const allFeatures = useMemo(
    () => [...DEMOTED_FEATURES, MARKETING_FEATURE],
    [],
  );
  const [activeId, setActiveId] = useState<string>(
    initialFeatureId ?? allFeatures[0]!.id,
  );

  useEffect(() => {
    if (open && initialFeatureId) setActiveId(initialFeatureId);
  }, [open, initialFeatureId]);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  const active = useMemo(
    () => allFeatures.find((f) => f.id === activeId) ?? allFeatures[0]!,
    [allFeatures, activeId],
  );

  if (!open) return null;

  let pane: React.ReactNode;
  if (active.id === "draft") pane = <DraftPane onClose={onClose} />;
  else if (active.id === "rewrite") pane = <RewritePane onClose={onClose} />;
  else if (active.id === "notes") pane = <NotesPane onClose={onClose} />;
  else if (active.id === "audit") pane = <PredictiveGapsPane onClose={onClose} />;
  else if (active.id === "workflows") pane = <WorkflowsPane onClose={onClose} />;
  else if (active.id === "marketing") pane = <MarketingPipelinePane onClose={onClose} />;
  else {
    const detail = LINK_DETAILS[active.id];
    pane = detail ? (
      <DefaultLinkPane
        onClose={onClose}
        eyebrow={detail.eyebrow}
        title={detail.title}
        body={detail.body}
        bullets={detail.bullets}
        href={active.href}
        ctaLabel={detail.ctaLabel}
      />
    ) : (
      <DefaultLinkPane
        onClose={onClose}
        eyebrow="Studio"
        title={active.label}
        body={active.desc}
        bullets={[]}
        href={active.href}
        ctaLabel="Open full page"
      />
    );
  }

  const body = (
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: inline
            ? "100%"
            : CUSTOM_PANE_IDS.has(active.id) || active.id === "marketing"
              ? 1280
              : 820,
          maxWidth: inline ? "100%" : "96vw",
          height: "100%",
          flex: inline ? 1 : undefined,
          background: "var(--panel)",
          borderLeft: inline ? "none" : "1px solid var(--line)",
          boxShadow: inline ? "none" : "-24px 0 60px var(--scrim-shadow)",
          display: "flex",
          animation: inline ? "lsw-fadeIn 140ms ease-out" : "lsw-drawerIn 220ms ease-out",
          transition: "width 180ms ease-out",
        }}
      >
        {/* Left rail — feature list */}
        <aside
          style={{
            width: 240,
            flexShrink: 0,
            borderRight: "1px solid var(--line)",
            background: "var(--panel-2)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "14px 14px 10px",
              display: "flex",
              alignItems: "center",
              gap: 9,
            }}
          >
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: 5,
                background: "var(--accent-soft)",
                color: "var(--accent)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <IconBolt size={13} />
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>Studio</div>
          </div>
          <div style={{ padding: "2px 8px 8px", overflowY: "auto", flex: 1 }}>
            {allFeatures.map((f) => {
              const Icon = f.Icon;
              const isActive = f.id === activeId;
              const isCustom = CUSTOM_PANE_IDS.has(f.id) || f.id === "marketing";
              return (
                <button
                  key={f.id}
                  onClick={() => setActiveId(f.id)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    padding: "7px 9px",
                    marginBottom: 1,
                    borderRadius: 6,
                    textAlign: "left",
                    background: isActive ? "var(--accent-soft)" : "transparent",
                    transition: "background 100ms",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.background = "var(--line-2)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 5,
                      background: isActive ? "var(--panel)" : "var(--line-2)",
                      color: isActive ? "var(--accent)" : "var(--ink-2)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={12} />
                  </div>
                  <span
                    style={{
                      flex: 1,
                      fontSize: 12.5,
                      fontWeight: isActive ? 600 : 500,
                      color: isActive ? "var(--accent-ink)" : "var(--ink-2)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {f.label}
                  </span>
                  {isCustom && !isActive && (
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        background: "var(--accent)",
                        flexShrink: 0,
                        opacity: 0.6,
                      }}
                      title="Interactive pane"
                    />
                  )}
                </button>
              );
            })}
          </div>
          <div
            className="mono"
            style={{
              padding: "10px 14px",
              borderTop: "1px solid var(--line)",
              fontSize: 10,
              color: "var(--ink-3)",
              letterSpacing: "0.06em",
              lineHeight: 1.5,
            }}
          >
            <span style={{ color: "var(--accent)" }}>•</span> has an interactive
            pane. Others link out.
          </div>
        </aside>

        {/* Right detail pane */}
        <section
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            position: "relative",
          }}
        >
          <button
            onClick={onClose}
            title="Close Studio"
            style={{
              position: "absolute",
              top: 14,
              right: 16,
              width: 30,
              height: 30,
              borderRadius: 7,
              color: "var(--ink-3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 5,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--line-2)";
              e.currentTarget.style.color = "var(--ink)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--ink-3)";
            }}
          >
            <IconX size={14} />
          </button>
          {pane}
        </section>
      </div>
  );

  if (inline) return body;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        background: "var(--scrim)",
        backdropFilter: "blur(3px)",
        display: "flex",
        justifyContent: "flex-end",
        animation: "lsw-fadeIn 140ms",
      }}
    >
      {body}
    </div>
  );
}
