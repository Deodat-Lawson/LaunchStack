/**
 * The meeting hub — the process that owns a channel and hands turns out to
 * agent workers running anywhere else.
 *
 * The hub is a pure request handler (`handle(HubHttpRequest)`), not a server.
 * That separation is what lets the identical hub run behind a Next.js route
 * handler in production and behind a bare `node:http` server in the
 * two-machine integration test, with no branching in between.
 *
 * Workers connect *outbound* and long-poll for work, so a worker behind NAT or
 * on a laptop needs no inbound port — only the hub needs a reachable address.
 */

import type { AgentRuntime, AgentTurnRequest, AgentTurnResult } from "../agent";
import type { Clock, IdFactory } from "../clock";
import { randomIdFactory, systemClock } from "../clock";
import type { MeetingOrchestrator } from "../meeting";
import { buildMinutes } from "../minutes";
import type { ChannelStore } from "../store";
import type { AgentPersona, ChannelMessage } from "../types";
import {
  COLLAB_API_PREFIX,
  COLLAB_PROTOCOL_VERSION,
  errorResponse,
  jsonResponse,
  NonceCache,
  verifyRequest,
  type HubEvent,
  type HubHttpRequest,
  type HubHttpResponse,
  type PollRequest,
  type RegisterRequest,
  type TurnResultRequest,
} from "./protocol";

export interface NodeSnapshot {
  nodeId: string;
  label?: string;
  personaIds: string[];
  lastSeenAt: number;
  queuedEvents: number;
  connected: boolean;
}

export interface MeetingHubOptions {
  store: ChannelStore;
  /** Shared secret every worker must sign with. */
  secret: string;
  hubId?: string;
  clock?: Clock;
  newId?: IdFactory;
  /** How long a remote turn may take before the hub gives up. */
  turnTimeoutMs?: number;
  /** Longest a poll is held open. Workers pass their own, capped by this. */
  maxPollWaitMs?: number;
  /** A node silent for longer than this is reported disconnected. */
  nodeTimeoutMs?: number;
}

interface PendingTurn {
  requestId: string;
  nodeId: string;
  resolve: (result: AgentTurnResult) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface NodeSession {
  nodeId: string;
  label?: string;
  personaIds: Set<string>;
  lastSeenAt: number;
  queue: HubEvent[];
  waiter?: { resolve: (events: HubEvent[]) => void; timer: ReturnType<typeof setTimeout> };
}

export class MeetingHub {
  readonly hubId: string;
  private readonly store: ChannelStore;
  private readonly secret: string;
  private readonly clock: Clock;
  private readonly newId: IdFactory;
  private readonly turnTimeoutMs: number;
  private readonly maxPollWaitMs: number;
  private readonly nodeTimeoutMs: number;
  private readonly nonces = new NonceCache();

  private readonly nodes = new Map<string, NodeSession>();
  private readonly pending = new Map<string, PendingTurn>();
  private readonly meetings = new Map<string, MeetingOrchestrator>();
  private readonly channelUnsubs = new Map<string, () => void>();
  private closed = false;

  constructor(options: MeetingHubOptions) {
    this.store = options.store;
    this.secret = options.secret;
    this.hubId = options.hubId ?? "hub";
    this.clock = options.clock ?? systemClock;
    this.newId = options.newId ?? randomIdFactory;
    this.turnTimeoutMs = options.turnTimeoutMs ?? 60_000;
    this.maxPollWaitMs = options.maxPollWaitMs ?? 25_000;
    this.nodeTimeoutMs = options.nodeTimeoutMs ?? 90_000;
  }

  // -------------------------------------------------------------------------
  // Meeting registration
  // -------------------------------------------------------------------------

