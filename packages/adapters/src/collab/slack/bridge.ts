/**
 * Two-way Slack bridge for a meeting channel.
 *
 * Outbound: every message appended to the channel is mirrored into Slack.
 * Inbound: Slack message events from humans are appended back into the same
 * channel, so a person can steer a meeting from their phone without opening
 * the product.
 *
 * The loop guard is the important part. A mirrored message comes back to us
 * through the Events API; if we appended it again the channel would double
 * every turn. Two independent defences: Slack's own `bot_id` on our posts, and
 * a set of `ts` values we know we produced.
 */

import type { MeetingOrchestrator } from "../meeting";
import type { ChannelStore } from "../store";
import type { ChannelMessage } from "../types";
import type { SlackClient } from "./client";

export interface SlackEventMessage {
  type: string;
  channel?: string;
  user?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  bot_id?: string;
  subtype?: string;
}

export interface SlackEventEnvelope {
  /** `url_verification`, `event_callback`, or any newer type Slack adds. */
  type: string;
  challenge?: string;
  team_id?: string;
  event?: SlackEventMessage;
}

/**
 * Commands a human can type in Slack to drive the meeting. Deliberately
 * `!`-prefixed rather than slash commands so the bridge needs no extra Slack
 * app configuration to work.
 */
export const SLACK_COMMANDS = {
  takeover: "!takeover",
  release: "!release",
  pause: "!pause",
  resume: "!resume",
  run: "!run",
  end: "!end",
  help: "!help",
} as const;

export const SLACK_COMMAND_HELP = [
  "*Meeting controls*",
  "`!takeover [@persona]` — pause the agents and take the floor (optionally occupy an agent's seat)",
  "`!release` — hand control back to the agents",
  "`!pause` / `!resume` — stop or restart agent turns",
  "`!run [n]` — let the agents take up to n more turns",
  "`!end` — close the meeting and produce minutes",
].join("\n");

export interface SlackBridgeOptions {
  slack: SlackClient;
  store: ChannelStore;
  /** Internal channel id. */
  channelId: string;
  /** Slack channel id (`C…`). */
  slackChannelId: string;
  /** Meeting this channel hosts, when the bridge should accept commands. */
  meeting?: MeetingOrchestrator;
  /** Post agent turns under the agent's own display name. */
  useAgentIdentity?: boolean;
  /** Map a Slack user id to a workspace display name. */
  resolveDisplayName?: (slackUserId: string) => Promise<string> | string;
  onError?: (error: Error, phase: "outbound" | "inbound") => void;
}

export class SlackChannelBridge {
  /** `ts` values this bridge produced — never re-ingested. */
  private readonly ownTimestamps = new Set<string>();
  /** Slack `ts` values already ingested — guards Slack's at-least-once delivery. */
  private readonly ingested = new Set<string>();
  private unsubscribe: (() => void) | null = null;
  private pendingOutbound: Promise<void> = Promise.resolve();

  constructor(private readonly options: SlackBridgeOptions) {}

