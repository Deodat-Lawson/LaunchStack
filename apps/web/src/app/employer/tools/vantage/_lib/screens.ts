import { parseToolHref } from "~/lib/tool-app/locations";

/**
 * Which Vantage screen an app-relative href shows. Plain data, no React, so
 * the whole table — every path, the selected `?week=`, the
 * program gate — is pinned by a unit test instead of by clicking around.
 *
 * Context owns generation setup. The old /agenda path remains a Context
 * alias, while This Week owns generated reports and decisions.
 */
export type VantageScreen =
    | { kind: "overview"; week: string | null }
    | { kind: "context"; week: string | null }
    | { kind: "commitments" }
    | { kind: "evidence" }
    | { kind: "metrics" }
    | { kind: "triage" }
    /** Triage, before the permissions answer has arrived: show nothing yet rather than a refusal. */
    | { kind: "triage-pending" }
    /** Triage, for someone without `settings.manage`. */
    | { kind: "triage-denied" }
    | { kind: "not-found" };

/** First path segments that are Vantage screens; the tab's `roots`. */
export const VANTAGE_ROOTS = [
    "context",
    "agenda",
    "commitments",
    "evidence",
    "metrics",
    "program",
] as const;

/** Whether the person may open Triage: still loading, yes, or no. */
export type ProgramAccess = "pending" | "allowed" | "denied";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function vantageScreenFor(href: string, program: ProgramAccess = "allowed"): VantageScreen {
    const { path, search } = parseToolHref(href);
    const requestedWeek = new URLSearchParams(search).get("week");
    const week = requestedWeek && ISO_DATE.test(requestedWeek) ? requestedWeek : null;
    switch (path) {
        case "/":
            return { kind: "overview", week };
        case "/context":
        case "/agenda": {
            // A malformed week falls back to the default week, as the API does.
            return { kind: "context", week };
        }
        case "/commitments":
            return { kind: "commitments" };
        case "/evidence":
            return { kind: "evidence" };
        case "/metrics":
            return { kind: "metrics" };
        case "/program":
            return program === "allowed"
                ? { kind: "triage" }
                : program === "pending"
                  ? { kind: "triage-pending" }
                  : { kind: "triage-denied" };
        default:
            return { kind: "not-found" };
    }
}
