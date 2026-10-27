import { feedbackReportHref } from "~/lib/feedback/contract";
import { toolTargetFromHref } from "~/lib/tool-app/locations";
import {
    FEEDBACK_HOME,
    feedbackPaths,
    feedbackScreenFor,
} from "~/app/employer/documents/_workspace/feedback/screens";

/**
 * The Feedback tab's paths are what the dialog's "View report", the bell and
 * the webhook's triage link point at. Pinned here so a rename can't strand them.
 */
describe("feedback screens", () => {
    it("opens on My reports", () => {
        expect(FEEDBACK_HOME).toBe("/mine");
        expect(feedbackScreenFor("/")).toEqual({ kind: "list", screen: "mine" });
    });

    it.each([
        ["/mine", { kind: "list", screen: "mine" }],
        ["/ideas", { kind: "list", screen: "ideas" }],
        ["/triage", { kind: "list", screen: "triage" }],
        ["/mine/12", { kind: "report", screen: "mine", id: 12 }],
        ["/ideas/3", { kind: "report", screen: "ideas", id: 3 }],
        ["/triage/40", { kind: "report", screen: "triage", id: 40 }],
    ])("reads %s", (path, expected) => {
        expect(feedbackScreenFor(path)).toEqual(expected);
    });

    it.each(["/inbox", "/mine/abc", "/ideas/3/edit", "/triage/-1"])(
        "has no screen for %s",
        path => {
            expect(feedbackScreenFor(path)).toEqual({ kind: "not-found" });
        }
    );

    it("round-trips its own paths", () => {
        expect(feedbackScreenFor(feedbackPaths.report("ideas", 9))).toEqual({
            kind: "report",
            screen: "ideas",
            id: 9,
        });
    });

    it("links to a report as the workspace's Feedback tab at that screen", () => {
        const href = feedbackReportHref(7, "triage");
        expect(href.startsWith("/employer/documents?feature=feedback&at=")).toBe(true);
        expect(toolTargetFromHref(href)).toEqual({ toolId: "feedback", at: "/triage/7" });
    });
});
