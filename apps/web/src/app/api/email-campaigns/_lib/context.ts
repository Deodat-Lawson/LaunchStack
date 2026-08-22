/**
 * Campaign-specific route plumbing, layered on the shared route contract in
 * `~/server/api/context`.
 *
 * Everything general — actor resolution, the role gate, id parsing, response
 * envelopes, error mapping — now lives in the shared module. What stays here is
 * genuinely about email: the sender identity CAN-SPAM requires on every
 * message, and the base URL unsubscribe tokens are appended to.
 *
 * Every route resolves the company here and passes it into the feature layer,
 * which refuses to load a campaign that belongs to anyone else — a campaign id
 * in a URL is untrusted input.
 */

import {
    parseNumericId,
    requireManagement,
    resolveApiActor,
    type ActorResult,
    type ApiActor,
} from "~/server/api/context";

export { fail, handleRouteError, idempotencyKeyFrom, ok, readJson } from "~/server/api/context";

export interface CampaignActor extends ApiActor {
    /** Sender identity injected into every email for CAN-SPAM compliance. */
    senderIdentity: string;
}

function withSenderIdentity(resolved: ActorResult): ActorResult<CampaignActor> {
    if (!resolved.ok) return resolved;
    return {
        ok: true,
        actor: {
            ...resolved.actor,
            senderIdentity: resolved.actor.email ?? resolved.actor.name ?? "the sender",
        },
    };
}

export async function resolveActor(): Promise<ActorResult<CampaignActor>> {
    return withSenderIdentity(await resolveApiActor());
}

/**
 * Same as {@link resolveActor}, but additionally requires a management role.
 *
 * Approving a template and delivering outbound email are workspace-wide
 * actions taken under the company's identity — the same tier as settings
 * mutations, which the rest of the API gates on `isManagementRole`. Editors
 * can still draft campaigns and run dry-run previews.
 */
export async function resolveManagementActor(): Promise<ActorResult<CampaignActor>> {
    return requireManagement(await resolveActor());
}

/** Parse a `[campaignId]` path segment. Digits only — no `1e2`, hex, or floats. */
export const parseCampaignId = parseNumericId;

/**
 * Base for unsubscribe links. The company and address travel inside the signed
 * token the feature layer appends, never as guessable path segments.
 */
export function unsubscribeBaseUrl(request: Request) {
    return `${new URL(request.url).origin}/api/email-pipeline/unsubscribe`;
}
