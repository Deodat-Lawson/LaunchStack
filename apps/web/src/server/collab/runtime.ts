/**
 * Process-wide meeting runtime: the hub, the orchestrator cache, and the
 * persistence that keeps a meeting's state in Postgres between requests.
 *
 * Two facts shape this file.
 *
 * 1. A meeting's *conversation* lives in the channel table, so any request on
 *    any replica can read it. A meeting's *turn cursor* is a row on
 *    `collab_meeting`, written after every state change.
 * 2. The hub's node registry and its in-flight turn requests are inherently
 *    per-process: a remote worker holds a long poll against one server. So the
 *    network feature assumes a single long-lived Node process (Docker, a VM, a
 *    self-hosted node) — not a fan-out of serverless invocations. That is
 *    stated plainly rather than pretended around.
 */

import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import {
  LlmAgentRuntime,
  MeetingHub,
  MeetingOrchestrator,
  SlackChannelBridge,
  slugify,
  type AgentPersona,
  type AgentRuntime,
  type MeetingConfig,
  type MeetingState,
  type SlackClient,
  type TurnPolicy,
} from "@launchstack/core/collab";
import { collabChannel, collabMeeting, collabNode } from "~/server/db/schema";
import { db } from "~/server/db";
import { env } from "~/env";
import { createCollabChatFn } from "./chat";
import { getChannelStore, type PostgresChannelStore } from "./store";
import { getSlackClient } from "./slack";

type MeetingRow = typeof collabMeeting.$inferSelect;

interface CachedMeeting {
  orchestrator: MeetingOrchestrator;
  bridge: SlackChannelBridge | null;
  /** Detaches the persistence listener when the entry is evicted. */
  dispose: () => void;
}

const globalForCollab = globalThis as unknown as {
  __collabHub?: MeetingHub;
  __collabMeetings?: Map<string, CachedMeeting>;
  __collabLocalRuntime?: AgentRuntime;
};

/** Local runtime: serves every persona not routed to a named worker node. */
export function getLocalRuntime(): AgentRuntime {
  globalForCollab.__collabLocalRuntime ??= new LlmAgentRuntime(createCollabChatFn(), {
    nodeId: "local",
  });
  return globalForCollab.__collabLocalRuntime;
}

/**
 * The hub. Returns null when `COLLAB_HUB_SECRET` is unset — refusing to serve
 * remote nodes is the right default for a deployment that has not opted into
 * distributed agents, and a generated-per-boot secret would silently break
 * every worker on restart.
 */
export function getHub(): MeetingHub | null {
  const secret = env.server.COLLAB_HUB_SECRET;
  if (!secret) return null;
  globalForCollab.__collabHub ??= new MeetingHub({
    store: getChannelStore(),
    secret,
    hubId: env.server.COLLAB_HUB_ID ?? "launchstack-hub",
    turnTimeoutMs: 120_000,
    maxPollWaitMs: 25_000,
  });
  return globalForCollab.__collabHub;
}

function meetingCache(): Map<string, CachedMeeting> {
  globalForCollab.__collabMeetings ??= new Map();
  return globalForCollab.__collabMeetings;
}

// ---------------------------------------------------------------------------
// Row ⇄ engine mapping
// ---------------------------------------------------------------------------

export function rowToConfig(row: MeetingRow): MeetingConfig {
  const turnPolicy: TurnPolicy = {
    kind: row.turnPolicy,
    moderatorId: row.moderatorPersonaId ?? undefined,
  };
  return {
    id: row.id,
    channelId: row.channelId,
    workspaceId: String(row.companyId),
    title: row.title,
    objective: row.objective,
    agenda: row.agenda ?? [],
    participants: row.participants as AgentPersona[],
    turnPolicy,
    maxTurns: row.maxTurns,
    completionMarker: row.completionMarker ?? undefined,
    context: row.context ?? undefined,
    slack: row.slackChannelId
      ? {
          channelId: row.slackChannelId,
          enabled: row.slackMirrorEnabled,
          useAgentIdentity: row.slackUseAgentIdentity,
        }
      : undefined,
  };
}

export function rowToState(row: MeetingRow): MeetingState {
  return {
    meetingId: row.id,
    status: row.status,
    turnIndex: row.turnIndex,
    nextSpeakerId: row.nextSpeakerId,
    controller: (row.controller as MeetingState["controller"]) ?? undefined,
    startedAt: row.startedAt?.toISOString(),
    endedAt: row.endedAt?.toISOString(),
    error: row.error ?? undefined,
  };
}

