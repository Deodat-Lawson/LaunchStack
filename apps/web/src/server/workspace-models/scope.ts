/**
 * Running work under a workspace's own models.
 *
 * Wrap anything done *for a workspace* — a request handler's body, a
 * background job, a meeting turn — in {@link withWorkspaceChatModels}. Inside
 * it, every chat resolution (including those deep in feature packages and
 * pipelines that never see a workspace id) uses the workspace's endpoint when
 * it brought one, and the deployment's otherwise. Every model call inside is
 * also counted against the workspace and the feature the caller names
 * (~/server/ai-usage/record), which is what the usage page reads.
 *
 * Fails closed. A workspace that chose its own endpoint but whose key cannot
 * be decrypted, or whose address the deployment now refuses, gets an error on
 * its next chat — never the deployment's models in its place. Its data was
 * meant for its own provider, and its admins expect their own bill.
 */

import {
    ChatConfigurationError,
    ChatScopeUnavailableError,
    getChatModelsScope,
    getPublicChatConfig,
    runWithChatModelsScope,
    type ChatModelsScope,
    type PublicChatRouteInfo,
} from "@launchstack/llm";
import { createSlot } from "@launchstack/runtime";

import type { AiFeature } from "~/lib/ai-usage";
import { AiAllowanceExceededError } from "~/server/ai-usage/errors";
import { getAiAllowance, type AiAllowance } from "~/server/ai-usage/quota";
import { aiUsageRecorder } from "~/server/ai-usage/record";

import { buildWorkspaceChatModelsConfig, configWithOfferedModel } from "./config";
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
/** A model offered in Ask, as the scope cache keeps it: its handle and its name. */
interface OfferedName {
    key: string;
    label: string;
}

interface Loaded {
    scope: ChatModelsScope;
    /** Empty unless the scope is the workspace's own and usable. */
    offered: readonly OfferedName[];
}

interface CacheEntry extends Loaded {
    at: number;
}

const cacheSlot = createSlot<Map<number, CacheEntry>>("workspace-models/scopeCache");

