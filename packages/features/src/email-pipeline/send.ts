import type { MergeFn, SendAdapter } from "./contracts";
import { simpleMerge, unresolvedTokens } from "./merge";
import type { Recipient, SendMode, SendResult, EmailTemplate } from "./types";

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
export const consoleAdapter: SendAdapter = {
  name: "console",
  async send(email) {
    console.log(
      `[email-pipeline] (console adapter) → ${email.to}: ${email.subject}`,
    );
    return {
      messageId: `console-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };
  },
};

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

const HEARTBEAT_EVERY = 25;

export async function sendCampaign(
  args: SendCampaignArgs,
): Promise<SendResult[]> {
  const mode = args.mode ?? "dry_run";
  const adapter = args.adapter ?? consoleAdapter;
  const merge = args.merge ?? simpleMerge;
  const minGapMs =
    mode === "send" ? Math.ceil(60000 / Math.max(1, args.ratePerMinute ?? 60)) : 0;

  const results: SendResult[] = [];
  let processed = 0;

  const settle = async (result: SendResult) => {
    results.push(result);
    await args.record?.(result);
  };

  for (const recipient of args.recipients) {
    const email = recipient.email;

    if (++processed % HEARTBEAT_EVERY === 0) await args.heartbeat?.();

    // 1) idempotency — never re-send to someone already sent (or mid-flight)
    if (args.alreadySent && (await args.alreadySent(email))) {
      await settle({ recipientEmail: email, status: "skipped" });
      continue;
    }
    // 2) suppression — honor unsubscribes/bounces
    if (args.isSuppressed && (await args.isSuppressed(email))) {
      await settle({ recipientEmail: email, status: "suppressed" });
      continue;
    }

    // 3) compliance vars + render
    const unsubscribeUrl = args.unsubscribeUrl(email);
    const rendered = merge(args.template, {
      ...recipient,
      vars: {
        ...recipient.vars,
        unsubscribeUrl,
        senderIdentity: args.senderIdentity,
      },
    });

    // 4) no-unresolved-token guard — never deliver a half-filled email
    const leftover = [
      ...unresolvedTokens(rendered.subject),
      ...unresolvedTokens(rendered.body),
    ];
    if (leftover.length > 0) {
      await settle({
        recipientEmail: email,
        status: "failed",
        error: `Unresolved tokens: ${[...new Set(leftover)].join(", ")}`,
      });
      continue;
    }

    // 5) dry-run stops here — rendered and recorded, but not delivered
    if (mode === "dry_run") {
      await settle({ recipientEmail: email, status: "dry_run" });
      continue;
    }

    // 6) reserve the address BEFORE the provider can act on it. A refused
    // claim is reported but deliberately NOT recorded: the existing row is
    // the evidence of the earlier pass, and overwriting it would erase the
    // very thing that stops a double delivery.
    if (args.claim && !(await args.claim(email))) {
      results.push({ recipientEmail: email, status: "skipped" });
      continue;
    }

    // 7) real send
    try {
      const { messageId } = await adapter.send({
        to: email,
        subject: rendered.subject,
        body: rendered.body,
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
          // RFC 8058: lets a mail client unsubscribe with a POST, so the link
          // never has to mutate state on a GET a scanner might prefetch.
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        ...(args.providerIdempotencyKey
          ? { idempotencyKey: args.providerIdempotencyKey(email) }
          : {}),
      });
      await settle({
        recipientEmail: email,
        status: "sent",
        providerMessageId: messageId,
      });
    } catch (err) {
      await settle({
        recipientEmail: email,
        status: "failed",
        error: err instanceof Error ? err.message : "send failed",
      });
    }
    if (minGapMs) await new Promise((res) => setTimeout(res, minGapMs));
  }
  return results;
}
