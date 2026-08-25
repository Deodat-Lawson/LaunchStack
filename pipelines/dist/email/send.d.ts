import type { MergeFn, SendAdapter } from "./contracts.js";
import type { Recipient, SendMode, SendResult, EmailTemplate } from "./types.js";
/**
 * Send adapter + the safety wrapper. The pipeline never sends "raw" — every
 * recipient passes through idempotency, suppression, per-recipient render,
 * a no-unresolved-token guard, and (for real sends) rate limiting.
 *
 * Delivery is bracketed by two persistence hooks, `claim` and `record`. The
 * claim is written before the provider call and the outcome after, so a
 * process that dies mid-loop leaves a durable trace of every address it may
 * already have emailed. Nothing here knows how that is stored; dispatch.ts
 * supplies the hooks.
 */
/**
 * Default adapter: logs instead of sending. No email dependency, so nothing
 * ever leaves the machine until a real provider (Resend/SMTP) is wired in
 * behind this same interface.
 */
export declare const consoleAdapter: SendAdapter;
export interface SendCampaignArgs {
    template: EmailTemplate;
    recipients: Recipient[];
    /** Default "dry_run": render + record everything, deliver nothing. */
    mode?: SendMode;
    adapter?: SendAdapter;
    merge?: MergeFn;
    /** Required compliance fields injected per recipient. */
    senderIdentity: string;
    /**
     * Builds the one-click unsubscribe link for an address. A function, not a
     * base URL, because the link must carry a signed token proving we issued it
     * for that specific recipient.
     */
    unsubscribeUrl: (email: string) => string;
    /** Suppression + idempotency hooks (DB-backed in dispatch.ts). */
    isSuppressed?: (email: string) => boolean | Promise<boolean>;
    alreadySent?: (email: string) => boolean | Promise<boolean>;
    /**
     * Reserve this recipient before the provider is called. Returning false
     * means someone already reserved it — the recipient is skipped, never
     * retried, because a reservation without an outcome may still have been
     * delivered.
     */
    claim?: (email: string) => boolean | Promise<boolean>;
    /** Persist one outcome as soon as it is known. */
    record?: (result: SendResult) => void | Promise<void>;
    /** Stable per-recipient key so the provider can dedup on its own side. */
    providerIdempotencyKey?: (email: string) => string;
    /** Real-send throttle. */
    ratePerMinute?: number;
    /** Called every few recipients so a long run can prove it is still alive. */
    heartbeat?: () => void | Promise<void>;
}
export declare function sendCampaign(args: SendCampaignArgs): Promise<SendResult[]>;
//# sourceMappingURL=send.d.ts.map