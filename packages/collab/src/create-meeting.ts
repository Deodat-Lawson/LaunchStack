/**
 * One-call assembly of a meeting: channel, orchestrator, optional Slack
 * mirror, optional hub registration.
 *
 * Hosts kept re-deriving the same wiring (create channel → build config →
 * attach runtimes → attach bridge → register with hub) and getting the order
 * subtly wrong, most often by starting the meeting before the Slack bridge was
 * subscribed and losing the kickoff message. This does it in the right order.
 */

import type { AgentRuntime } from "./agent";
import type { Clock, IdFactory } from "./clock";
import { randomIdFactory, systemClock } from "./clock";
import { MeetingOrchestrator } from "./meeting";
import type { MeetingHub } from "./net/hub";
import { SlackChannelBridge } from "./slack/bridge";
import type { SlackClient } from "./slack/client";
import type { ChannelStore } from "./store";
import type { AgentPersona, Channel, MeetingConfig, SlackMirrorConfig, TurnPolicy } from "./types";

export interface CreateMeetingInput {
    store: ChannelStore;
    workspaceId: string;
    title: string;
    objective: string;
    agenda?: string[];
    participants: AgentPersona[];
    runtimes: AgentRuntime[];
    turnPolicy?: TurnPolicy;
    maxTurns?: number;
    context?: string[];
    completionMarker?: string;
    /** Reuse an existing channel instead of creating one. */
    channelId?: string;
    /** Slug for the new channel. Defaults to a slugified title. */
    slug?: string;
    slack?: { client: SlackClient; config: SlackMirrorConfig };
    /** When given, the meeting is registered so remote workers can serve turns. */
    hub?: MeetingHub;
    clock?: Clock;
    newId?: IdFactory;
}

export interface CreatedMeeting {
    channel: Channel;
    config: MeetingConfig;
    orchestrator: MeetingOrchestrator;
    slackBridge: SlackChannelBridge | null;
}

export function slugify(input: string): string {
    const slug = input
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 72);
    return slug || "meeting";
}

export async function createMeeting(input: CreateMeetingInput): Promise<CreatedMeeting> {
    const newId = input.newId ?? randomIdFactory;
    const clock = input.clock ?? systemClock;

    const channel = input.channelId
        ? await requireChannel(input.store, input.channelId)
        : await input.store.createChannel({
              id: newId("chan"),
              slug: await uniqueSlug(
                  input.store,
                  input.workspaceId,
                  input.slug ?? slugify(input.title)
              ),
              name: input.title,
              topic: input.objective,
              workspaceId: input.workspaceId,
              slackChannelId: input.slack?.config.channelId,
          });

    const config: MeetingConfig = {
        id: newId("mtg"),
        channelId: channel.id,
        workspaceId: input.workspaceId,
        title: input.title,
        objective: input.objective,
        agenda: input.agenda ?? [],
        participants: input.participants,
        turnPolicy: input.turnPolicy ?? { kind: "round_robin" },
        maxTurns: input.maxTurns ?? 12,
        completionMarker: input.completionMarker,
        slack: input.slack?.config,
        context: input.context,
    };

    const runtimes = input.hub ? [...input.runtimes, input.hub.remoteRuntime()] : input.runtimes;
    const orchestrator = new MeetingOrchestrator({
        store: input.store,
        config,
        runtimes,
        clock,
    });

    // Subscribe the bridge *before* anything can append, so the kickoff system
    // message is mirrored too.
    let slackBridge: SlackChannelBridge | null = null;
    if (input.slack?.config.enabled) {
        slackBridge = new SlackChannelBridge({
            slack: input.slack.client,
            store: input.store,
            channelId: channel.id,
            slackChannelId: input.slack.config.channelId,
            meeting: orchestrator,
            useAgentIdentity: input.slack.config.useAgentIdentity,
        });
        slackBridge.start();
    }

    input.hub?.registerMeeting(orchestrator);

    return { channel, config, orchestrator, slackBridge };
}

async function requireChannel(store: ChannelStore, channelId: string): Promise<Channel> {
    const channel = await store.getChannel(channelId);
    if (!channel) throw new Error(`Unknown channel ${channelId}`);
    return channel;
}

/** Appends `-2`, `-3`, … until the slug is free, exactly as Slack does. */
async function uniqueSlug(store: ChannelStore, workspaceId: string, base: string): Promise<string> {
    let candidate = base;
    let suffix = 1;
    while (await store.getChannelBySlug(workspaceId, candidate)) {
        suffix++;
        candidate = `${base}-${suffix}`;
    }
    return candidate;
}
