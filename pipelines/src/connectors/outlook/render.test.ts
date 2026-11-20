import { describe, expect, it } from "vitest";

import { threadFingerprint } from "../gmail/render";
import type { OutlookMessage } from "./client";
import {
    conversationFingerprint,
    conversationFolderNames,
    conversationLink,
    conversationMessages,
    messageBodyText,
    renderConversation,
    stripOutlookQuotedReply,
    toAttachmentRef,
} from "./render";

function message(overrides: Partial<OutlookMessage> & { id: string }): OutlookMessage {
    return {
        conversationId: "c1",
        subject: "Quarterly plan",
        from: { emailAddress: { name: "Ada Lovelace", address: "ada@example.com" } },
        toRecipients: [{ emailAddress: { name: "Bob", address: "bob@example.com" } }],
        receivedDateTime: "2026-09-01T09:00:00Z",
        body: { contentType: "text", content: "Hello." },
        webLink: `https://outlook.office.com/mail/id/${overrides.id}`,
        ...overrides,
    };
}

describe("stripOutlookQuotedReply", () => {
    it("cuts at Outlook's underscore rule and header block", () => {
        const text = [
            "Agreed, ship it.",
            "",
            "________________________________",
            "From: Bob <bob@example.com>",
            "Sent: Monday, August 31, 2026 4:00 PM",
            "To: Ada",
            "Subject: Quarterly plan",
            "",
            "Shall we ship?",
        ].join("\r\n");

        expect(stripOutlookQuotedReply(text)).toBe("Agreed, ship it.");
    });

    it("cuts at a bare From/Sent header block", () => {
        const text = "Thanks!\n\nFrom: Bob\nSent: Monday\nTo: Ada\n\nOriginal words";

        expect(stripOutlookQuotedReply(text)).toBe("Thanks!");
    });

    it("still trims the styles Gmail's trimmer knows", () => {
        expect(
            stripOutlookQuotedReply("Yes.\n\nOn Mon, Aug 31, 2026 Bob wrote:\n> Shall we?\n> Now?")
        ).toBe("Yes.");
        expect(
            stripOutlookQuotedReply("Yes.\n\n-----Original Message-----\nFrom: Bob\nShall we?")
        ).toBe("Yes.");
    });

    it("leaves ordinary prose that mentions From: alone", () => {
        const text = "From: the desk of Ada\nThe plan is attached.\n\nA line of ____ is fine too.";

        expect(stripOutlookQuotedReply(text)).toBe(text);
    });

    it("keeps a message that is nothing but a forwarded block", () => {
        const text = "From: Bob\nSent: Monday\n\nForwarded words";

        expect(stripOutlookQuotedReply(text)).toBe(text);
    });
});

describe("conversation helpers", () => {
    it("drops drafts and orders oldest first", () => {
        const ordered = conversationMessages([
            message({ id: "m3", receivedDateTime: "2026-09-03T09:00:00Z" }),
            message({ id: "draft", receivedDateTime: "2026-09-04T09:00:00Z", isDraft: true }),
            message({ id: "m1", receivedDateTime: "2026-09-01T09:00:00Z" }),
            message({ id: "m2", receivedDateTime: null, sentDateTime: "2026-09-02T09:00:00Z" }),
        ]);

        expect(ordered.map(entry => entry.id)).toEqual(["m1", "m2", "m3"]);
    });

    it("fingerprints a message set exactly as Gmail threads are", () => {
        expect(conversationFingerprint(["b", "a"])).toBe(threadFingerprint(["a", "b"]));
        expect(conversationFingerprint(["a", "b"])).toMatch(/^msgs:[0-9a-f]{64}$/);
        expect(conversationFingerprint(["a", "b"])).not.toBe(conversationFingerprint(["a", "c"]));
    });

    it("links to the newest non-draft message", () => {
        expect(
            conversationLink([
                message({ id: "old", receivedDateTime: "2026-09-01T09:00:00Z" }),
                message({ id: "new", receivedDateTime: "2026-09-02T09:00:00Z" }),
                message({ id: "draft", receivedDateTime: "2026-09-03T09:00:00Z", isDraft: true }),
            ])
        ).toBe("https://outlook.office.com/mail/id/new");
        expect(conversationLink([])).toBeNull();
    });

    it("converts an HTML body a server sent despite the Prefer header", () => {
        expect(
            messageBodyText(
                message({
                    id: "h",
                    body: { contentType: "html", content: "<p>Hello <b>there</b></p><p>Bye</p>" },
                })
            )
        ).toBe("Hello there\nBye");
        expect(messageBodyText(message({ id: "p", body: undefined, bodyPreview: "Preview" }))).toBe(
            "Preview"
        );
    });

    it("names user folders and hides the ones every mailbox has", () => {
        const folders = new Map([
            ["f-inbox", { displayName: "Inbox", wellKnownName: "inbox" }],
            ["f-sent", { displayName: "Sent Items", wellKnownName: "sentitems" }],
            ["f-deals", { displayName: "Deals" }],
        ]);

        expect(
            conversationFolderNames(
                [
                    message({ id: "1", parentFolderId: "f-inbox" }),
                    message({ id: "2", parentFolderId: "f-sent" }),
                    message({ id: "3", parentFolderId: "f-deals" }),
                    message({ id: "4", parentFolderId: "f-unknown" }),
                ],
                folders
            )
        ).toEqual(["Deals"]);
    });
});

