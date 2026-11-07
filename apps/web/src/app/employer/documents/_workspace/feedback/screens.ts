/**
 * The Feedback tab's screens and their paths. Plain data, so deep links —
 * the dialog's "View report", the bell, the webhook's triage link — are
 * pinned by tests.
 *
 *   /mine            what I reported, newest activity first (the tab's home)
 *   /mine/<id>       one of mine: its status and the team's replies
 *   /ideas           the shared board of feature requests, by votes
 *   /ideas/<id>      one request: vote, read the team's answer
 *   /triage          every report, for the instance's operators
 *   /triage/<id>     one report with everything that came with it
 */

import type { FeedbackScreen } from "~/lib/feedback/contract";

export const FEEDBACK_ROOTS = ["mine", "ideas", "triage"] as const;
export const FEEDBACK_HOME = "/mine";

export type FeedbackScreenState =
    | { kind: "list"; screen: FeedbackScreen }
    | { kind: "report"; screen: FeedbackScreen; id: number }
    | { kind: "not-found" };

export const feedbackPaths = {
    list: (screen: FeedbackScreen) => `/${screen}`,
    report: (screen: FeedbackScreen, id: number) => `/${screen}/${id}`,
};

function isScreen(segment: string | undefined): segment is FeedbackScreen {
    return segment === "mine" || segment === "ideas" || segment === "triage";
}

export function feedbackScreenFor(path: string): FeedbackScreenState {
    const [root, rest, extra] = path.split("/").filter(Boolean);
    if (extra !== undefined) return { kind: "not-found" };
    if (root === undefined) return { kind: "list", screen: "mine" };
    if (!isScreen(root)) return { kind: "not-found" };
    if (rest === undefined) return { kind: "list", screen: root };
    return /^\d+$/.test(rest)
        ? { kind: "report", screen: root, id: Number(rest) }
        : { kind: "not-found" };
}
