/**
 * The investor-search tool's environment reads — the only module in this
 * tool allowed to touch process.env (lint-enforced). Read at call time so the
 * tool works in any Node host.
 */

/**
 * SEC fair-access policy: every automated request declares who is asking as
 * "<name> <contact email>". A User-Agent without an email, or with anything
 * else around it, is answered 403. An operator sets their own contact.
 */
export const DEFAULT_SEC_USER_AGENT = "LaunchStack investors@launchstack.dev";

export function getSecUserAgent(): string {
    const configured = process.env.SEC_EDGAR_USER_AGENT?.trim();
    // An empty value in a .env file means unset, not "send no User-Agent".
    if (configured) return configured;
    return DEFAULT_SEC_USER_AGENT;
}
