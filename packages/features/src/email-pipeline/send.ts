import type { MergeFn, SendAdapter } from "./contracts";
import { simpleMerge, unresolvedTokens } from "./merge";
import type { Recipient, SendMode, SendResult, EmailTemplate } from "./types";

/**
 * Send adapter + the safety wrapper. The pipeline never sends "raw" — every
 * recipient passes through idempotency, suppression, per-recipient render,
 * a no-unresolved-token guard, and (for real sends) rate limiting.
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
  unsubscribeBaseUrl: string;
  /** Suppression + idempotency hooks (DB-backed in run.ts). */
  isSuppressed?: (email: string) => boolean | Promise<boolean>;
  alreadySent?: (email: string) => boolean | Promise<boolean>;
  /** Real-send throttle. */
  ratePerMinute?: number;
}

export async function sendCampaign(
  args: SendCampaignArgs,
): Promise<SendResult[]> {
  const mode = args.mode ?? "dry_run";
  const adapter = args.adapter ?? consoleAdapter;
  const merge = args.merge ?? simpleMerge;
  const minGapMs =
    mode === "send" ? Math.ceil(60000 / Math.max(1, args.ratePerMinute ?? 60)) : 0;

  const results: SendResult[] = [];
  for (const recipient of args.recipients) {
    const email = recipient.email;

    // 1) idempotency — never re-send to someone already sent in this campaign
    if (args.alreadySent && (await args.alreadySent(email))) {
      results.push({ recipientEmail: email, status: "skipped" });
      continue;
    }
    // 2) suppression — honor unsubscribes/bounces
    if (args.isSuppressed && (await args.isSuppressed(email))) {
      results.push({ recipientEmail: email, status: "suppressed" });
      continue;
    }

    // 3) compliance vars + render
    const unsubscribeUrl = `${args.unsubscribeBaseUrl.replace(/\/+$/, "")}/${encodeURIComponent(email)}`;
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
      results.push({
        recipientEmail: email,
        status: "failed",
        error: `Unresolved tokens: ${[...new Set(leftover)].join(", ")}`,
      });
      continue;
    }

    // 5) dry-run stops here — rendered and recorded, but not delivered
    if (mode === "dry_run") {
      results.push({ recipientEmail: email, status: "dry_run" });
      continue;
    }

    // 6) real send
    try {
      const { messageId } = await adapter.send({
        to: email,
        subject: rendered.subject,
        body: rendered.body,
        headers: { "List-Unsubscribe": `<${unsubscribeUrl}>` },
      });
      results.push({
        recipientEmail: email,
        status: "sent",
        providerMessageId: messageId,
      });
    } catch (err) {
      results.push({
        recipientEmail: email,
        status: "failed",
        error: err instanceof Error ? err.message : "send failed",
      });
    }
    if (minGapMs) await new Promise((res) => setTimeout(res, minGapMs));
  }
  return results;
}
