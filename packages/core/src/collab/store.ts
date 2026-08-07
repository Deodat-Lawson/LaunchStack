/**
 * Channel storage port plus an in-memory implementation.
 *
 * The port is intentionally small: append, read a window, read one, and
 * subscribe. Everything the orchestrator, the network hub, and the Slack
 * bridge need is expressible in those four operations, which keeps a
 * Postgres-backed implementation (see `apps/web/src/server/collab/`) honest.
 */

import type { Clock, IdFactory } from "./clock";
import { randomIdFactory, systemClock } from "./clock";
import type { Channel, ChannelMessage, ChannelMessageInput } from "./types";

export interface ReadOptions {
  /** Return messages with `seq` strictly greater than this. */
  afterSeq?: number;
  /** Cap the number of messages returned. Applied after `afterSeq`. */
  limit?: number;
}

export type MessageListener = (message: ChannelMessage) => void;

export interface ChannelStore {
  createChannel(input: Omit<Channel, "createdAt"> & { createdAt?: string }): Promise<Channel>;
  getChannel(channelId: string): Promise<Channel | null>;
  getChannelBySlug(workspaceId: string, slug: string): Promise<Channel | null>;
  listChannels(workspaceId: string): Promise<Channel[]>;
  updateChannel(channelId: string, patch: Partial<Omit<Channel, "id">>): Promise<Channel | null>;

  append(input: ChannelMessageInput): Promise<ChannelMessage>;
  read(channelId: string, options?: ReadOptions): Promise<ChannelMessage[]>;
  getMessage(messageId: string): Promise<ChannelMessage | null>;
  /** Highest `seq` in the channel, or 0 when empty. */
  latestSeq(channelId: string): Promise<number>;

  /** Fires for every appended message. Returns an unsubscribe function. */
  subscribe(channelId: string, listener: MessageListener): () => void;
}

export class InMemoryChannelStore implements ChannelStore {
  private readonly channels = new Map<string, Channel>();
  private readonly messages = new Map<string, ChannelMessage[]>();
  private readonly byId = new Map<string, ChannelMessage>();
  private readonly listeners = new Map<string, Set<MessageListener>>();

  constructor(
    private readonly clock: Clock = systemClock,
    private readonly newId: IdFactory = randomIdFactory,
  ) {}

  async createChannel(input: Omit<Channel, "createdAt"> & { createdAt?: string }): Promise<Channel> {
    const existing = await this.getChannelBySlug(input.workspaceId, input.slug);
    if (existing) {
      throw new Error(`Channel slug "${input.slug}" already exists in workspace ${input.workspaceId}`);
    }
    const channel: Channel = { ...input, createdAt: input.createdAt ?? this.clock.iso() };
    this.channels.set(channel.id, channel);
    this.messages.set(channel.id, []);
    return channel;
  }

  async getChannel(channelId: string): Promise<Channel | null> {
    return this.channels.get(channelId) ?? null;
  }

  async getChannelBySlug(workspaceId: string, slug: string): Promise<Channel | null> {
    for (const c of this.channels.values()) {
      if (c.workspaceId === workspaceId && c.slug === slug) return c;
    }
    return null;
  }

  async listChannels(workspaceId: string): Promise<Channel[]> {
    return [...this.channels.values()]
      .filter((c) => c.workspaceId === workspaceId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async updateChannel(channelId: string, patch: Partial<Omit<Channel, "id">>): Promise<Channel | null> {
    const existing = this.channels.get(channelId);
    if (!existing) return null;
    const next = { ...existing, ...patch };
    this.channels.set(channelId, next);
    return next;
  }

  async append(input: ChannelMessageInput): Promise<ChannelMessage> {
    const list = this.messages.get(input.channelId);
    if (!list) throw new Error(`Unknown channel ${input.channelId}`);
    const message: ChannelMessage = {
      id: this.newId("msg"),
      channelId: input.channelId,
      seq: list.length + 1,
      ts: this.clock.iso(),
      author: input.author,
      text: input.text,
      kind: input.kind ?? "chat",
      threadId: input.threadId,
      slackTs: input.slackTs,
      meta: input.meta,
    };
    list.push(message);
    this.byId.set(message.id, message);
    for (const listener of this.listeners.get(input.channelId) ?? []) {
      // A throwing subscriber must not corrupt the log or block other
      // subscribers — the message is already committed at this point.
      try {
        listener(message);
      } catch {
        // Intentionally swallowed; subscribers own their own error handling.
      }
    }
    return message;
  }

  async read(channelId: string, options: ReadOptions = {}): Promise<ChannelMessage[]> {
    const list = this.messages.get(channelId) ?? [];
    const after = options.afterSeq ?? 0;
    const filtered = after > 0 ? list.filter((m) => m.seq > after) : [...list];
    return options.limit !== undefined ? filtered.slice(0, options.limit) : filtered;
  }

  async getMessage(messageId: string): Promise<ChannelMessage | null> {
    return this.byId.get(messageId) ?? null;
  }

  async latestSeq(channelId: string): Promise<number> {
    const list = this.messages.get(channelId) ?? [];
    return list.length === 0 ? 0 : list[list.length - 1]!.seq;
  }

  subscribe(channelId: string, listener: MessageListener): () => void {
    let set = this.listeners.get(channelId);
    if (!set) {
      set = new Set();
      this.listeners.set(channelId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }
}
