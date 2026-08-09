/**
 * Agent worker — the process that runs on the *other* machine.
 *
 * It holds one or more local `AgentRuntime`s, registers the personas they can
 * serve with a hub, then long-polls for work. All traffic is outbound, so the
 * worker needs no public address, no inbound firewall rule, and no shared
 * database with the hub — only the hub URL and the shared secret.
 */

import type { AgentRuntime, AgentTurnResult } from "../agent";
import type { HubClient } from "./client";
import type { HubEvent, TurnRequestEvent } from "./protocol";
import type { ChannelMessage, MeetingState } from "../types";

export interface AgentWorkerOptions {
  client: HubClient;
  /** Runtimes consulted in order for each turn request. */
  runtimes: AgentRuntime[];
  /** Personas advertised at registration. Empty means "anything routed to me". */
  personaIds?: string[];
  label?: string;
  /** How long each long poll may block. */
  pollWaitMs?: number;
  /** Backoff applied after a failed poll, doubling up to 30s. */
  reconnectDelayMs?: number;
  onMessage?: (message: ChannelMessage) => void;
  onMeetingState?: (meetingId: string, state: MeetingState) => void;
  onError?: (error: Error, phase: "register" | "poll" | "turn" | "result") => void;
}

export class AgentWorker {
  private running = false;
  private loop: Promise<void> | null = null;
  private abort: AbortController | null = null;
  private readonly inFlight = new Map<string, AbortController>();
  private registered = false;

  constructor(private readonly options: AgentWorkerOptions) {}

  get nodeId(): string {
    return this.options.client.nodeId;
  }

  /** Registers with the hub and starts the poll loop. Resolves once registered. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.abort = new AbortController();
    await this.register();
    this.loop = this.pollLoop();
  }

  /** Stops polling, cancels in-flight turns, and deregisters. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.abort?.abort();
    for (const controller of this.inFlight.values()) controller.abort();
    this.inFlight.clear();
    try {
      if (this.registered) await this.options.client.deregister();
    } catch {
      // The hub may already be gone; shutting down is still correct.
    }
    await this.loop?.catch(() => undefined);
    this.loop = null;
  }

  private async register(): Promise<void> {
    await this.options.client.register({
      personaIds: this.options.personaIds ?? [],
      label: this.options.label,
    });
    this.registered = true;
  }

  private async pollLoop(): Promise<void> {
    const baseDelay = this.options.reconnectDelayMs ?? 250;
    let delay = baseDelay;

    while (this.running) {
      try {
        const { events } = await this.options.client.poll(
          this.options.pollWaitMs ?? 20_000,
          this.abort?.signal,
        );
        delay = baseDelay;
        for (const event of events) this.dispatch(event);
      } catch (err) {
        if (!this.running) return;
        const error = err instanceof Error ? err : new Error(String(err));
        this.options.onError?.(error, "poll");

        // A 404 means the hub forgot us (restart, eviction). Re-register
        // rather than spinning against a node id the hub no longer knows.
        if ((err as { status?: number }).status === 404) {
          this.registered = false;
          try {
            await this.register();
            continue;
          } catch (registerErr) {
            this.options.onError?.(
              registerErr instanceof Error ? registerErr : new Error(String(registerErr)),
              "register",
            );
          }
        }

        await sleep(delay, this.abort?.signal);
        delay = Math.min(delay * 2, 30_000);
      }
    }
  }

  private dispatch(event: HubEvent): void {
    switch (event.type) {
      case "turn.request":
        void this.handleTurn(event);
        return;
      case "channel.message":
        this.options.onMessage?.(event.message);
        return;
      case "meeting.state":
        this.options.onMeetingState?.(event.meetingId, event.state);
        return;
      case "turn.cancel": {
        this.inFlight.get(event.requestId)?.abort();
        this.inFlight.delete(event.requestId);
        return;
      }
    }
  }

  private async handleTurn(event: TurnRequestEvent): Promise<void> {
    const controller = new AbortController();
    this.inFlight.set(event.requestId, controller);

    try {
      const runtime = this.options.runtimes.find((r) => r.serves(event.persona));
      if (!runtime) {
        await this.reportTurn(event.requestId, {
          error: `Node "${this.nodeId}" has no runtime for persona "${event.persona.id}"`,
        });
        return;
      }

      let result: AgentTurnResult;
      try {
        result = await runtime.takeTurn({
          persona: event.persona,
          context: event.context,
          transcript: event.transcript,
        });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.options.onError?.(error, "turn");
        await this.reportTurn(event.requestId, { error: error.message });
        return;
      }

      // The hub has already given up; sending the result would be discarded
      // anyway and only burns a request.
      if (Date.now() > event.deadlineAt) return;
      if (controller.signal.aborted) return;

      await this.reportTurn(event.requestId, {
        result: {
          text: result.text,
          addressedTo: result.addressedTo,
          proposesCompletion: result.proposesCompletion,
          meta: { ...result.meta, servedByNode: this.nodeId },
        },
      });
    } finally {
      this.inFlight.delete(event.requestId);
    }
  }

  private async reportTurn(requestId: string, payload: { result?: unknown; error?: string }): Promise<void> {
    try {
      await this.options.client.submitTurnResult(requestId, payload);
    } catch (err) {
      this.options.onError?.(err instanceof Error ? err : new Error(String(err)), "result");
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