  /**
   * Puts a meeting under the hub's control and starts fanning its channel
   * messages out to every connected worker, so a remote agent sees human
   * interjections in real time rather than only when it is asked to speak.
   */
  registerMeeting(orchestrator: MeetingOrchestrator): void {
    this.meetings.set(orchestrator.config.id, orchestrator);
    const channelId = orchestrator.config.channelId;
    if (!this.channelUnsubs.has(channelId)) {
      const unsub = this.store.subscribe(channelId, (message) => {
        this.broadcast({ type: "channel.message", channelId, message });
      });
      this.channelUnsubs.set(channelId, unsub);
    }
    orchestrator.on((event) => {
      this.broadcast({ type: "meeting.state", meetingId: event.meetingId, state: event.state });
    });
  }

  getMeeting(meetingId: string): MeetingOrchestrator | null {
    return this.meetings.get(meetingId) ?? null;
  }

  listNodes(): NodeSnapshot[] {
    const now = this.clock.now();
    return [...this.nodes.values()].map((n) => ({
      nodeId: n.nodeId,
      label: n.label,
      personaIds: [...n.personaIds],
      lastSeenAt: n.lastSeenAt,
      queuedEvents: n.queue.length,
      connected: now - n.lastSeenAt < this.nodeTimeoutMs,
    }));
  }

  /**
   * An `AgentRuntime` the orchestrator can hold that dispatches turns over the
   * wire. From the orchestrator's side a remote agent is indistinguishable
   * from a local one — that is the whole point.
   */
  remoteRuntime(): AgentRuntime {
    return new HubRemoteRuntime(this);
  }

  // -------------------------------------------------------------------------
  // Turn dispatch (used by HubRemoteRuntime)
  // -------------------------------------------------------------------------

  servesRemotely(persona: AgentPersona): boolean {
    const nodeId = persona.nodeId;
    if (!nodeId || nodeId === "local" || nodeId === this.hubId) return false;
    const session = this.nodes.get(nodeId);
    if (!session) return false;
    return session.personaIds.size === 0 || session.personaIds.has(persona.id);
  }

