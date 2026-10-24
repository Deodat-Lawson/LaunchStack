/**
 * Shared guard for every connector route: verified workspace context +
 * `connectors.manage`. Connecting a provider hands its data to the shared
 * company knowledge base (or speaks for the company, in Slack's case), so it
 * is a workspace-administration action — same posture as the agent-knowledge
 * connector.
 */

import type { NextResponse } from "next/server";

import type { Locale } from "~/i18n/locales";
import { requestLocaleOrDefault } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import { createForbiddenError } from "~/lib/api-utils";
import { requireWorkspaceContext, type WorkspaceContext } from "~/lib/require-workspace-context";
import type { ConnectorProvider } from "~/server/db/schema/connectors";

export type ConnectorAdminResult =
    | { readonly ok: true; readonly ctx: WorkspaceContext }
    | { readonly ok: false; readonly response: NextResponse };

export async function requireConnectorAdmin(): Promise<ConnectorAdminResult> {
    const context = await requireWorkspaceContext();
    if (!context.success) return { ok: false, response: context.response };
    if (!context.data.can("connectors.manage")) {
        const t = translatorFor(await requestLocaleOrDefault(), "sources.server.connectors");
        return { ok: false, response: createForbiddenError(t("manageRequired")) };
    }
    return { ok: true, ctx: context.data };
}

const ENV_PAIRS: Record<ConnectorProvider, string> = {
    "google-drive": "GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET",
    slack: "SLACK_CLIENT_ID and SLACK_CLIENT_SECRET",
    github: "GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET",
    gmail: "GMAIL_CONNECTOR_ENABLED=true plus GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET",
    notion: "NOTION_OAUTH_CLIENT_ID and NOTION_OAUTH_CLIENT_SECRET",
    linkedin: "LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET",
    // Bluesky needs no app pair, only somewhere safe to keep the app password.
    bluesky: "",
};

/** The same variables as a list, for a language that does not join them with "and". */
const ENV_VARS: Record<ConnectorProvider, readonly string[]> = {
    "google-drive": ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"],
    slack: ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"],
    github: ["GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_SECRET"],
    gmail: ["GMAIL_CONNECTOR_ENABLED=true", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"],
    notion: ["NOTION_OAUTH_CLIENT_ID", "NOTION_OAUTH_CLIENT_SECRET"],
    linkedin: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
    bluesky: [],
};

/** In `locale` (English by default, as before). */
export function notConfiguredResponse(
    provider: ConnectorProvider,
    locale: Locale = "en"
): NextResponse {
    const pair = ENV_PAIRS[provider];
    const vars =
        locale === "en"
            ? `${pair ? `${pair} and ` : ""}EMBEDDING_SECRETS_KEY`
            : [...ENV_VARS[provider], "EMBEDDING_SECRETS_KEY"].join("、");
    return createForbiddenError(
        translatorFor(locale, "sources.server.connectors")("notConfigured", { provider, vars })
    );
}
