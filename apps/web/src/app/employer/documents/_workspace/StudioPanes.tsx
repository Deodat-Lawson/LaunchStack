"use client";

import React, { type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { IconChevronRight } from "./icons";
import LoadingPage from "~/app/_components/loading";
import type { StudioFeature } from "./types";

const DocumentGenerator = dynamic(
  () =>
    import("~/app/employer/documents/components/DocumentGenerator").then(
      (m) => m.DocumentGenerator,
    ),
  { loading: () => <LoadingPage /> },
);

const RewriteDiffView = dynamic(
  () =>
    import("~/app/employer/documents/components/RewriteDiffView").then(
      (m) => m.RewriteDiffView,
    ),
  { loading: () => <LoadingPage /> },
);

const LegalGeneratorTheme = dynamic(
  () =>
    import("~/app/employer/documents/components/LegalGeneratorTheme").then(
      (m) => m.LegalGeneratorTheme,
    ),
  { loading: () => <LoadingPage /> },
);

const NotebookPane = dynamic(
  () => import("~/components/notes/NotebookPane").then((m) => m.NotebookPane),
  { loading: () => <LoadingPage /> },
);

const SettingsView = dynamic(
  () =>
    import("~/app/employer/settings/SettingsView").then((m) => m.SettingsView),
  { loading: () => <LoadingPage /> },
);

const StatisticsView = dynamic(
  () =>
    import("~/app/employer/statistics/StatisticsView").then((m) => m.StatisticsView),
  { loading: () => <LoadingPage /> },
);

const MetadataView = dynamic(
  () =>
    import("~/app/employer/metadata/MetadataView").then((m) => m.MetadataView),
  { loading: () => <LoadingPage /> },
);

const MarketingPipelineWorkspace = dynamic(
  () =>
    import(
      "~/app/employer/documents/components/marketing-pipeline/MarketingPipelineWorkspace"
    ).then((m) => m.MarketingPipelineWorkspace),
  { loading: () => <LoadingPage /> },
);

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

function InlineFeatureShell({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  /** One line shown under title (Studio panes where copy helps orientation). */
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          padding: "14px 24px 12px",
          borderBottom: "1px solid var(--line)",
          background: "var(--panel)",
          flexShrink: 0,
        }}
      >
        <div
          className="mono"
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: "var(--ink-3)",
            textTransform: "uppercase",
            marginBottom: 2,
          }}
        >
          {eyebrow}
        </div>
        <h2
          className="serif"
          style={{
            fontSize: 22,
            lineHeight: 1.15,
            letterSpacing: "-0.02em",
            color: "var(--ink)",
            margin: 0,
          }}
        >
          {title}
        </h2>
        {subtitle ? (
          <p
            style={{
              margin: "8px 0 0",
              fontSize: 12.5,
              lineHeight: 1.5,
              color: "var(--ink-3)",
              maxWidth: "min(560px, 100%)",
            }}
          >
            {subtitle}
          </p>
        ) : null}
      </div>
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>{children}</div>
    </div>
  );
}

export function ChatPane(_: PaneProps) {
  return (
    <InlineFeatureShell eyebrow="Workspace" title="Chat">
      <div style={{ padding: "20px 24px", fontSize: 13, lineHeight: 1.6, color: "var(--ink-2)" }}>
        <p style={{ margin: 0 }}>
          Ask grounded questions over your indexed sources. Pick sources on the
          left to scope your questions, or ask globally across the workspace.
        </p>
        <p style={{ marginTop: 12, color: "var(--ink-3)", fontSize: 12 }}>
          Select <strong>Chat</strong> in the sidebar to return to your conversation,
          or close Studio.
        </p>
      </div>
    </InlineFeatureShell>
  );
}

export function DraftPane(_: PaneProps) {
  return (
    <InlineFeatureShell eyebrow="Templated Drafts" title="Draft from a template">
      <DocumentGenerator />
    </InlineFeatureShell>
  );
}

interface ComingSoonPaneProps extends PaneProps {
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
}