async function persistState(meetingId: string, state: MeetingState): Promise<void> {
  await db
    .update(collabMeeting)
    .set({
      status: state.status,
      turnIndex: state.turnIndex,
      nextSpeakerId: state.nextSpeakerId,
      controller: state.controller ?? null,
      error: state.error ?? null,
      startedAt: state.startedAt ? new Date(state.startedAt) : null,
      endedAt: state.endedAt ? new Date(state.endedAt) : null,
    })
    .where(eq(collabMeeting.id, meetingId));
}

// ---------------------------------------------------------------------------
// Runtime assembly
// ---------------------------------------------------------------------------

function buildRuntimes(): AgentRuntime[] {
  const hub = getHub();
  // Remote first: a persona pinned to a connected worker node must not be
  // silently served by the local model just because the local runtime is
  // willing to take any persona.
  return hub ? [hub.remoteRuntime(), getLocalRuntime()] : [getLocalRuntime()];
}

async function buildBridge(
  config: MeetingConfig,
  orchestrator: MeetingOrchestrator,
  store: PostgresChannelStore,
): Promise<SlackChannelBridge | null> {
  if (!config.slack?.enabled) return null;
  const slack: SlackClient | null = getSlackClient();
  if (!slack) {
    console.warn(`[collab] meeting ${config.id} asks for a Slack mirror but SLACK_BOT_TOKEN is unset`);
    return null;
  }
  const bridge = new SlackChannelBridge({
    slack,
    store,
    channelId: config.channelId,
    slackChannelId: config.slack.channelId,
    meeting: orchestrator,
    useAgentIdentity: config.slack.useAgentIdentity,
    onError: (error, phase) => console.error(`[collab:slack:${phase}] ${error.message}`),
  });
  bridge.start();
  return bridge;
}

/**
 * Loads (or returns the cached) live orchestrator for a meeting.
 *
 * The cache is keyed by meeting id and holds the orchestrator that the hub and
 * the Slack bridge are wired to, so repeated requests drive the same object
 * rather than racing separate copies of the same meeting.
 */
export async function getMeetingRuntime(
  meetingId: string,
  companyId: bigint,
): Promise<{ orchestrator: MeetingOrchestrator; config: MeetingConfig; row: MeetingRow } | null> {
  const [row] = await db
    .select()
    .from(collabMeeting)
    .where(and(eq(collabMeeting.id, meetingId), eq(collabMeeting.companyId, companyId)))
    .limit(1);
  if (!row) return null;

  const config = rowToConfig(row);
  const cached = meetingCache().get(meetingId);
  if (cached) return { orchestrator: cached.orchestrator, config, row };

  const store = getChannelStore();
  const orchestrator = new MeetingOrchestrator({
    store,
    config,
    runtimes: buildRuntimes(),
    initialState: rowToState(row),
  });

  // Chain persists per meeting so states land in event order — concurrent
  // fire-and-forget writes could interleave and persist a stale state last.
  let persistChain: Promise<void> = Promise.resolve();
  const dispose = orchestrator.on((event) => {
    persistChain = persistChain
      .then(() => persistState(meetingId, event.state))
      .catch((err: unknown) => {
        console.error(`[collab] failed to persist meeting ${meetingId}:`, err);
      });
  });

  const bridge = await buildBridge(config, orchestrator, store);
  meetingCache().set(meetingId, {
    orchestrator,
    bridge,
    dispose: () => {
      dispose();
      bridge?.stop();
    },
  });
  getHub()?.registerMeeting(orchestrator);

  return { orchestrator, config, row };
}

