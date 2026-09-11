import "server-only";

/**
 * Where this instance's users should go for help.
 *
 * The in-product contact page used to hardcode Launchstack's own support email
 * and Discord, and its form reported success without sending anything. Both
 * are wrong on a self-hosted instance: its users are not Launchstack's
 * customers, and a form that silently discards a bug report is worse than no
 * form at all.
 *
 * Server-side env rather than NEXT_PUBLIC_, so an operator running the
 * published image can set these without rebuilding. The page is a server
 * component that passes them down.
 */
export interface SupportChannels {
    /** Address the contact form composes to. Null hides the form entirely. */
    email: string | null;
    /** Community/chat link, if the operator runs one. */
    community: string | null;
    /** Where to file bugs. Defaults to this project's issue tracker. */
    issuesUrl: string;
    /** What users should expect. Null when the operator has not promised one. */
    responseTime: string | null;
}

const DEFAULT_ISSUES_URL = "https://github.com/Deodat-Lawson/LaunchStack/issues";

export function getSupportChannels(): SupportChannels {
    return {
        email: process.env.SUPPORT_CONTACT_EMAIL ?? null,
        community: process.env.SUPPORT_COMMUNITY_URL ?? null,
        issuesUrl: process.env.SUPPORT_ISSUES_URL ?? DEFAULT_ISSUES_URL,
        responseTime: process.env.SUPPORT_RESPONSE_TIME ?? null,
    };
}