function cache(): Map<number, CacheEntry> {
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

const NOTHING_OFFERED: readonly OfferedName[] = Object.freeze([]);

function unusable(reason: string): Loaded {
    return {
        scope: {
            source: "workspace",
            error: new ChatScopeUnavailableError(
                `Your workspace's own model can't be used: ${reason} A workspace admin can fix it in Models & usage › API keys.`
            ),
        },
        offered: NOTHING_OFFERED,
    };
}

async function loadScope(companyId: number): Promise<Loaded> {
    const row = await getWorkspaceEndpointRow(companyId);
    // Connected but no model chosen yet: nothing has switched over.
    if (!row?.models?.default?.id) return { scope: DEPLOYMENT_SCOPE, offered: NOTHING_OFFERED };

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
        return {
            scope: { source: "workspace", config },
            offered: (row.models.offered ?? []).map(({ key, label }) => ({ key, label })),
        };
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

async function loadWorkspace(
    companyId: bigint | number | string | null | undefined
): Promise<Loaded> {
    const none = { scope: DEPLOYMENT_SCOPE, offered: NOTHING_OFFERED };
    if (companyId === null || companyId === undefined || companyId === "") return none;
    const id = Number(companyId);
    if (!Number.isSafeInteger(id) || id <= 0) return none;

    const hit = cache().get(id);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;

    const loaded = await loadScope(id);
    cache().set(id, { at: Date.now(), ...loaded });
    return loaded;
}

/** The scope a workspace's work should run in. Cached briefly; see above. */
export async function loadWorkspaceChatModelsScope(
    companyId: bigint | number | string | null | undefined
): Promise<ChatModelsScope> {
    return (await loadWorkspace(companyId)).scope;
}

/**
 * A model offered in Ask, as the browser may see it: the handle to send back,
 * the admin's name for it, and what it can do. Never the provider's id.
 */
export type OfferedModelInfo = { key: string; label: string } & PublicChatRouteInfo;

/**
 * The models a workspace offers in Ask, described for the menu. Empty for a
 * workspace on the deployment's models, and for one whose own setup can't be
 * used (its chat says why on the next turn).
 */
export async function loadWorkspaceOfferedModels(
    companyId: bigint | number | string | null | undefined
): Promise<OfferedModelInfo[]> {
    const { scope, offered } = await loadWorkspace(companyId);
    if (!scope.config || scope.error) return [];
    const config = scope.config;
    return offered.flatMap(({ key, label }) => {
        const picked = configWithOfferedModel(config, key);
        if (!picked) return [];
        return [{ key, label, ...getPublicChatConfig(picked).routes.default }];
    });
}

/**
 * Run `fn` on the offered model `key` in place of the workspace's main model,
 * inside the scope the caller is already in (so its usage counter and its
 * allowance still apply). Resolves to `{ offered: false }` without running
 * `fn` when the current scope offers no model by that key — a deployment
 * scope never does — so the caller can say so instead of answering with
 * another model.
 */
export async function withOfferedChatModel<T>(
    key: string,
    fn: () => T | Promise<T>
): Promise<{ offered: true; value: T } | { offered: false }> {
    const scope = getChatModelsScope();
    if (!scope?.config || scope.error || scope.source !== "workspace") return { offered: false };
    const picked = configWithOfferedModel(scope.config, key);
    if (!picked) return { offered: false };
    const value = await runWithChatModelsScope({ ...scope, config: picked }, fn);
    return { offered: true, value };
}

/**
 * What work done under a workspace's models is: the feature it is counted
 * under, and — when the work is for a person — who.
 */
export interface WorkspaceModelsUse {
    feature: AiFeature;
    /** The person's auth user id; their calls count toward their AI allowance. */
    userId: string | null | undefined;
    /**
     * Refuse the work when they are at a limit (the default). Work that is
     * already running — a background step, an `after()` continuation — passes
     * false: it is counted, never stopped midway.
     */
    enforce?: boolean;
}

/**
 * `userId`'s AI allowance in a workspace, with the server cap applied only
 * where it can. `fresh` skips the few-second cache (for a readout).
 */
export async function loadAiAllowance(
    companyId: bigint | number | string,
    userId: string,
    options: { fresh?: boolean } = {}
): Promise<AiAllowance> {
    const scope = await loadWorkspaceChatModelsScope(companyId);
    return getAiAllowance(BigInt(companyId), userId, {
        serverCapApplies: scope.source === "deployment",
        fresh: options.fresh,
    });
}

/**
 * The allowance error to put on the scope, or undefined to let the work run.
 * A failed read lets it run: the allowance is a guard against runaway use,
 * and refusing every member's AI over a database blip is the worse failure.
 */
async function allowanceError(
    companyId: bigint | number | string | null | undefined,
    scope: ChatModelsScope,
    actor: WorkspaceModelsUse | null
): Promise<AiAllowanceExceededError | undefined> {
    if (!actor?.userId || actor.enforce === false) return undefined;
    if (companyId === null || companyId === undefined || companyId === "") return undefined;
    try {
        const allowance = await getAiAllowance(BigInt(companyId), actor.userId, {
            serverCapApplies: scope.source === "deployment",
        });
        return allowance.blocked ? new AiAllowanceExceededError(allowance) : undefined;
    } catch (error) {
        console.warn(
            `[ai-usage] could not read the AI allowance of ${actor.userId} in workspace ${companyId}; letting the work run:`,
            error instanceof Error ? error.message : error
        );
        return undefined;
    }
}

/**
 * Run `fn` with chat resolving against the workspace's own endpoint, if it
 * brought one, and with every model call counted as `use`'s feature — and as
 * its person's, when `use` names one (`{ feature, userId }`; a bare feature is
 * work no one person started). A missing workspace id pins the deployment's
 * models and counts nothing, so work nested inside another workspace's scope
 * can't inherit it by accident.
 *
 * A person at their AI allowance gets a scope that refuses: every model
 * resolution inside throws {@link AiAllowanceExceededError}, which
 * `describeChatResolutionFailure` words for the screen. Routes that want to
 * answer before doing any work check first with ~/server/ai-usage/refusal.
 */
export async function withWorkspaceChatModels<T>(
    companyId: bigint | number | string | null | undefined,
    use: AiFeature | WorkspaceModelsUse,
    fn: () => T | Promise<T>
): Promise<T> {
    const actor = typeof use === "string" ? null : use;
    const feature = typeof use === "string" ? use : use.feature;
    const scope = await loadWorkspaceChatModelsScope(companyId);
    const usage = aiUsageRecorder(companyId, feature, actor?.userId);
    const refused = await allowanceError(companyId, scope, actor);
    return await runWithChatModelsScope(
        { ...scope, ...(usage ? { usage } : {}), ...(refused ? { error: refused } : {}) },
        fn
    );
}
