import { describe, expect, it } from "vitest";

import type { GmailMessage, GmailPart, GmailThread } from "./client";
import {
    cleanSubject,
    extractMessageBody,
    htmlToText,
    listMessageAttachments,
    renderThread,
    stripQuotedReply,
    threadFingerprint,
} from "./render";

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");

function part(mimeType: string, text: string, extra: Partial<GmailPart> = {}): GmailPart {
    return { mimeType, body: { data: b64(text), size: text.length }, ...extra };
}

function message(input: {
    id: string;
    from: string;
    subject?: string;
    date: string;
    text?: string;
    html?: string;
    labels?: string[];
    to?: string;
    parts?: GmailPart[];
}): GmailMessage {
    const parts: GmailPart[] = [];
    if (input.text !== undefined) parts.push(part("text/plain", input.text, { partId: "0" }));
    if (input.html !== undefined) parts.push(part("text/html", input.html, { partId: "1" }));
    for (const extra of input.parts ?? []) parts.push(extra);
    return {
        id: input.id,
        threadId: "t1",
        labelIds: input.labels ?? ["INBOX"],
        internalDate: String(Date.parse(input.date)),
        payload: {
            mimeType: "multipart/mixed",
            headers: [
                { name: "From", value: input.from },
                { name: "To", value: input.to ?? "team@example.com" },
                { name: "Subject", value: input.subject ?? "Hello" },
                { name: "Date", value: input.date },
            ],
            parts,
        },
    };
}

describe("htmlToText", () => {
    it("turns block boundaries into newlines, keeps link targets, decodes entities", () => {
        const text = htmlToText(
            '<div>Hi<br>there</div><p>See <a href="https://x.test/a">the doc</a> &amp; reply</p>' +
                "<style>p{}</style><script>alert(1)</script>"
        );
        expect(text).toBe("Hi\nthere\nSee the doc (https://x.test/a) & reply");
    });

    it("drops quoted blocks", () => {
        expect(htmlToText("<p>New</p><blockquote>old stuff</blockquote>")).toBe("New");
    });
});

describe("extractMessageBody", () => {
    it("prefers text/plain, falls back to html", () => {
        const both = message({
            id: "m",
            from: "a@x",
            date: "2026-09-01",
            text: "plain",
            html: "<b>html</b>",
        });
        expect(extractMessageBody(both.payload)).toEqual({ text: "plain", source: "text" });
        const only = message({ id: "m", from: "a@x", date: "2026-09-01", html: "<b>html</b>" });
        expect(extractMessageBody(only.payload)).toEqual({ text: "html", source: "html" });
        expect(extractMessageBody(undefined)).toEqual({ text: "", source: "none" });
    });

    it("ignores text parts that are attachments", () => {
        const withAttachment = message({
            id: "m",
            from: "a@x",
            date: "2026-09-01",
            html: "<p>body</p>",
            parts: [part("text/plain", "notes", { filename: "notes.txt", partId: "2" })],
        });
        expect(extractMessageBody(withAttachment.payload).text).toBe("body");
    });
});

describe("stripQuotedReply", () => {
    it("removes the trailing quote and its introducer, keeps the reply", () => {
        const text = [
            "Thanks, sounds good.",
            "",
            "On Mon, Sep 1, 2026 Ada wrote:",
            "> original",
            "> more",
        ].join("\n");
        expect(stripQuotedReply(text)).toBe("Thanks, sounds good.");
    });

    it("cuts at an Outlook separator and leaves unquoted text alone", () => {
        expect(stripQuotedReply("Reply\n\n-----Original Message-----\nFrom: x")).toBe("Reply");
        expect(stripQuotedReply("Just text\nwith lines")).toBe("Just text\nwith lines");
    });
});

describe("threadFingerprint", () => {
    it("is order-independent and changes when a message is added", () => {
        expect(threadFingerprint(["b", "a"])).toBe(threadFingerprint(["a", "b"]));
        expect(threadFingerprint(["a"])).not.toBe(threadFingerprint(["a", "b"]));
        expect(threadFingerprint(["a"])).toMatch(/^msgs:[0-9a-f]{64}$/);
    });
});

describe("renderThread", () => {
    const thread: GmailThread = {
        id: "t1",
        messages: [
            message({
                id: "m2",
                from: "Bob <bob@example.com>",
                subject: "Re: Fwd: Term sheet",
                date: "2026-09-02T10:00:00Z",
                text: "Looks fine to me.\n\nOn Tue Ada wrote:\n> Please review",
                labels: ["INBOX", "Label_1", "UNREAD"],
                parts: [
                    {
                        partId: "2",
                        mimeType: "application/pdf",
                        filename: "term-sheet.pdf",
                        body: { attachmentId: "att-1", size: 2048 },
                    },
                ],
            }),
            message({
                id: "m1",
                from: "Ada Lovelace <ada@example.com>",
                subject: "Term sheet",
                date: "2026-09-01T09:00:00Z",
                text: "Please review",
                labels: ["SENT", "Label_1"],
            }),
            message({
                id: "d1",
                from: "ada@example.com",
                date: "2026-09-03T09:00:00Z",
                text: "unfinished",
                labels: ["DRAFT"],
            }),
        ],
    };

    it("orders messages, drops drafts, cleans the subject, maps labels, lists attachments", () => {
        const rendered = renderThread({
            thread,
            labelNames: new Map([["Label_1", "Investors"]]),
            accountEmail: "ada@example.com",
        });
        expect(rendered.subject).toBe("Term sheet");
        expect(rendered.messages.map(m => m.id)).toEqual(["m1", "m2"]);
        expect(rendered.labels).toEqual(["Investors"]);
        expect(rendered.participants).toEqual([
            "Ada Lovelace <ada@example.com>",
            "Bob <bob@example.com>",
        ]);
        expect(rendered.attachments.map(a => a.filename)).toEqual(["term-sheet.pdf"]);

        const md = rendered.markdown;
        expect(md.startsWith("# Term sheet\n")).toBe(true);
        expect(md).toContain("Gmail thread · 2 messages");
        expect(md).toContain("Labels: Investors");
        expect(md).toContain("authuser=ada%40example.com#all/t1");
        expect(md).toContain("## Ada Lovelace <ada@example.com>");
        expect(md).toContain("Please review");
        expect(md).toContain("Looks fine to me.");
        expect(md).not.toContain("> Please review");
        expect(md).not.toContain("unfinished");
        expect(md).toContain("**Attachments:** term-sheet.pdf (2 KB)");
    });

    it("enumerates attachments with either an attachment id or inline bytes", () => {
        const refs = listMessageAttachments(thread.messages![0]!);
        expect(refs).toEqual([
            {
                messageId: "m2",
                partId: "2",
                filename: "term-sheet.pdf",
                mimeType: "application/pdf",
                size: 2048,
                attachmentId: "att-1",
                inlineData: null,
            },
        ]);
    });

    it("cleans reply prefixes", () => {
        expect(cleanSubject("RE: re: Fwd:  Hello   world")).toBe("Hello world");
        expect(cleanSubject("")).toBe("(no subject)");
        expect(cleanSubject(undefined)).toBe("(no subject)");
    });
});