/** Reusable "coming soon" pane for Tools features that aren't shipped yet. */
export function ComingSoonPane({ onClose, eyebrow, title, body, bullets }: ComingSoonPaneProps) {
  return (
    <PaneShell
      eyebrow={eyebrow}
      title={`${title} (coming soon)`}
      body={body}
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

export function VideoGenPane({ onClose }: PaneProps) {
  return (
    <ComingSoonPane
      onClose={onClose}
      eyebrow="Generation"
      title="Video Generation"
      body="Turn company knowledge into short explainer videos. Pick sources, set tone, and queue renders — narration and captions are grounded in your indexed documents."
      bullets={[
        "Source-grounded storyboards with citation overlays",
        "Multiple aspect ratios (square, vertical, widescreen)",
        "Optional voice cloning for a consistent brand voice",
      ]}
    />
  );
}

export function ImageGenPane({ onClose }: PaneProps) {
  return (
    <ComingSoonPane
      onClose={onClose}
      eyebrow="Generation"
      title="Image Generation"
      body="Generate hero images, diagrams, and social assets from prompts that reference your sources — product names, audience, and voice pulled from your indexed docs."
      bullets={[
        "Brand-consistent palettes derived from your style guide",
        "Prompt suggestions seeded from pinned sources",
        "Direct export to the library as a new asset",
      ]}
    />
  );
}

export function AudioGenPane({ onClose }: PaneProps) {
  return (
    <ComingSoonPane
      onClose={onClose}
      eyebrow="Generation"
      title="Audio Generation"
      body="Narrate summaries, brief updates, or full documents. Voices, pacing, and tone tuned to your company voice."
      bullets={[
        "Document-to-audio with chapter markers",
        "Multiple voice profiles per workspace",
        "Attach generated audio back to the source document",
      ]}
    />
  );
}

export function RewritePane(_: PaneProps) {
  return (
    <LegalGeneratorTheme ambient={false}>
      <RewriteDiffView />
    </LegalGeneratorTheme>
  );
}

export function NotesPane(_: PaneProps) {
  return (
    <InlineFeatureShell eyebrow="Notebook" title="Cross-document scratchpad">
      <div style={{ padding: 0, height: "100%" }}>
        <NotebookPane />
      </div>
    </InlineFeatureShell>
  );
}

export function CompanyMetadataPane(_: PaneProps) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <MetadataView embedded />
    </div>
  );
}

export function CompanySettingsPane(_: PaneProps) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <SettingsView embedded />
    </div>
  );
}

export function AnalyticsPane(_: PaneProps) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <StatisticsView embedded />
    </div>
  );
}

export function PredictiveGapsPane({ onClose }: PaneProps) {
  const router = useRouter();
  return (
    <InlineFeatureShell
      eyebrow="Predictive gaps"
      title="What's missing from this document"
    >
      <div
        style={{
          padding: "20px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div
          style={{
            fontSize: 13,
            color: "var(--ink-3)",
            lineHeight: 1.55,
          }}
        >
          Runs across a document and flags cross-references pointing to missing
          attachments, numeric inconsistencies, and missing schedules. Pick a
          document from the source rail, then run the analyzer.
        </div>
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
        <button
          onClick={() => {
            router.push("/employer/documents");
            onClose();
          }}
          style={{
            alignSelf: "flex-start",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "9px 16px",
            borderRadius: 8,
            background: "var(--accent)",
            color: "white",
            fontSize: 13,
            fontWeight: 600,
            boxShadow: "0 2px 10px var(--accent-glow)",
          }}
        >
          Back to workspace <IconChevronRight size={12} />
        </button>
      </div>
    </InlineFeatureShell>
  );
}

export function MarketingPipelinePane(_: PaneProps) {
  return (
    <InlineFeatureShell
      eyebrow="Marketing"
      title="Marketing Pipeline"
      subtitle="Pick a channel, describe the promotion — drafts use your indexed company knowledge. Progress and results stay in the bordered area below the form."
    >
      <MarketingPipelineWorkspace embedded />
    </InlineFeatureShell>
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

/**
 * Single-entry pane renderer used by the Studio drawer *and* the main
 * workspace area when a non-chat feature is expanded. `onClose` is the pane's
 * exit path — the drawer passes its own close handler; the main area passes
 * return-to-chat after removing the chrome back control (Studio sidebar Chat handles that too).
 */
export function renderStudioPane(
  feature: StudioFeature,
  onClose: () => void,
): React.ReactNode {
  switch (feature.id) {
    case "chat":
      return <ChatPane onClose={onClose} />;
    case "draft":
      return <DraftPane onClose={onClose} />;
    case "rewrite":
      return <RewritePane onClose={onClose} />;
    case "notes":
      return <NotesPane onClose={onClose} />;
    case "workflows":
      return <WorkflowsPane onClose={onClose} />;
    case "video-gen":
      return <VideoGenPane onClose={onClose} />;
    case "image-gen":
      return <ImageGenPane onClose={onClose} />;
    case "audio-gen":
      return <AudioGenPane onClose={onClose} />;
    case "marketing":
      return <MarketingPipelinePane onClose={onClose} />;
    case "metadata":
      return <CompanyMetadataPane onClose={onClose} />;
    case "settings":
      return <CompanySettingsPane onClose={onClose} />;
    case "analytics":
      return <AnalyticsPane onClose={onClose} />;
    default:
      if (feature.comingSoon) {
        return (
          <ComingSoonPane
            onClose={onClose}
            eyebrow="Studio"
            title={feature.label}
            body={feature.desc}
            bullets={[]}
          />
        );
      }
      return (
        <DefaultLinkPane
          onClose={onClose}
          eyebrow="Studio"
          title={feature.label}
          body={feature.desc}
          bullets={[]}
          href={feature.href ?? "/employer/documents"}
          ctaLabel="Open full page"
        />
      );
  }
}