  /** Begins mirroring new channel messages into Slack. */
  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.options.store.subscribe(this.options.channelId, (message) => {
      // Serialize posts so Slack shows the turns in transcript order.
      this.pendingOutbound = this.pendingOutbound
        .then(() => this.mirrorOutbound(message))
        .catch((err) => {
          this.options.onError?.(err instanceof Error ? err : new Error(String(err)), "outbound");
        });
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Resolves once every queued outbound post has been attempted. */
  async drain(): Promise<void> {
    await this.pendingOutbound;
  }

  // -------------------------------------------------------------------------
  // Outbound: channel → Slack
  // -------------------------------------------------------------------------

  private async mirrorOutbound(message: ChannelMessage): Promise<void> {
    // Messages that arrived *from* Slack already exist there. Record the ts as
    // ingested rather than as one of ours, so a retried delivery is classified
    // as a duplicate instead of being mistaken for our own post.
    if (message.slackTs) {
      this.ingested.add(message.slackTs);
      return;
    }

    const author = message.author;
    const isSystem = message.kind === "system";
    const label = author.onBehalfOfPersonaId
      ? `${author.displayName} (for @${author.onBehalfOfPersonaId})`
      : author.displayName;

    const result = await this.options.slack.postMessage({
      channel: this.options.slackChannelId,
      text: this.options.useAgentIdentity && !isSystem ? message.text : `*${label}*: ${message.text}`,
      username: this.options.useAgentIdentity && !isSystem ? label : undefined,
      iconEmoji: this.options.useAgentIdentity && author.kind === "agent" ? ":robot_face:" : undefined,
      threadTs: message.threadId ? await this.slackTsFor(message.threadId) : undefined,
    });

    if (result.ok && result.ts) {
      this.ownTimestamps.add(result.ts);
    } else if (!result.ok) {
      throw new Error(`Slack rejected the message: ${result.error ?? "unknown error"}`);
    }
  }

  private async slackTsFor(messageId: string): Promise<string | undefined> {
    const root = await this.options.store.getMessage(messageId);
    return root?.slackTs;
  }

  // -------------------------------------------------------------------------
  // Inbound: Slack → channel
  // -------------------------------------------------------------------------

  /**
   * Handles one Events API delivery. Returns what the HTTP layer should reply
   * with (Slack requires the `challenge` echo on URL verification) plus what
   * the bridge did, which the tests assert on.
   */
  async handleEvent(envelope: SlackEventEnvelope): Promise<{
    responseBody: unknown;
    ingested?: ChannelMessage;
    command?: string;
    ignored?: "not_a_message" | "other_channel" | "own_message" | "duplicate" | "empty";
  }> {
    if (envelope.type === "url_verification") {
      return { responseBody: { challenge: envelope.challenge } };
    }

    const event = envelope.event;
    if (!event || event.type !== "message" || event.subtype === "message_changed") {
      return { responseBody: { ok: true }, ignored: "not_a_message" };
    }
    if (event.channel !== this.options.slackChannelId) {
      return { responseBody: { ok: true }, ignored: "other_channel" };
    }
    if (event.bot_id || (event.ts && this.ownTimestamps.has(event.ts))) {
      return { responseBody: { ok: true }, ignored: "own_message" };
    }
    if (event.ts && this.ingested.has(event.ts)) {
      return { responseBody: { ok: true }, ignored: "duplicate" };
    }
    const text = (event.text ?? "").trim();
    if (!text) return { responseBody: { ok: true }, ignored: "empty" };

    if (event.ts) this.ingested.add(event.ts);

    const humanId = event.user ?? "slack-user";
    const displayName = (await this.options.resolveDisplayName?.(humanId)) ?? (await this.lookupName(humanId));

    const command = await this.applyCommand(text, humanId, displayName);
    if (command) {
      return { responseBody: { ok: true }, command };
    }

    const message = await this.appendHuman({ humanId, displayName, text, slackTs: event.ts, threadTs: event.thread_ts });
    return { responseBody: { ok: true }, ingested: message };
  }

  private async lookupName(slackUserId: string): Promise<string> {
    try {
      const profile = await this.options.slack.userInfo(slackUserId);
      return profile?.displayName ?? slackUserId;
    } catch {
      return slackUserId;
    }
  }

  private async appendHuman(input: {
    humanId: string;
    displayName: string;
    text: string;
    slackTs?: string;
    threadTs?: string;
  }): Promise<ChannelMessage> {
    const meeting = this.options.meeting;
    if (meeting) {
      const state = meeting.getState();
      if (state.status !== "completed" && state.status !== "failed") {
        return meeting.postHumanMessage({
          humanId: input.humanId,
          displayName: input.displayName,
          text: input.text,
          slackTs: input.slackTs,
          meta: { source: "slack" },
        });
      }
    }
    return this.options.store.append({
      channelId: this.options.channelId,
      author: { kind: "human", id: input.humanId, displayName: input.displayName },
      text: input.text,
      kind: "chat",
      slackTs: input.slackTs,
      meta: { source: "slack" },
    });
  }

  /** Returns the command name when the text was a control command. */
  private async applyCommand(text: string, humanId: string, displayName: string): Promise<string | null> {
    if (!text.startsWith("!")) return null;
    const [rawCommand, ...args] = text.split(/\s+/);
    const command = rawCommand!.toLowerCase();
    const meeting = this.options.meeting;

    if (command === SLACK_COMMANDS.help) {
      await this.options.slack.postMessage({
        channel: this.options.slackChannelId,
        text: SLACK_COMMAND_HELP,
      });
      return "help";
    }
    if (!meeting) return null;

    switch (command) {
      case SLACK_COMMANDS.takeover: {
        const persona = args[0]?.replace(/^@/, "");
        await meeting.takeOver({
          humanId,
          displayName,
          asPersonaId: persona && persona.length > 0 ? persona : undefined,
        });
        return "takeover";
      }
      case SLACK_COMMANDS.release:
        await meeting.release();
        return "release";
      case SLACK_COMMANDS.pause:
        await meeting.pause();
        return "pause";
      case SLACK_COMMANDS.resume:
        await meeting.resume();
        return "resume";
      case SLACK_COMMANDS.run: {
        const limit = Number(args[0]);
        await meeting.run({ limit: Number.isFinite(limit) && limit > 0 ? limit : undefined });
        return "run";
      }
      case SLACK_COMMANDS.end:
        await meeting.complete(`closed by ${displayName} from Slack`);
        return "end";
      default:
        return null;
    }
  }

  /**
   * Backfills messages posted in Slack while the bridge was down. Returns the
   * messages it appended.
   */
  async backfill(sinceTs?: string): Promise<ChannelMessage[]> {
    const history = await this.options.slack.history(this.options.slackChannelId, sinceTs);
    const appended: ChannelMessage[] = [];
    for (const entry of history) {
      if (entry.bot_id || this.ownTimestamps.has(entry.ts) || this.ingested.has(entry.ts)) continue;
      if (!entry.text?.trim()) continue;
      this.ingested.add(entry.ts);
      const displayName = entry.user ? await this.lookupName(entry.user) : "Slack user";
      appended.push(
        await this.appendHuman({
          humanId: entry.user ?? "slack-user",
          displayName,
          text: entry.text,
          slackTs: entry.ts,
        }),
      );
    }
    return appended;
  }
}