/** The live Slack bridge for a meeting, if one is attached in this process. */
export function getMeetingBridge(meetingId: string): SlackChannelBridge | null {
  return meetingCache().get(meetingId)?.bridge ?? null;
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export interface NewMeetingInput {
  companyId: bigint;
  createdByUserId: string;
  title: string;
  objective: string;
  agenda?: string[];
  participants: AgentPersona[];
  turnPolicy?: TurnPolicy;
  maxTurns?: number;
  context?: string[];
  /** Reuse an existing channel instead of opening a new one. */
  channelId?: string;
  slackChannelId?: string;
  slackMirrorEnabled?: boolean;
  slackUseAgentIdentity?: boolean;
}

export async function createMeetingForCompany(input: NewMeetingInput) {
  const store = getChannelStore();
  const workspaceId = String(input.companyId);

  const channelId = input.channelId ?? `chan_${randomUUID().replace(/-/g, "")}`;
  if (!input.channelId) {
    await store.createChannel({
      id: channelId,
      slug: await uniqueChannelSlug(input.companyId, slugify(input.title)),
      name: input.title,
      topic: input.objective,
      workspaceId,
      slackChannelId: input.slackChannelId,
      createdByUserId: input.createdByUserId,
    });
  }

  const meetingId = `mtg_${randomUUID().replace(/-/g, "")}`;
  const [row] = await db
    .insert(collabMeeting)
    .values({
      id: meetingId,
      companyId: input.companyId,
      channelId,
      title: input.title,
      objective: input.objective,
      agenda: input.agenda ?? [],
      participants: input.participants,
      turnPolicy: input.turnPolicy?.kind ?? "round_robin",
      moderatorPersonaId: input.turnPolicy?.moderatorId,
      maxTurns: input.maxTurns ?? 12,
      context: input.context,
      slackChannelId: input.slackChannelId,
      slackMirrorEnabled: input.slackMirrorEnabled ?? false,
      slackUseAgentIdentity: input.slackUseAgentIdentity ?? false,
      createdByUserId: input.createdByUserId,
    })
    .returning();
  if (!row) throw new Error("Failed to create meeting");

  // Load it through the normal path so the hub registration, the Slack bridge,
  // and the persistence listener are attached exactly once.
  const runtime = await getMeetingRuntime(meetingId, input.companyId);
  if (!runtime) throw new Error("Meeting vanished immediately after creation");
  return runtime;
}

async function uniqueChannelSlug(companyId: bigint, base: string): Promise<string> {
  let candidate = base;
  let suffix = 1;
  for (;;) {
    const [existing] = await db
      .select({ id: collabChannel.id })
      .from(collabChannel)
      .where(and(eq(collabChannel.companyId, companyId), eq(collabChannel.slug, candidate)))
      .limit(1);
    if (!existing) return candidate;
    suffix++;
    candidate = `${base}-${suffix}`;
  }
}

// ---------------------------------------------------------------------------
// Node bookkeeping
// ---------------------------------------------------------------------------

export interface KnownNode {
  nodeId: string;
  label?: string;
  personaIds: string[];
  lastSeenAt: number;
  queuedEvents: number;
  connected: boolean;
}

/**
 * Every worker node this workspace has seen: the ones connected right now,
 * plus the ones Postgres remembers.
 *
 * Persisting the registry is what makes the settings page useful after a
 * restart — an agent whose turns are failing because its machine went away
 * should still be visible, with the time it was last heard from, rather than
 * silently disappearing from the list.
 */
export async function listKnownNodes(companyId: bigint): Promise<KnownNode[]> {
  const hub = getHub();
  const live = hub?.listNodes() ?? [];

  for (const node of live) {
    await db
      .insert(collabNode)
      .values({
        id: node.nodeId,
        companyId,
        label: node.label,
        personaIds: node.personaIds,
        lastSeenAt: new Date(node.lastSeenAt),
      })
      .onConflictDoUpdate({
        target: collabNode.id,
        set: {
          label: node.label,
          personaIds: node.personaIds,
          lastSeenAt: new Date(node.lastSeenAt),
        },
      });
  }

  const remembered = await db
    .select()
    .from(collabNode)
    .where(eq(collabNode.companyId, companyId));

  const byId = new Map<string, KnownNode>();
  for (const row of remembered) {
    byId.set(row.id, {
      nodeId: row.id,
      label: row.label ?? undefined,
      personaIds: row.personaIds,
      lastSeenAt: row.lastSeenAt?.getTime() ?? 0,
      queuedEvents: 0,
      connected: false,
    });
  }
  // The live registry wins: it is the only thing that knows what is connected
  // *now* and what is queued for it.
  for (const node of live) byId.set(node.nodeId, node);

  return [...byId.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

export async function listMeetingsForCompany(companyId: bigint, limit = 50) {
  return db
    .select()
    .from(collabMeeting)
    .where(eq(collabMeeting.companyId, companyId))
    .orderBy(desc(collabMeeting.createdAt))
    .limit(limit);
}
