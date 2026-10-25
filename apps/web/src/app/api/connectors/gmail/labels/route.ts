/**
 * GET /api/connectors/gmail/labels — the caller's mailbox labels, live from
 * Gmail, for the label picker. System noise (UNREAD, SPAM, the CATEGORY_*
 * tabs) is left out; INBOX, SENT, STARRED and IMPORTANT stay because people
 * think in those.
 */

import { createGmailClient } from "@launchstack/pipelines/connectors/gmail";

import { requestTranslator } from "~/i18n/server";
import { createSuccessResponse, handleApiError } from "~/lib/api-utils";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { getGmailAccessToken } from "~/server/services/connectors/gmail/connections";
import {
    requireGmailWriter,
    requireOwnActiveGmailConnection,
} from "~/server/services/connectors/gmail/guard";

export const runtime = "nodejs";

/** `name` is the label's key in `sources.server.gmail.labels`, worded per reader. */
const SYSTEM_LABELS_SHOWN: Record<
    string,
    { name: "inbox" | "sent" | "starred" | "important"; order: number }
> = {
    INBOX: { name: "inbox", order: 0 },
    SENT: { name: "sent", order: 1 },
    STARRED: { name: "starred", order: 2 },
    IMPORTANT: { name: "important", order: 3 },
};

export async function GET(request: Request) {
    return withRateLimit(request, RateLimitPresets.standard, async () => {
        try {
            const guard = await requireGmailWriter();
            if (!guard.ok) return guard.response;
            const own = await requireOwnActiveGmailConnection(guard.ctx);
            if (!own.ok) return own.response;

            const t = requestTranslator(request, "sources.server.gmail.labels");
            const accessToken = await getGmailAccessToken(own.connection);
            const labels = await createGmailClient({ accessToken }).listLabels();

            const shown = labels
                .filter(label => label.type === "user" || SYSTEM_LABELS_SHOWN[label.id])
                .map(label => {
                    const system = SYSTEM_LABELS_SHOWN[label.id];
                    return {
                        id: label.id,
                        name: system ? t(system.name) : label.name,
                        system: label.type !== "user",
                    };
                })
                .sort((a, b) => {
                    const ao = SYSTEM_LABELS_SHOWN[a.id]?.order ?? 100;
                    const bo = SYSTEM_LABELS_SHOWN[b.id]?.order ?? 100;
                    return ao - bo || a.name.localeCompare(b.name);
                });

            return createSuccessResponse({ labels: shown });
        } catch (error) {
            return handleApiError(error, request);
        }
    });
}
