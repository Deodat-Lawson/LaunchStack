/**
 * Running work under a workspace's own models.
 *
 * Wrap anything done *for a workspace* — a request handler's body, a
 * background job, a meeting turn — in {@link withWorkspaceChatModels}. Inside
 * it, every chat resolution (including those deep in feature packages and
 * pipelines that never see a workspace id) uses the workspace's endpoint when
 * it brought one, and the deployment's otherwise.
 *
 * Fails closed. A workspace that chose its own endpoint but whose key cannot
 * be decrypted, or whose address the deployment now refuses, gets an error on
 * its next chat — never the deployment's models in its place. Its data was
 * meant for its own provider, and its admins expect their own bill.
 */

import {
    ChatConfigurationError,
    ChatScopeUnavailableError,
    runWithChatModelsScope,
    type ChatModelsScope,
} from "@launchstack/llm";
import { createSlot } from "@launchstack/runtime";

import { buildWorkspaceChatModelsConfig } from "./config";
import { WorkspaceEndpointUrlError, assertEndpointUrlAllowed } from "./endpoint-url";
import { getWorkspaceEndpointRow, readWorkspaceEndpointKey } from "./store";

const DEPLOYMENT_SCOPE: ChatModelsScope = Object.freeze({ source: "deployment" });

/**
 * A row is looked up once per workspace per few seconds per process: requests
 * and Inngest steps re-enter often, and a primary-key read for each is
 * waste. Saving or disconnecting clears the entry in this process at once;
 * other processes (the worker) catch up within the TTL.
 */
const CACHE_TTL_MS = 10_000;
const cacheSlot = createSlot<Map<number, { at: number; scope: ChatModelsScope }>>(
    "workspace-models/scopeCache"
);

function cache(): Map<number, { at: number; scope: ChatModelsScope }> {
    let map = cacheSlot.get();
    if (!map) {
        map = new Map();
        cacheSlot.set(map);
    }
    return map;
}

export function invalidateWorkspaceChatModels(companyId: bigint | number | string): void {
    cache().delete(Number(companyId));
}

/** Test seam. */
export function resetWorkspaceChatModelsCache(): void {
    cache().clear();
}

function unusable(reason: string): ChatModelsScope {
    return {
        source: "workspace",
        error: new ChatScopeUnavailableError(
            `Your workspace's own model can't be used: ${reason} A workspace admin can fix it in Settings › Bring your own keys.`
        ),
    };
}

async function loadScope(companyId: number): Promise<ChatModelsScope> {
    const row = await getWorkspaceEndpointRow(companyId);
    // Connected but no model chosen yet: nothing has switched over.
    if (!row?.models?.default?.id) return DEPLOYMENT_SCOPE;

    let baseUrl: string;
    try {
        baseUrl = await assertEndpointUrlAllowed(row.baseUrl);
    } catch (error) {
        if (error instanceof WorkspaceEndpointUrlError) return unusable(error.message);
        throw error;
    }

    let apiKey: string | null;
    try {
        apiKey = readWorkspaceEndpointKey(row);
    } catch (error) {
        console.error(
            `[workspace-models] could not decrypt the key for workspace ${companyId}:`,
            error instanceof Error ? error.message : error
        );
        return unusable("its saved API key can't be read on this server, so enter it again.");
    }

    try {
        const config = buildWorkspaceChatModelsConfig({
            baseUrl,
            apiKey,
            selection: row.models,
        });
        return { source: "workspace", config };
    } catch (error) {
        if (error instanceof ChatConfigurationError) {
            // The detail can quote model ids, and this reason reaches every
            // member's chat, so it goes to the log.
            console.error(
                `[workspace-models] workspace ${companyId}'s setup is invalid:`,
                error.message
            );
            return unusable("its saved model setup isn't valid, so open it and save it again.");
        }
        throw error;
    }
}

/** The scope a workspace's work should run in. Cached briefly; see above. */
export async function loadWorkspaceChatModelsScope(
    companyId: bigint | number | string | null | undefined
): Promise<ChatModelsScope> {
    if (companyId === null || companyId === undefined || companyId === "") return DEPLOYMENT_SCOPE;
    const id = Number(companyId);
    if (!Number.isSafeInteger(id) || id <= 0) return DEPLOYMENT_SCOPE;

    const hit = cache().get(id);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.scope;

    const scope = await loadScope(id);
    cache().set(id, { at: Date.now(), scope });
    return scope;
}

/**
 * Run `fn` with chat resolving against the workspace's own endpoint, if it
 * brought one. A missing workspace id pins the deployment's models, so work
 * nested inside another workspace's scope can't inherit it by accident.
 */
export async function withWorkspaceChatModels<T>(
    companyId: bigint | number | string | null | undefined,
    fn: () => T | Promise<T>
): Promise<T> {
    const scope = await loadWorkspaceChatModelsScope(companyId);
    return await runWithChatModelsScope(scope, fn);
}
