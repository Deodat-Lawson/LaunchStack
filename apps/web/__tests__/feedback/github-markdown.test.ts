import type { FeedbackDetail } from "~/lib/feedback/contract";
import { feedbackIssueMarkdown, feedbackIssueTitle } from "~/lib/feedback/github-markdown";

const REPORT: FeedbackDetail = {
    id: 42,
    kind: "bug",
    title: "Upload stops at 90%",
    body: "Dropped a 40 MB PDF.\nIt never finished.",
    status: "new",
    severity: "blocking",
    votes: 0,
    voted: false,
    mine: false,
    replies: 0,
    attachments: 1,
    createdAt: "2026-10-25T09:30:00.000Z",
    updatedAt: "2026-10-25T09:30:00.000Z",
    reporter: { name: "Ada Lovelace", email: "ada@example.com" },
    workspaceName: "Acme | Secret",
    context: {
        path: "/employer/documents?feature=knowledge",
        appVersion: "abc1234",
        browser: "Chrome 141 on macOS",
        viewport: { width: 1440, height: 900 },
        theme: "dark",
        locale: "en",
        recentErrors: [{ message: "TypeError: x | y", source: "error", at: "2026-10-25T09:29:00Z" }],
        origin: { jobId: "job-77" },
    },
    attachmentList: [
        { id: 1, url: "/api/feedback/42/attachments/1", contentType: "image/webp", width: 10, height: 10 },
    ],
    thread: [],
    canReply: true,
    canTriage: true,
};

describe("Copy as GitHub issue", () => {
    it("prefixes the title the way the repository's templates do", () => {
        expect(feedbackIssueTitle(REPORT)).toBe("[bug]: Upload stops at 90%");
        expect(feedbackIssueTitle({ kind: "idea", title: "Export chats" })).toBe(
            "[feat]: Export chats"
        );
    });

    it("carries the report and its context", () => {
        const md = feedbackIssueMarkdown(REPORT);
        expect(md).toContain("## Summary");
        expect(md).toContain("Dropped a 40 MB PDF.\nIt never finished.");
        expect(md).toContain("**Severity:** Blocking");
        expect(md).toContain("in-app feedback #42");
        expect(md).toContain("| Page | `/employer/documents?feature=knowledge` |");
        expect(md).toContain("| App version | `abc1234` |");
        expect(md).toContain("| jobId | `job-77` |");
        expect(md).toContain("Recent errors in the page (1)");
        expect(md).toContain("1 screenshot attached");
    });

    it("leaves out who reported it and where — a public tracker is the wrong place", () => {
        const md = feedbackIssueMarkdown(REPORT);
        expect(md).not.toContain("Ada");
        expect(md).not.toContain("ada@example.com");
        expect(md).not.toContain("Acme");
    });

    it("keeps table cells intact when a value has a pipe", () => {
        const md = feedbackIssueMarkdown({
            ...REPORT,
            context: { browser: "Weird | Browser" },
        });
        expect(md).toContain("| Browser | Weird \\| Browser |");
    });

    it("says so when there are no details", () => {
        expect(feedbackIssueMarkdown({ ...REPORT, body: "", context: undefined })).toContain(
            "_No details given._"
        );
    });
});
