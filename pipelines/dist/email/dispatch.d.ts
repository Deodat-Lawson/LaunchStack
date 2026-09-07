import type { MergeFn, SendAdapter } from "./contracts.js";
import { type CampaignRecord, type Recipient, type SendAttemptRecord, type SendMode, type SendResult, type TemplateVersion } from "./types.js";
export interface DispatchEmailCampaignArgs {
    companyId: number;
    campaignId: number;
    /**
     * Deduplicates retries. Two requests with the same key against the same
     * campaign resolve to one attempt; the second replays the first's results.
     */
    idempotencyKey: string;
    /** Default "dry_run": render + record everything, deliver nothing. */
    mode?: SendMode;
    /** Audience for the FIRST dispatch. Ignored once the list is frozen. */
    recipients?: Recipient[];
    senderIdentity: string;
    /** Origin-qualified base for unsubscribe links; the signed token is appended. */
    unsubscribeBaseUrl: string;
    requestedBy?: number | null;
    adapter?: SendAdapter;
    merge?: MergeFn;
    ratePerMinute?: number;
}
export interface DispatchedEmailCampaign {
    campaign: CampaignRecord;
    version: TemplateVersion;
    attempt: SendAttemptRecord;
    results: SendResult[];
    /** True when this key had already been used — nothing was delivered now. */
    replayed: boolean;
    /** True when the audience came from a previously frozen list. */
    recipientsFrozen: boolean;
}
export declare function dispatchEmailCampaign(args: DispatchEmailCampaignArgs): Promise<DispatchedEmailCampaign>;
//# sourceMappingURL=dispatch.d.ts.map