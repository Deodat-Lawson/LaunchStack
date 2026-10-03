import { parseToolHref } from "~/lib/tool-app/locations";

/**
 * Which Vantage screen an app-relative href shows. Plain data, no React, so
 * the whole table — every path, the `?week=` an agenda link carries, the
 * program gate — is pinned by a unit test instead of by clicking around.
 *
 * These are the routes the app had when it was its own page tree
 * (`/employer/tools/vantage/...`), one for one.
 */
export type VantageScreen =
    | { kind: "overview" }
    | { kind: "agenda"; week: string | null }
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
export const VANTAGE_ROOTS = ["agenda", "commitments", "evidence", "metrics", "program"] as const;

/** Whether the person may open Triage: still loading, yes, or no. */
export type ProgramAccess = "pending" | "allowed" | "denied";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function vantageScreenFor(href: string, program: ProgramAccess = "allowed"): VantageScreen {
    const { path, search } = parseToolHref(href);
    switch (path) {
        case "/":
            return { kind: "overview" };
        case "/agenda": {
            // A malformed week falls back to the default week, as the API does.
            const week = new URLSearchParams(search).get("week");
            return { kind: "agenda", week: week && ISO_DATE.test(week) ? week : null };
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
