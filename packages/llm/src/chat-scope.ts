/**
 * A chat configuration that holds for one unit of work rather than the whole
 * process.
 *
 * The deployment installs one configuration with `configureChatModels`, and
 * that stays the default. A workspace that brings its own endpoint must not
 * change it — requests for other workspaces run in the same process at the
 * same time — so its configuration travels with the work instead: the host
 * wraps a request or a background job in {@link runWithChatModelsScope}, and
 * every resolution inside it, however deep, sees the scoped configuration.
 *
 * This is what lets feature packages and pipelines keep calling
 * `resolveChatModel()` with no workspace id in hand. They never learn which
 * configuration they got; the scope decides.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { ChatModelsConfig } from "./chat-config";

export type ChatModelsSource = "deployment" | "workspace";

export interface ChatModelsScope {
    /** Whose configuration this is. Accounting and error wording read it. */
    source: ChatModelsSource;
    /**
     * The configuration to resolve against. Absent with `source: "deployment"`
     * means "the process-wide one", so a scope can pin work to the default
     * even when an outer scope chose something else.
     */
    config?: ChatModelsConfig;
    /**
     * Set when the scope's own configuration exists but cannot be used — an
     * undecryptable key, an address the deployment refuses. Resolution throws
     * it instead of falling back: work a workspace pointed at its own provider
     * must never quietly go to someone else's.
     */
    error?: Error;
}

/**
 * One store per process, kept on `globalThis` for the same reason as the
 * config slot: Next can load this module more than once, and two copies with
 * two stores would each see an empty scope inside the other's `run`.
 */
const STORE_KEY = Symbol.for("@launchstack/llm:chatModelsScope");

function storage(): AsyncLocalStorage<ChatModelsScope> {
    const holder = globalThis as unknown as Record<symbol, AsyncLocalStorage<ChatModelsScope>>;
    holder[STORE_KEY] ??= new AsyncLocalStorage<ChatModelsScope>();
    return holder[STORE_KEY];
}

/** Run `fn` with `scope` deciding which chat configuration it resolves. */
export function runWithChatModelsScope<T>(scope: ChatModelsScope, fn: () => T): T {
    return storage().run(scope, fn);
}

/** The scope the current work runs in, if any. */
export function getChatModelsScope(): ChatModelsScope | undefined {
    return storage().getStore();
}

/** Whose configuration a resolution here would use. */
export function getChatModelsSource(): ChatModelsSource {
    return getChatModelsScope()?.source ?? "deployment";
}

/**
 * Called when a route resolves with no scope at all — work that never said
 * whose it is. Hosts register one in development to find entry points that
 * forgot to enter a workspace scope; production registers none.
 */
type UnscopedResolutionHandler = () => void;
const HANDLER_KEY = Symbol.for("@launchstack/llm:unscopedChatResolution");

export function setUnscopedChatResolutionHandler(handler: UnscopedResolutionHandler | null): void {
    const holder = globalThis as unknown as Record<symbol, UnscopedResolutionHandler | undefined>;
    holder[HANDLER_KEY] = handler ?? undefined;
}

export function reportUnscopedChatResolution(): void {
    if (getChatModelsScope()) return;
    const holder = globalThis as unknown as Record<symbol, UnscopedResolutionHandler | undefined>;
    holder[HANDLER_KEY]?.();
}
