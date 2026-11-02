/**
 * What each reader is shown of a report. The privacy rules live here: a
 * board reader never learns who filed an idea, what their page looked like or
 * what they attached; emails only ever reach triagers.
 */

jest.mock("server-only", () => ({}), { virtual: true });

import {
    awaitingReply,
    presentDetail,
    presentListItem,
    type AttachmentFacts,
    type FeedbackViewer,
    type ReplyFacts,
    type ReportDetailFacts,
} from "~/server/feedback/present";
import type { FeedbackPersonRecord } from "~/server/feedback/people";

const ADA = "auth-ada"; // filed it
const OPS = "auth-ops"; // triager
const BOB = "auth-bob"; // reads the board

const people = new Map<string, FeedbackPersonRecord>([
    [ADA, { name: "Ada", email: "ada@example.com" }],
    [OPS, { name: "Olu from Ops", email: "ops@example.com" }],
    [BOB, { name: "Bob", email: "bob@example.com" }],
]);

const reporter: FeedbackViewer = { authUserId: ADA, triager: false };
const triager: FeedbackViewer = { authUserId: OPS, triager: true };
const reader: FeedbackViewer = { authUserId: BOB, triager: false };

const at = (minute: number) => new Date(Date.UTC(2026, 9, 25, 12, minute));

const idea: ReportDetailFacts = {
    id: 7,
    kind: "idea",
    title: "Dark mode for exports",
    body: "Exports are blinding.",
    status: "planned",
    severity: "blocking", // never shown for an idea
    votes: 3,
    voted: true,
    reporterUserId: ADA,
    workspaceName: "Acme",
    replies: 2,
    attachments: 1,
    lastReplyFromTeam: true,
    createdAt: at(0),
    lastActivityAt: at(30),
    context: { path: "/employer/documents", url: "https://app/x?secret", appVersion: "abc123" },
};

const thread: ReplyFacts[] = [
    { id: 1, authorUserId: ADA, fromTeam: false, body: "Any news?", createdAt: at(10) },
    { id: 2, authorUserId: OPS, fromTeam: true, body: "Planned for Q4.", createdAt: at(30) },
];

const screenshots: AttachmentFacts[] = [
    { id: 11, contentType: "image/webp", width: 1280, height: 800 },
];

describe("someone reading another person's idea on the board", () => {
    const detail = presentDetail(idea, thread, screenshots, reader, people);

    it("never learns who filed it, their page, or their screenshots", () => {
        expect(detail.reporter).toBeUndefined();
        expect(detail.workspaceName).toBeUndefined();
        expect(detail.awaitingReply).toBeUndefined();
        expect(detail.context).toBeUndefined();
        expect(detail.attachmentList).toBeUndefined();
        expect(detail.attachments).toBe(0);
        expect(JSON.stringify(detail)).not.toContain("ada@example.com");
        expect(JSON.stringify(detail)).not.toContain('"Ada"');
        expect(JSON.stringify(detail)).not.toContain("secret");
    });

    it("sees the requester's replies unnamed and the team's by the triager's name, without emails", () => {
        expect(detail.thread.map(reply => [reply.fromTeam, reply.author, reply.mine])).toEqual([
            [false, { name: "" }, false],
            [true, { name: "Olu from Ops" }, false],
        ]);
    });

    it("may read and vote, not reply or triage", () => {
        expect(detail).toMatchObject({
            mine: false,
            voted: true,
            votes: 3,
            canReply: false,
            canTriage: false,
            severity: null,
            body: "Exports are blinding.",
        });
    });
});

describe("the reporter", () => {
    const detail = presentDetail(idea, thread, screenshots, reporter, people);

    it("sees their own context and screenshots, but not the triage-only fields", () => {
        expect(detail.mine).toBe(true);
        expect(detail.context).toEqual(idea.context);
        expect(detail.attachmentList).toEqual([
            {
                id: 11,
                url: "/api/feedback/7/attachments/11",
                contentType: "image/webp",
                width: 1280,
                height: 800,
            },
        ]);
        expect(detail.attachments).toBe(1);
        expect(detail.reporter).toBeUndefined();
        expect(detail.awaitingReply).toBeUndefined();
        expect(detail.canReply).toBe(true);
        expect(detail.canTriage).toBe(false);
    });

    it("sees names but no emails in the thread", () => {
        expect(detail.thread.map(reply => [reply.author, reply.mine])).toEqual([
            [{ name: "Ada" }, true],
            [{ name: "Olu from Ops" }, false],
        ]);
    });
});

describe("a triager", () => {
    const detail = presentDetail(idea, thread, screenshots, triager, people);

    it("sees everything, emails included", () => {
        expect(detail.reporter).toEqual({ name: "Ada", email: "ada@example.com" });
        expect(detail.workspaceName).toBe("Acme");
        expect(detail.awaitingReply).toBe(false);
        expect(detail.context).toEqual(idea.context);
        expect(detail.attachmentList).toHaveLength(1);
        expect(detail.canReply).toBe(true);
        expect(detail.canTriage).toBe(true);
        expect(detail.thread.map(reply => reply.author)).toEqual([
            { name: "Ada", email: "ada@example.com" },
            { name: "Olu from Ops", email: "ops@example.com" },
        ]);
        expect(detail.thread[1]!.mine).toBe(true);
    });

    it("reads a bug's severity and the timestamps as ISO strings", () => {
        const bug = presentListItem(
            { ...idea, kind: "bug", severity: "annoying" },
            triager,
            people
        );
        expect(bug.severity).toBe("annoying");
        expect(bug.createdAt).toBe("2026-10-25T12:00:00.000Z");
        expect(bug.updatedAt).toBe("2026-10-25T12:30:00.000Z");
    });

    it("gets an empty name, not a crash, for someone with no account left", () => {
        const item = presentListItem({ ...idea, reporterUserId: "auth-gone" }, triager, people);
        expect(item.reporter).toEqual({ name: "", email: "" });
    });
});

describe("awaitingReply", () => {
    it("is the reporter's turn when the last word is theirs", () => {
        expect(awaitingReply({ lastReplyFromTeam: false, status: "planned" })).toBe(true);
        expect(awaitingReply({ lastReplyFromTeam: true, status: "new" })).toBe(false);
    });

    it("with no replies, waits only while the report is new", () => {
        expect(awaitingReply({ lastReplyFromTeam: null, status: "new" })).toBe(true);
        expect(awaitingReply({ lastReplyFromTeam: null, status: "done" })).toBe(false);
    });
});
