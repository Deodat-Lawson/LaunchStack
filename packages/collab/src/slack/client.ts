/**
 * Slack Web API port.
 *
 * Only the four calls a meeting channel needs are modelled. Keeping this an
 * interface (rather than pulling in `@slack/web-api`) means the bridge can be
 * tested against a fake without a network, and a self-hosted deployment can
 * point it at a Slack-compatible server (Mattermost, Rocket.Chat) instead.
 */

export interface SlackPostMessageInput {
    channel: string;
    text: string;
    /** Thread parent `ts`, for threaded replies. */
    threadTs?: string;
    /** Display name override — how an agent gets its own identity in Slack. */
    username?: string;
    iconEmoji?: string;
    blocks?: unknown[];
}

export interface SlackPostMessageResult {
    ok: boolean;
    ts?: string;
    channel?: string;
    error?: string;
}

export interface SlackHistoryMessage {
    ts: string;
    text: string;
    user?: string;
    bot_id?: string;
    thread_ts?: string;
    subtype?: string;
}

export interface SlackUserProfile {
    id: string;
    displayName: string;
    isBot: boolean;
}

export interface SlackClient {
    postMessage(input: SlackPostMessageInput): Promise<SlackPostMessageResult>;
    createChannel(
        name: string,
        isPrivate?: boolean
    ): Promise<{ ok: boolean; channelId?: string; error?: string }>;
    history(channel: string, oldestTs?: string): Promise<SlackHistoryMessage[]>;
    userInfo(userId: string): Promise<SlackUserProfile | null>;
}

export interface HttpSlackClientOptions {
    botToken: string;
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
}

/** Real Slack Web API over `fetch`. No SDK, no transitive dependencies. */
export class HttpSlackClient implements SlackClient {
    private readonly baseUrl: string;
    private readonly fetchImpl: typeof fetch;
    private readonly userCache = new Map<string, SlackUserProfile | null>();

    constructor(private readonly options: HttpSlackClientOptions) {
        this.baseUrl = (options.baseUrl ?? "https://slack.com/api").replace(/\/+$/, "");
        this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    }

    private async call<T extends { ok: boolean; error?: string }>(
        method: string,
        payload: Record<string, unknown>
    ): Promise<T> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 15_000);
        timer.unref?.();
        try {
            const response = await this.fetchImpl(`${this.baseUrl}/${method}`, {
                method: "POST",
                headers: {
                    authorization: `Bearer ${this.options.botToken}`,
                    "content-type": "application/json; charset=utf-8",
                },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
            return (await response.json()) as T;
        } finally {
            clearTimeout(timer);
        }
    }

    async postMessage(input: SlackPostMessageInput): Promise<SlackPostMessageResult> {
        const result = await this.call<{
            ok: boolean;
            ts?: string;
            channel?: string;
            error?: string;
        }>("chat.postMessage", {
            channel: input.channel,
            text: input.text,
            thread_ts: input.threadTs,
            username: input.username,
            icon_emoji: input.iconEmoji,
            blocks: input.blocks,
        });
        return { ok: result.ok, ts: result.ts, channel: result.channel, error: result.error };
    }

    async createChannel(name: string, isPrivate = false) {
        const result = await this.call<{ ok: boolean; channel?: { id: string }; error?: string }>(
            "conversations.create",
            { name, is_private: isPrivate }
        );
        return { ok: result.ok, channelId: result.channel?.id, error: result.error };
    }

    async history(channel: string, oldestTs?: string): Promise<SlackHistoryMessage[]> {
        const result = await this.call<{ ok: boolean; messages?: SlackHistoryMessage[] }>(
            "conversations.history",
            { channel, oldest: oldestTs, limit: 200 }
        );
        // Slack returns newest-first; the channel log is oldest-first.
        return (result.messages ?? []).slice().reverse();
    }

    async userInfo(userId: string): Promise<SlackUserProfile | null> {
        if (this.userCache.has(userId)) return this.userCache.get(userId)!;
        const result = await this.call<{
            ok: boolean;
            user?: { id: string; real_name?: string; name?: string; is_bot?: boolean };
        }>("users.info", { user: userId });
        const profile =
            result.ok && result.user
                ? {
                      id: result.user.id,
                      displayName: result.user.real_name ?? result.user.name ?? result.user.id,
                      isBot: Boolean(result.user.is_bot),
                  }
                : null;
        this.userCache.set(userId, profile);
        return profile;
    }
}

/** Records every call. Used by the bridge tests and by local development. */
export class InMemorySlackClient implements SlackClient {
    readonly posted: SlackPostMessageInput[] = [];
    readonly channels = new Map<string, SlackHistoryMessage[]>();
    private counter = 0;

    constructor(private readonly users: Record<string, SlackUserProfile> = {}) {}

    async postMessage(input: SlackPostMessageInput): Promise<SlackPostMessageResult> {
        this.posted.push(input);
        const ts = `${1700000000 + ++this.counter}.000100`;
        const list = this.channels.get(input.channel) ?? [];
        list.push({ ts, text: input.text, bot_id: "B_LAUNCHSTACK", thread_ts: input.threadTs });
        this.channels.set(input.channel, list);
        return { ok: true, ts, channel: input.channel };
    }

    async createChannel(name: string) {
        const channelId = `C_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
        this.channels.set(channelId, []);
        return { ok: true, channelId };
    }

    async history(channel: string): Promise<SlackHistoryMessage[]> {
        return [...(this.channels.get(channel) ?? [])];
    }

    async userInfo(userId: string): Promise<SlackUserProfile | null> {
        return this.users[userId] ?? null;
    }
}
