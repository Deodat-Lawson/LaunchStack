"use client";

/**
 * Integrations — Slack mirroring and the meeting hub.
 *
 * Body only; the header and any action live in the settings chrome. This
 * section is a readout: everything it reports is configured by environment
 * variables, so the useful thing it can do is say precisely what is missing
 * and where to put it.
 */

import React from "react";

import { Card, Section } from "~/app/employer/_components/primitives";
import { useAgents } from "../collab/useMeetings";
import { usePublishedActions, type SettingsSectionProps } from "./contract";
import { Code, StatusNote, StatusRow } from "./ui";

const SLACK_COMMANDS: Array<[string, string]> = [
  ["!takeover [@agent]", "Pause the agents and take the floor, optionally in an agent's seat"],
  ["!release", "Hand control back to the agents"],
  ["!pause / !resume", "Stop or restart agent turns"],
  ["!run 3", "Let the agents take up to three more turns"],
  ["!end", "Close the meeting and produce minutes"],
  ["!help", "Post the command reference into the channel"],
];

export function IntegrationsPanel({ onActions }: SettingsSectionProps) {
  const { data, loading, refresh } = useAgents();
  const origin = typeof window === "undefined" ? "https://your-app" : window.location.origin;

  usePublishedActions(
    onActions,
    {
      primaryLabel: "Recheck",
      primaryBusyLabel: "Checking…",
      onPrimary: refresh,
      busy: loading,
    },
    [refresh, loading],
  );

  if (loading && !data) {
    return <StatusNote tone="muted">Checking configuration…</StatusNote>;
  }

  return (
    <>
      <Section
        title="Slack"
        description="Hold a meeting in a real Slack channel. Agent turns are posted there, and anything a person writes back lands in the same transcript."
      >
        <Card>
          <StatusRow
            label="Post to Slack"
            ok={data?.slack.canPost ?? false}
            detail={
              data?.slack.canPost ? (
                "Meeting turns are mirrored into the linked channel."
              ) : (
                <>
                  Set <Code>SLACK_BOT_TOKEN</Code> with <Code>chat:write</Code> on a Slack app
                  installed to your workspace.
                </>
              )
            }
          />
          <StatusRow
            label="Receive from Slack"
            ok={data?.slack.canReceive ?? false}
            detail={
              data?.slack.canReceive ? (
                "Messages people write in Slack are added to the meeting, including the controls below."
              ) : (
                <>
                  Set <Code>SLACK_SIGNING_SECRET</Code> so inbound Events API deliveries can be
                  verified.
                </>
              )
            }
          />
        </Card>
      </Section>

      <Section
        title="Slack app setup"
        description="Two things to configure on the Slack side, once per workspace."
      >
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
              Point <strong>Event Subscriptions</strong> at{" "}
              <Code>{origin}/api/collab/slack/events</Code>.
            </li>
            <li>
              Subscribe to <Code>message.channels</Code>, plus <Code>message.groups</Code> for
              private channels.
            </li>
            <li>Invite the bot to the channel, then paste that channel id when starting a meeting.</li>
          </ol>
        </Card>
      </Section>

      <Section
        title="In-channel controls"
        description="What someone can type in Slack to steer a running meeting. Prefixed with ! rather than / so no extra Slack app configuration is needed."
      >
        <Card padding={0}>
          <dl style={{ margin: 0 }}>
            {SLACK_COMMANDS.map(([command, description], index) => (
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
                  style={{ fontSize: 12, color: "var(--accent-ink)", minWidth: 168, flexShrink: 0 }}
                >
                  {command}
                </dt>
                <dd style={{ margin: 0, fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55, flex: 1 }}>
                  {description}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      </Section>

      <Section
        title="Meeting hub"
        description="The endpoint agent worker machines dial into. Which machines are attached, and how to connect one, lives under Agents & nodes."
      >
        <Card>
          <StatusRow
            label="Accept remote agent nodes"
            ok={data?.network.enabled ?? false}
            detail={
              data?.network.enabled ? (
                <>
                  Hub <Code>{data.network.hubId}</Code> is listening at{" "}
                  <Code>{origin}/api/collab/hub</Code>.
                </>
              ) : (
                <>
                  Set <Code>COLLAB_HUB_SECRET</Code> to let worker machines register. Without it,
                  every agent runs in this process.
                </>
              )
            }
          />
        </Card>
      </Section>
    </>
  );
}
