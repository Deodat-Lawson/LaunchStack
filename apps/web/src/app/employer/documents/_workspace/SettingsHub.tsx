"use client";

/**
 * One settings surface.
 *
 * Configuration used to be scattered: processing settings on their own page,
 * company metadata on another, agents nowhere, and integrations only in
 * environment variables. They are all the same job — telling the workspace how
 * to behave — so they are one screen with a section rail, mounted both at
 * `/employer/settings` and inside the workspace as a Studio pane. Each section
 * still renders the component that owns it; nothing was forked to get here.
 */

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";

import LoadingPage from "~/app/_components/loading";
import { IconBuilding, IconRobot, IconServer, IconSettings, IconSlack } from "./icons";
import { AgentsPanel, Callout, SectionHead, codeStyle } from "./collab/AgentsPanel";
import { useAgents } from "./collab/useMeetings";

const SettingsView = dynamic(
  () => import("~/app/employer/settings/SettingsView").then((m) => m.SettingsView),
  { loading: () => <PaneLoading /> },
);

const MetadataView = dynamic(
  () => import("~/app/employer/metadata/MetadataView").then((m) => m.MetadataView),
  { loading: () => <PaneLoading /> },
);

export type SettingsSectionId = "processing" | "agents" | "integrations" | "company";

interface SectionDef {
  id: SettingsSectionId;
  label: string;
  description: string;
  Icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  /** Sections that render their own PageShell manage their own padding. */
  bare?: boolean;
}

const SECTIONS: SectionDef[] = [
  {
    id: "processing",
    label: "Processing",
    description: "Embedding index, API keys, self-hosted endpoints",
    Icon: IconSettings,
    bare: true,
  },
  {
    id: "agents",
    label: "Agents & nodes",
    description: "The roster that meets, and the machines that run it",
    Icon: IconRobot,
  },
  {
    id: "integrations",
    label: "Integrations",
    description: "Slack mirroring and the meeting hub",
    Icon: IconSlack,
  },
  {
    id: "company",
    label: "Company profile",
    description: "AI-extracted industry, people, and markets",
    Icon: IconBuilding,
    bare: true,
  },
];

export interface SettingsHubProps {
  /** Inside the workspace shell rather than as a standalone page. */
  embedded?: boolean;
  initialSection?: SettingsSectionId;
}

export function SettingsHub({ embedded = false, initialSection }: SettingsHubProps) {
  const [section, setSection] = useState<SettingsSectionId>(initialSection ?? "processing");

  // `/employer/settings#byok` used to be a real destination; keep it working
  // rather than silently dropping people on the first section.
  useEffect(() => {
    if (initialSection) return;
    const hash = typeof window === "undefined" ? "" : window.location.hash.replace("#", "");
    if (hash === "byok" || hash === "processing") setSection("processing");
    else if (hash === "agents" || hash === "nodes") setSection("agents");
    else if (hash === "integrations" || hash === "slack") setSection("integrations");
    else if (hash === "company" || hash === "metadata") setSection("company");
  }, [initialSection]);

  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]!;

  return (
    <div
      style={{
        display: "flex",
        height: embedded ? "100%" : "100vh",
        minHeight: 0,
        background: "var(--bg)",
        color: "var(--ink)",
      }}
    >
      <nav
        style={{
          width: 236,
          flexShrink: 0,
          borderRight: "1px solid var(--line)",
          background: "var(--panel)",
          padding: "16px 10px",
          overflowY: "auto",
        }}
      >
        <div
          className="mono"
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--ink-3)",
            padding: "0 8px 10px",
          }}
        >
          Settings
        </div>
        {SECTIONS.map((item) => {
          const isActive = item.id === section;
          return (
            <button
              key={item.id}
              onClick={() => setSection(item.id)}
              style={{
                width: "100%",
                textAlign: "left",
                display: "flex",
                gap: 9,
                alignItems: "flex-start",
                padding: "9px 10px",
                borderRadius: 8,
                marginBottom: 3,
                background: isActive ? "var(--accent-soft)" : "transparent",
                color: isActive ? "var(--accent-ink)" : "var(--ink-2)",
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.background = "var(--line-2)";
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.background = "transparent";
              }}
            >
              <item.Icon size={15} style={{ marginTop: 1, flexShrink: 0, opacity: 0.85 }} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 12.5, fontWeight: isActive ? 600 : 500 }}>
                  {item.label}
                </span>
                <span style={{ display: "block", fontSize: 10.5, color: "var(--ink-3)", marginTop: 1, lineHeight: 1.4 }}>
                  {item.description}
                </span>
              </span>
            </button>
          );
        })}
      </nav>

      <div style={{ flex: 1, minWidth: 0, overflowY: "auto" }}>
        {active.bare ? (
          <SectionBody id={active.id} />
        ) : (
          <div style={{ maxWidth: 900, padding: "26px 28px 60px" }}>
            <SectionBody id={active.id} />
          </div>
        )}
      </div>
    </div>
  );
}