  async dispatchTurn(request: AgentTurnRequest): Promise<AgentTurnResult> {
    const nodeId = request.persona.nodeId;
    if (!nodeId) throw new Error("Persona has no nodeId");
    const session = this.nodes.get(nodeId);
    if (!session) throw new Error(`Node "${nodeId}" is not connected`);

    const requestId = this.newId("turn");
    const deadlineAt = this.clock.now() + this.turnTimeoutMs;

    const promise = new Promise<AgentTurnResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        this.enqueue(nodeId, { type: "turn.cancel", requestId, reason: "timeout" });
        reject(new Error(`Turn timed out after ${this.turnTimeoutMs}ms on node "${nodeId}"`));
      }, this.turnTimeoutMs);
      // Never let a pending turn hold the process open.
      timer.unref?.();
      this.pending.set(requestId, { requestId, nodeId, resolve, reject, timer });
    });

    this.enqueue(nodeId, {
      type: "turn.request",
      requestId,
      meetingId: request.context.meetingId,
      persona: request.persona,
      context: request.context,
      transcript: request.transcript,
      deadlineAt,
    });

    return promise;
  }

  // -------------------------------------------------------------------------
  // Event fan-out
  // -------------------------------------------------------------------------

  private enqueue(nodeId: string, event: HubEvent): void {
    const session = this.nodes.get(nodeId);
    if (!session) return;
    session.queue.push(event);
    this.flush(session);
  }

  private broadcast(event: HubEvent): void {
    for (const session of this.nodes.values()) {
      session.queue.push(event);
      this.flush(session);
    }
  }

  private flush(session: NodeSession): void {
    if (!session.waiter || session.queue.length === 0) return;
    const { resolve, timer } = session.waiter;
    session.waiter = undefined;
    clearTimeout(timer);
    const events = session.queue.splice(0, session.queue.length);
    resolve(events);
  }

  // -------------------------------------------------------------------------
  // HTTP surface
  // -------------------------------------------------------------------------

  async handle(request: HubHttpRequest): Promise<HubHttpResponse> {
    const [rawPath, query = ""] = request.path.split("?");
    const path = normalize(rawPath ?? "");

    if (path === `${COLLAB_API_PREFIX}/health` && request.method === "GET") {
      return jsonResponse(200, {
        ok: true,
        hubId: this.hubId,
        protocolVersion: COLLAB_PROTOCOL_VERSION,
        nodes: this.listNodes(),
        meetings: [...this.meetings.keys()],
      });
    }

    const verified = verifyRequest({
      secret: this.secret,
      method: request.method,
      path: request.path,
      body: request.body,
      headers: request.headers,
      now: this.clock.now(),
      nonces: this.nonces,
    });
    if (!verified.ok) {
      const status = verified.reason === "unsupported_version" ? 426 : 401;
      const code = verified.reason === "unsupported_version" ? "unsupported_version" : "unauthorized";
      return errorResponse(status, code, `Request rejected: ${verified.reason}`);
    }

    try {
      return await this.route(request.method.toUpperCase(), path, query, request.body, verified.nodeId!);
    } catch (err) {
      return errorResponse(500, "internal", err instanceof Error ? err.message : String(err));
    }
  }

  private async route(
    method: string,
    path: string,
    query: string,
    body: string,
    signerNodeId: string,
  ): Promise<HubHttpResponse> {
    const rest = path.startsWith(COLLAB_API_PREFIX) ? path.slice(COLLAB_API_PREFIX.length) : null;
    if (rest === null) return errorResponse(404, "not_found", `Unknown path ${path}`);
    const segments = rest.split("/").filter(Boolean);

    // --- node lifecycle -----------------------------------------------------
    if (method === "POST" && segments[0] === "nodes" && segments[1] === "register") {
      const payload = parse<RegisterRequest>(body);
      if (!payload?.nodeId) return errorResponse(400, "bad_request", "nodeId required");
      if (payload.nodeId !== signerNodeId) {
        return errorResponse(401, "unauthorized", "nodeId does not match the signing node");
      }
      if (payload.protocolVersion && payload.protocolVersion !== COLLAB_PROTOCOL_VERSION) {
        return errorResponse(426, "unsupported_version", `Hub speaks v${COLLAB_PROTOCOL_VERSION}`);
      }
      this.registerNode(payload);
      return jsonResponse(200, {
        ok: true,
        nodeId: payload.nodeId,
        hubId: this.hubId,
        protocolVersion: COLLAB_PROTOCOL_VERSION,
        heartbeatIntervalMs: Math.floor(this.nodeTimeoutMs / 3),
      });
    }

    if (method === "POST" && segments[0] === "nodes" && segments[1] === "poll") {
      const payload = parse<PollRequest>(body);
      if (!payload?.nodeId) return errorResponse(400, "bad_request", "nodeId required");
      if (payload.nodeId !== signerNodeId) {
        return errorResponse(401, "unauthorized", "nodeId does not match the signing node");
      }
      const events = await this.poll(payload.nodeId, payload.waitMs);
      if (events === null) return errorResponse(404, "not_found", `Node "${payload.nodeId}" is not registered`);
      return jsonResponse(200, { ok: true, events });
    }

    if (method === "POST" && segments[0] === "nodes" && segments[1] === "deregister") {
      this.deregisterNode(signerNodeId);
      return jsonResponse(200, { ok: true });
    }

    // --- turn results -------------------------------------------------------
    if (method === "POST" && segments[0] === "turns" && segments[2] === "result") {
      const payload = parse<TurnResultRequest>(body);
      const requestId = decodeURIComponent(segments[1] ?? "");
      if (!payload || !requestId) return errorResponse(400, "bad_request", "requestId required");
      const accepted = this.submitTurnResult(signerNodeId, requestId, payload);
      if (!accepted) return errorResponse(404, "not_found", `No pending turn ${requestId}`);
      return jsonResponse(200, { ok: true });
    }

    // --- channels -----------------------------------------------------------
    if (segments[0] === "channels" && segments[1] && segments[2] === "messages") {
      const channelId = decodeURIComponent(segments[1]);
      if (method === "GET") {
        const params = new URLSearchParams(query);
        const afterSeq = Number(params.get("afterSeq") ?? "0");
        const limit = params.get("limit") ? Number(params.get("limit")) : undefined;
        const messages = await this.store.read(channelId, {
          afterSeq: Number.isFinite(afterSeq) ? afterSeq : 0,
          limit,
        });
        return jsonResponse(200, { ok: true, messages });
      }
      if (method === "POST") {
        const payload = parse<{
          text: string;
          author: ChannelMessage["author"];
          kind?: ChannelMessage["kind"];
          threadId?: string;
        }>(body);
        if (!payload?.text || !payload.author?.id) {
          return errorResponse(400, "bad_request", "text and author required");
        }
        const channel = await this.store.getChannel(channelId);
        if (!channel) return errorResponse(404, "not_found", `Unknown channel ${channelId}`);
        const message = await this.store.append({
          channelId,
          author: payload.author,
          text: payload.text,
          kind: payload.kind ?? "chat",
          threadId: payload.threadId,
          meta: { viaNode: signerNodeId },
        });
        return jsonResponse(201, { ok: true, message });
      }
    }

    // --- meetings -----------------------------------------------------------
    if (segments[0] === "meetings" && segments[1]) {
      const meetingId = decodeURIComponent(segments[1]);
      const meeting = this.meetings.get(meetingId);
      if (!meeting) return errorResponse(404, "not_found", `Unknown meeting ${meetingId}`);

      if (method === "GET" && segments.length === 2) {
        const transcript = await this.store.read(meeting.config.channelId);
        return jsonResponse(200, {
          ok: true,
          config: meeting.config,
          state: meeting.getState(),
          minutes: buildMinutes(meeting.config, meeting.getState(), transcript),
        });
      }

      if (method === "POST" && segments[2] === "control") {
        const payload = parse<{
          action: "start" | "step" | "run" | "pause" | "resume" | "takeover" | "release" | "complete";
          limit?: number;
          humanId?: string;
          displayName?: string;
          asPersonaId?: string;
          reason?: string;
        }>(body);
        if (!payload?.action) return errorResponse(400, "bad_request", "action required");
        const state = await applyControl(meeting, payload);
        return jsonResponse(200, { ok: true, state });
      }

      if (method === "POST" && segments[2] === "messages") {
        const payload = parse<{
          humanId: string;
          displayName: string;
          text: string;
          asPersonaId?: string;
        }>(body);
        if (!payload?.text || !payload.humanId) {
          return errorResponse(400, "bad_request", "humanId and text required");
        }
        const message = await meeting.postHumanMessage(payload);
        return jsonResponse(201, { ok: true, message, state: meeting.getState() });
      }
    }

    return errorResponse(404, "not_found", `Unknown path ${path}`);
  }

  // -------------------------------------------------------------------------
  // Node bookkeeping
  // -------------------------------------------------------------------------

  registerNode(input: RegisterRequest): NodeSession {
    const existing = this.nodes.get(input.nodeId);
    if (existing) {
      // Re-registration after a worker restart: keep the queue so in-flight
      // broadcasts are not lost, but refresh what it claims to serve.
      existing.personaIds = new Set(input.personaIds);
      existing.label = input.label ?? existing.label;
      existing.lastSeenAt = this.clock.now();
      return existing;
    }
    const session: NodeSession = {
      nodeId: input.nodeId,
      label: input.label,
      personaIds: new Set(input.personaIds),
      lastSeenAt: this.clock.now(),
      queue: [],
    };
    this.nodes.set(input.nodeId, session);
    return session;
  }

  deregisterNode(nodeId: string): void {
    const session = this.nodes.get(nodeId);
    if (!session) return;
    session.waiter?.resolve([]);
    if (session.waiter) clearTimeout(session.waiter.timer);
    this.nodes.delete(nodeId);
    for (const pending of [...this.pending.values()]) {
      if (pending.nodeId !== nodeId) continue;
      clearTimeout(pending.timer);
      this.pending.delete(pending.requestId);
      pending.reject(new Error(`Node "${nodeId}" disconnected before answering`));
    }
  }

  /** Returns null when the node is unknown, otherwise the events to deliver. */
  async poll(nodeId: string, waitMs?: number): Promise<HubEvent[] | null> {
    const session = this.nodes.get(nodeId);
    if (!session) return null;
    session.lastSeenAt = this.clock.now();

    if (session.queue.length > 0) {
      return session.queue.splice(0, session.queue.length);
    }
    if (this.closed) return [];

    const hold = Math.min(Math.max(waitMs ?? this.maxPollWaitMs, 0), this.maxPollWaitMs);
    if (hold === 0) return [];

    // Only one waiter per node; a second poll replaces the first so a
    // reconnecting worker cannot strand an orphaned long-poll.
    if (session.waiter) {
      clearTimeout(session.waiter.timer);
      session.waiter.resolve([]);
      session.waiter = undefined;
    }

    return new Promise<HubEvent[]>((resolve) => {
      const timer = setTimeout(() => {
        if (session.waiter?.timer === timer) session.waiter = undefined;
        resolve(session.queue.splice(0, session.queue.length));
      }, hold);
      timer.unref?.();
      session.waiter = { resolve, timer };
    });
  }

  submitTurnResult(nodeId: string, requestId: string, payload: TurnResultRequest): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    if (pending.nodeId !== nodeId) return false;
    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    const session = this.nodes.get(nodeId);
    if (session) session.lastSeenAt = this.clock.now();

    if (payload.error) {
      pending.reject(new Error(payload.error));
      return true;
    }
    if (!payload.result) {
      pending.reject(new Error("Worker returned neither a result nor an error"));
      return true;
    }
    pending.resolve({
      text: payload.result.text,
      addressedTo: payload.result.addressedTo,
      proposesCompletion: payload.result.proposesCompletion,
      meta: { ...payload.result.meta, nodeId },
    });
    return true;
  }

  /** Releases every timer and long-poll. Safe to call twice. */
  close(): void {
    this.closed = true;
    for (const session of this.nodes.values()) {
      if (session.waiter) {
        clearTimeout(session.waiter.timer);
        session.waiter.resolve([]);
        session.waiter = undefined;
      }
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Hub closed"));
    }
    this.pending.clear();
    this.nodes.clear();
    for (const unsub of this.channelUnsubs.values()) unsub();
    this.channelUnsubs.clear();
  }
}

