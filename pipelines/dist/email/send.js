import { simpleMerge } from "./merge.js";
import { hasErrors, validateRendered } from "./validators.js";
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
export const consoleAdapter = {
    name: "console",
    async send(email) {
        console.log(`[email-pipeline] (console adapter) → ${email.to}: ${email.subject}`);
        return {
            messageId: `console-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        };
    },
};
/**
 * Time-based, not count-based: a count-based cadence at a slow ratePerMinute
 * could outlast the recovery window and get a LIVE attempt reclaimed — the
 * exact double-delivery the heartbeat exists to prevent.
 */
const HEARTBEAT_INTERVAL_MS = 30_000;
export async function sendCampaign(args) {
    const mode = args.mode ?? "dry_run";
    const adapter = args.adapter ?? consoleAdapter;
    const merge = args.merge ?? simpleMerge;
    const minGapMs = mode === "send" ? Math.ceil(60000 / Math.max(1, args.ratePerMinute ?? 60)) : 0;
    const results = [];
    let lastHeartbeat = Date.now();
    const settle = async (result) => {
        results.push(result);
        await args.record?.(result);
    };
    for (const recipient of args.recipients) {
        const email = recipient.email;
        if (Date.now() - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
            lastHeartbeat = Date.now();
            await args.heartbeat?.();
        }
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
        // 4) deterministic render guard — never deliver a half-filled email, a
        // CRLF-bearing subject (header injection via recipient data), or a body
        // missing its unsubscribe link / sender identity.
        const renderIssues = validateRendered(rendered, {
            unsubscribeUrl,
            senderIdentity: args.senderIdentity,
        });
        if (hasErrors(renderIssues)) {
            await settle({
                recipientEmail: email,
                status: "failed",
                subject: rendered.subject,
                error: renderIssues
                    .filter(i => i.severity === "error")
                    .map(i => i.message)
                    .join(" "),
            });
            continue;
        }
        // 5) dry-run stops here — rendered and recorded, but not delivered
        if (mode === "dry_run") {
            await settle({
                recipientEmail: email,
                status: "dry_run",
                subject: rendered.subject,
            });
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
                subject: rendered.subject,
                providerMessageId: messageId,
            });
        }
        catch (err) {
            await settle({
                recipientEmail: email,
                status: "failed",
                subject: rendered.subject,
                error: err instanceof Error ? err.message : "send failed",
            });
        }
        if (minGapMs)
            await new Promise(res => setTimeout(res, minGapMs));
    }
    return results;
}
//# sourceMappingURL=send.js.map