function SectionBody({ id }: { id: SettingsSectionId }) {
  switch (id) {
    case "processing":
      return <SettingsView embedded />;
    case "company":
      return <MetadataView embedded />;
    case "agents":
      return <AgentsPanel />;
    case "integrations":
      return <IntegrationsPanel />;
  }
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

function IntegrationsPanel() {
  const { data, loading } = useAgents();
  const origin = typeof window === "undefined" ? "https://your-app" : window.location.origin;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <section>
        <SectionHead
          title="Slack"
          description="Hold a meeting in a real Slack channel. Agent turns are posted there, and anything a person writes back lands in the same transcript — including the commands that pause the agents or hand a human the floor."
        />

        {loading ? (
          <div style={{ fontSize: 13, color: "var(--ink-3)" }}>Checking Slack configuration…</div>
        ) : (
          <>
            <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
              <StatusRow
                label="Post to Slack"
                ready={data?.slack.canPost ?? false}
                readyDetail="Meeting turns are mirrored into the linked channel."
                missingDetail="Set SLACK_BOT_TOKEN with chat:write on a Slack app installed to your workspace."
              />
              <StatusRow
                label="Receive from Slack"
                ready={data?.slack.canReceive ?? false}
                readyDetail="Messages people write in Slack are added to the meeting."
                missingDetail="Set SLACK_SIGNING_SECRET so inbound Events API deliveries can be verified."
              />
            </div>

            <Callout tone="info">
              Point your Slack app&apos;s <strong>Event Subscriptions</strong> request URL at{" "}
              <code style={codeStyle}>{origin}/api/collab/slack/events</code> and subscribe to{" "}
              <code style={codeStyle}>message.channels</code> (add{" "}
              <code style={codeStyle}>message.groups</code> for private channels). Then paste a
              channel id when you start a meeting.
            </Callout>

            <div
              style={{
                border: "1px solid var(--line)",
                borderRadius: 10,
                background: "var(--panel-2)",
                padding: "12px 14px",
              }}
            >
              <div
                className="mono"
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--ink-3)",
                  marginBottom: 8,
                }}
              >
                In-channel commands
              </div>
              <dl style={{ margin: 0, display: "grid", gap: 7 }}>
                {[
                  ["!takeover [@agent]", "Pause the agents and take the floor, optionally in an agent's seat"],
                  ["!release", "Hand control back to the agents"],
                  ["!pause / !resume", "Stop or restart agent turns"],
                  ["!run 3", "Let the agents take up to three more turns"],
                  ["!end", "Close the meeting and produce minutes"],
                ].map(([command, description]) => (
                  <div key={command} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                    <dt className="mono" style={{ fontSize: 11.5, color: "var(--accent-ink)", minWidth: 150 }}>
                      {command}
                    </dt>
                    <dd style={{ margin: 0, fontSize: 12, color: "var(--ink-2)", lineHeight: 1.5 }}>
                      {description}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </>
        )}
      </section>

      <section>
        <SectionHead
          title="Meeting hub"
          description="The endpoint agent worker machines connect to. Everything about which machines are attached lives under Agents & nodes."
        />
        <div style={{ display: "grid", gap: 10 }}>
          <StatusRow
            label="Accept remote agent nodes"
            ready={data?.network.enabled ?? false}
            readyDetail={`Hub "${data?.network.hubId ?? ""}" is listening at ${origin}/api/collab/hub.`}
            missingDetail="Set COLLAB_HUB_SECRET to let worker machines register. Without it every agent runs in this process."
          />
        </div>
      </section>
    </div>
  );
}

function StatusRow({
  label,
  ready,
  readyDetail,
  missingDetail,
}: {
  label: string;
  ready: boolean;
  readyDetail: string;
  missingDetail: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 11,
        alignItems: "flex-start",
        padding: "11px 13px",
        border: "1px solid var(--line)",
        borderRadius: 9,
        background: "var(--panel-2)",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          marginTop: 5,
          flexShrink: 0,
          background: ready ? "oklch(0.58 0.15 165)" : "oklch(0.72 0.14 60)",
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>{label}</span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "1px 7px",
              borderRadius: 999,
              border: `1px solid ${ready ? "oklch(0.58 0.15 165)" : "oklch(0.75 0.12 60)"}`,
              color: ready ? "oklch(0.45 0.14 165)" : "oklch(0.45 0.13 55)",
            }}
          >
            {ready ? "Ready" : "Not configured"}
          </span>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 3, lineHeight: 1.55 }}>
          {ready ? readyDetail : missingDetail}
        </div>
      </div>
      <IconServer size={14} style={{ color: "var(--ink-3)", opacity: 0.5, flexShrink: 0, marginTop: 2 }} />
    </div>
  );
}

function PaneLoading() {
  return <LoadingPage />;
}