/** Bridges the orchestrator's runtime interface onto the hub's dispatcher. */
class HubRemoteRuntime implements AgentRuntime {
  readonly nodeId = "remote";

  constructor(private readonly hub: MeetingHub) {}

  serves(persona: AgentPersona): boolean {
    return this.hub.servesRemotely(persona);
  }

  takeTurn(request: AgentTurnRequest): Promise<AgentTurnResult> {
    return this.hub.dispatchTurn(request);
  }
}

async function applyControl(
  meeting: MeetingOrchestrator,
  payload: {
    action: string;
    limit?: number;
    humanId?: string;
    displayName?: string;
    asPersonaId?: string;
    reason?: string;
  },
) {
  switch (payload.action) {
    case "start":
      return meeting.start();
    case "step":
      return (await meeting.step()).state;
    case "run":
      return meeting.run({ limit: payload.limit });
    case "pause":
      return meeting.pause();
    case "resume":
      return meeting.resume();
    case "takeover":
      return meeting.takeOver({
        humanId: payload.humanId ?? "human",
        displayName: payload.displayName ?? "Facilitator",
        asPersonaId: payload.asPersonaId,
      });
    case "release":
      return meeting.release();
    case "complete":
      return meeting.complete(payload.reason);
    default:
      throw new Error(`Unknown action "${payload.action}"`);
  }
}

function normalize(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

function parse<T>(body: string): T | null {
  if (!body) return null;
  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}