describe("renderConversation", () => {
    it("renders one Markdown document, oldest first, with a header and per-message sections", () => {
        const rendered = renderConversation({
            conversationId: "c1",
            messages: [
                message({
                    id: "m2",
                    subject: "RE: Quarterly plan",
                    from: { emailAddress: { name: "Bob", address: "bob@example.com" } },
                    toRecipients: [
                        { emailAddress: { name: "Ada Lovelace", address: "ada@example.com" } },
                    ],
                    ccRecipients: [{ emailAddress: { address: "cfo@example.com" } }],
                    receivedDateTime: "2026-09-02T10:30:00Z",
                    body: {
                        contentType: "text",
                        content:
                            "Looks good.\n\nFrom: Ada Lovelace\nSent: Tuesday\n\nDraft plan attached.",
                    },
                }),
                message({
                    id: "m1",
                    hasAttachments: true,
                    body: { contentType: "text", content: "Draft plan attached." },
                }),
            ],
            attachments: new Map([
                [
                    "m1",
                    [
                        toAttachmentRef("m1", {
                            id: "a1",
                            name: "plan.docx",
                            contentType: "application/octet-stream",
                            size: 2048,
                        }),
                        toAttachmentRef("m1", {
                            id: "a2",
                            name: "image001.png",
                            contentType: "image/png",
                            size: 10,
                            isInline: true,
                        }),
                    ],
                ],
            ]),
        });

        expect(rendered.markdown).toBe(
            [
                "# Quarterly plan",
                "",
                "Outlook conversation · 2 messages · Ada Lovelace <ada@example.com>, Bob <bob@example.com> · 2026-09-01 09:00 UTC – 2026-09-02 10:30 UTC",
                "Source: https://outlook.office.com/mail/id/m2",
                "",
                "---",
                "",
                "## Ada Lovelace <ada@example.com> · 2026-09-01 09:00 UTC",
                "",
                "**To:** Bob <bob@example.com>  ",
                "",
                "Draft plan attached.",
                "",
                "**Attachments:** plan.docx (2 KB)",
                "",
                "---",
                "",
                "## Bob <bob@example.com> · 2026-09-02 10:30 UTC",
                "",
                "**To:** Ada Lovelace <ada@example.com>  ",
                "**Cc:** cfo@example.com  ",
                "",
                "Looks good.",
                "",
            ].join("\n")
        );
        expect(rendered.subject).toBe("Quarterly plan");
        expect(rendered.link).toBe("https://outlook.office.com/mail/id/m2");
        expect(rendered.firstMessageAt).toBe("2026-09-01T09:00:00.000Z");
        expect(rendered.lastMessageAt).toBe("2026-09-02T10:30:00.000Z");
        expect(rendered.attachments.map(ref => ref.attachmentId)).toEqual(["a1"]);
        expect(rendered.inlineAttachments.map(ref => ref.attachmentId)).toEqual(["a2"]);
    });

    it("renders nothing but a header for a conversation of drafts", () => {
        const rendered = renderConversation({
            conversationId: "c1",
            messages: [message({ id: "d", isDraft: true })],
        });

        expect(rendered.messages).toEqual([]);
        expect(rendered.subject).toBe("(no subject)");
        expect(rendered.link).toBeNull();
    });
});
