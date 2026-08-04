#!/usr/bin/env tsx
/**
 * Standalone meeting hub.
 *
 * The Next.js app mounts the same hub at `/api/collab/**`; this binary exists
 * for self-hosted deployments that want the meeting plane on its own host, and
 * for the two-machine integration test, which needs a hub in a process of its
 * own to prove nothing is shared but the socket.
 *
 *   COLLAB_SECRET=... COLLAB_PORT=4100 \
 *   COLLAB_MEETING='{"title":"Q3 pricing","objective":"…","participants":[…]}' \
 *   pnpm --filter @launchstack/web collab:hub
 *
 * The meeting is held in memory: this process is the source of truth for its
 * channel. Production persistence lives in the Next.js mount, which backs the
 * same hub with Postgres.
 */

import {
  createMeeting,
  InMemoryChannelStore,
  MeetingHub,
  ScriptedAgentRuntime,
  startHubServer,
  type AgentPersona,
  type AgentRuntime,
  type TurnPolicy,
} from "@launchstack/core/collab";

interface MeetingSpec {
  title: string;
  objective: string;
  agenda?: string[];
  participants: AgentPersona[];
  maxTurns?: number;
  turnPolicy?: TurnPolicy;
  /** Persona id → lines, for personas this process serves itself. */
  localScript?: Record<string, string[]>;
}

async function main(): Promise<void> {
  const secret = process.env.COLLAB_SECRET;
  if (!secret) throw new Error("COLLAB_SECRET is required");

  const store = new InMemoryChannelStore();
  const hub = new MeetingHub({
    store,
    secret,
    hubId: process.env.COLLAB_HUB_ID ?? "hub",
    turnTimeoutMs: Number(process.env.COLLAB_TURN_TIMEOUT_MS ?? 60_000),
  });

  const server = await startHubServer(hub, {
    port: Number(process.env.COLLAB_PORT ?? 4100),
    host: process.env.COLLAB_HOST ?? "0.0.0.0",
  });

  const spec = process.env.COLLAB_MEETING ? (JSON.parse(process.env.COLLAB_MEETING) as MeetingSpec) : null;
  if (spec) {
    const runtimes: AgentRuntime[] = spec.localScript
      ? [new ScriptedAgentRuntime(spec.localScript)]
      : [];
    const { config, channel } = await createMeeting({
      store,
      workspaceId: process.env.COLLAB_WORKSPACE_ID ?? "local",
      title: spec.title,
      objective: spec.objective,
      agenda: spec.agenda,
      participants: spec.participants,
      runtimes,
      turnPolicy: spec.turnPolicy,
      maxTurns: spec.maxTurns,
      hub,
    });
    // Machine-readable so a supervising process can pick the ids up without
    // guessing or parsing prose.
    console.log(`[collab-hub] meeting ${JSON.stringify({ meetingId: config.id, channelId: channel.id })}`);
  }

  console.log(`[collab-hub] listening ${server.url} (bound ${server.host}:${server.port})`);

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[collab-hub] ${signal} — shutting down`);
    hub.close();
    void server.close().then(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  console.error(`[collab-hub] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
