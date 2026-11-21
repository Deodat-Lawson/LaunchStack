import { describe, expect, it } from "vitest";

import type {
    DiscoveredKnowledgeItem,
    KnowledgeItem,
    KnowledgeSink,
    StoredKnowledgeItem,
} from "../types";
import {
    OutlookApiError,
    OutlookAuthError,
    OutlookDeltaExpiredError,
    OutlookNotFoundError,
    type OutlookAttachment,
    type OutlookClient,
    type OutlookDeltaPage,
    type OutlookMailFolder,
    type OutlookMessage,
    type OutlookMessageRef,
    type OutlookMessageRefPage,
    type OutlookUser,
} from "./client";
import { listOutlookFolderTree } from "./discover";
import { syncOutlook } from "./sync";

function message(input: {
    id: string;
    conversationId: string;
    from: string;
    subject: string;
    date: string;
    text: string;
    isDraft?: boolean;
    hasAttachments?: boolean;
}): OutlookMessage {
    return {
        id: input.id,
        conversationId: input.conversationId,
        subject: input.subject,
        from: {
            emailAddress: { name: input.from, address: `${input.from.toLowerCase()}@example.com` },
        },
        toRecipients: [{ emailAddress: { name: "Me", address: "me@example.com" } }],
        receivedDateTime: input.date,
        sentDateTime: input.date,
        isDraft: input.isDraft ?? false,
        hasAttachments: input.hasAttachments ?? false,
        body: { contentType: "text", content: input.text },
        webLink: `https://outlook.office.com/mail/id/${input.id}`,
    };
}

interface Change {
    readonly seq: number;
    readonly folderId: string;
    readonly id: string;
    readonly removed: boolean;
}

/** An in-memory mailbox that counts what the sync asks of it. */
class FakeMailbox implements OutlookClient {
    profile: OutlookUser = { id: "u1", mail: "me@example.com", userPrincipalName: "me@corp.test" };
    folders: OutlookMailFolder[] = [
        { id: "inbox-id", displayName: "Inbox", wellKnownName: "inbox", childFolderCount: 0 },
        { id: "f-investors", displayName: "Investors", childFolderCount: 1 },
    ];
    childFolders = new Map<string, OutlookMailFolder[]>([
        ["f-investors", [{ id: "f-seed", displayName: "Seed", parentFolderId: "f-investors" }]],
    ]);
    messages = new Map<string, OutlookMessage>();
    attachments = new Map<string, OutlookAttachment[]>();
    attachmentBytes = new Map<string, string>();
    /** Delta links issued before this sequence number have expired. */
    expiredBefore = 0;
    pageSize = 50;
    authDead = false;
    calls: string[] = [];
    private changes: Change[] = [];
    private seq = 0;

    add(folderId: string, entry: OutlookMessage) {
        this.messages.set(entry.id, { ...entry, parentFolderId: folderId });
        this.changes.push({ seq: ++this.seq, folderId, id: entry.id, removed: false });
    }

    remove(id: string) {
        const existing = this.messages.get(id)!;
        this.messages.delete(id);
        this.changes.push({
            seq: ++this.seq,
            folderId: existing.parentFolderId!,
            id,
            removed: true,
        });
    }

    private ref(entry: OutlookMessage): OutlookMessageRef {
        return {
            id: entry.id,
            conversationId: entry.conversationId,
            isDraft: entry.isDraft,
            receivedDateTime: entry.receivedDateTime,
        };
    }

    async getProfile() {
        this.calls.push("profile");
        return this.profile;
    }

    async listMailFolders() {
        this.calls.push("folders");
        return this.folders;
    }

    async listChildFolders(folderId: string) {
        this.calls.push(`children:${folderId}`);
        return this.childFolders.get(folderId) ?? [];
    }

    async listFolderDelta(params: { folderId: string; link?: string }): Promise<OutlookDeltaPage> {
        const { folderId, link } = params;
        this.calls.push(`delta:${folderId}:${link ?? "scratch"}`);
        if (this.authDead) throw new OutlookAuthError("token expired", 401);
        const known = [...this.folders, ...[...this.childFolders.values()].flat()];
        if (!known.some(folder => folder.id === folderId)) {
            throw new OutlookNotFoundError(`folder ${folderId}`);
        }

        if (link?.startsWith("delta:")) {
            const since = Number(link.split(":")[2]);
            if (since < this.expiredBefore) throw new OutlookDeltaExpiredError(folderId);
            const value = this.changes
                .filter(change => change.folderId === folderId && change.seq > since)
                .map(change =>
                    change.removed
                        ? { id: change.id, "@removed": { reason: "deleted" } }
                        : this.ref(this.messages.get(change.id)!)
                );
            return { value, "@odata.deltaLink": `delta:${folderId}:${this.seq}` };
        }

        // From scratch (or a later page of it): everything in the folder now.
        const offset = link ? Number(link.split(":")[2]) : 0;
        const all = [...this.messages.values()].filter(entry => entry.parentFolderId === folderId);
        const value = all.slice(offset, offset + this.pageSize).map(entry => this.ref(entry));
        if (offset + this.pageSize < all.length) {
            return { value, "@odata.nextLink": `next:${folderId}:${offset + this.pageSize}` };
        }
        return { value, "@odata.deltaLink": `delta:${folderId}:${this.seq}` };
    }

    async listConversationMessages(conversationId: string) {
        this.calls.push(`conversation:${conversationId}`);
        return [...this.messages.values()].filter(entry => entry.conversationId === conversationId);
    }

    async searchMessages(params: { query: string }): Promise<OutlookMessageRefPage> {
        this.calls.push(`search:${params.query}`);
        if (params.query.includes("(")) throw new OutlookApiError("Syntax error in query", 400);
        const needle = params.query.toLowerCase();
        return {
            value: [...this.messages.values()]
                .filter(entry => (entry.subject ?? "").toLowerCase().includes(needle))
                .map(entry => this.ref(entry)),
        };
    }

    async listAttachments(messageId: string) {
        this.calls.push(`attachments:${messageId}`);
        return this.attachments.get(messageId) ?? [];
    }

    async downloadAttachment(messageId: string, attachmentId: string) {
        this.calls.push(`attachment:${messageId}:${attachmentId}`);
        const data = this.attachmentBytes.get(attachmentId);
        if (data === undefined) throw new OutlookNotFoundError(`attachment ${attachmentId}`);
        return new Uint8Array(Buffer.from(data, "utf8"));
    }

    conversationFetches(): string[] {
        return this.calls.filter(call => call.startsWith("conversation:"));
    }
}

class MemorySink implements KnowledgeSink {
    readonly items = new Map<string, KnowledgeItem>();
    readonly stores: string[] = [];
    private nextId = 1;

    async lastSyncedHash(item: DiscoveredKnowledgeItem): Promise<string | null> {
        return this.items.get(item.sourceId)?.contentHash ?? null;
    }

    async store(item: KnowledgeItem): Promise<StoredKnowledgeItem> {
        const existed = this.items.has(item.sourceId);
        this.items.set(item.sourceId, item);
        this.stores.push(item.sourceId);
        return {
            sourceId: item.sourceId,
            documentId: this.nextId++,
            versionId: this.nextId++,
            jobId: null,
            revised: existed,
        };
    }
}

/** Investors holds conversation cA (two messages, a draft, attachments) and cB (one message). */
function mailboxWithTwoConversations(): FakeMailbox {
    const box = new FakeMailbox();
    box.add(
        "f-investors",
        message({
            id: "a1",
            conversationId: "cA",
            from: "Ada",
            subject: "Term sheet",
            date: "2026-09-01T09:00:00Z",
            text: "Please review the attached.",
            hasAttachments: true,
        })
    );
    box.add(
        "f-investors",
        message({
            id: "a2",
            conversationId: "cA",
            from: "Bob",
            subject: "RE: Term sheet",
            date: "2026-09-02T09:00:00Z",
            text: [
                "Looks fine.",
                "",
                "________________________________",
                "From: Ada <ada@example.com>",
                "Sent: Tuesday, September 1, 2026 9:00 AM",
                "To: Me",
                "Subject: Term sheet",
                "",
                "Please review the attached.",
            ].join("\r\n"),
        })
    );
    box.add(
        "f-investors",
        message({
            id: "a-draft",
            conversationId: "cA",
            from: "Me",
            subject: "RE: Term sheet",
            date: "2026-09-03T09:00:00Z",
            text: "Half-written thought.",
            isDraft: true,
        })
    );
    box.add(
        "f-investors",
        message({
            id: "b1",
            conversationId: "cB",
            from: "Carol",
            subject: "Lunch",
            date: "2026-09-01T12:00:00Z",
            text: "Tacos?",
        })
    );
    box.attachments.set("a1", [
        { id: "att-pdf", name: "term-sheet.pdf", contentType: "application/pdf", size: 13 },
        { id: "att-png", name: "chart.png", contentType: "image/png", size: 3 },
        {
            id: "att-logo",
            name: "logo.pdf",
            contentType: "application/pdf",
            size: 5,
            isInline: true,
        },
    ]);
    box.attachmentBytes.set("att-pdf", "%PDF-1.4 fake");
    box.attachmentBytes.set("att-png", "PNG");
    box.attachmentBytes.set("att-logo", "%PDF-");
    return box;
}

const investors = [{ kind: "folder" as const, value: "f-investors", name: "Investors" }];

describe("syncOutlook", () => {
    it("first run walks the folder and stores conversations plus ingestible attachments", async () => {
        const box = mailboxWithTwoConversations();
        const sink = new MemorySink();

        const result = await syncOutlook({ client: box, selectors: investors, sink });

        expect(result.connectorId).toBe("outlook");
        expect(result.dirty).toBe(true);
        expect(result.deltaExpired).toBe(false);
        expect(result.changedConversations).toBeNull();
        expect(result.removedMessages).toBe(0);
        expect(result.discovered).toBe(2);
        expect(result.accountEmail).toBe("me@example.com");
        expect(result.nextDeltaLinks).toEqual({ "f-investors": "delta:f-investors:4" });
        expect([...sink.stores].sort()).toEqual(["cA", "cA:a1:att-pdf", "cB"]);
        expect(result.missingSourceIds).toEqual([]);
        expect(result.failed).toEqual([]);

        // The image is not ingestible and the inline one is never fetched.
        expect(result.skipped).toEqual([
            { sourceId: "cA:a1:att-logo", reason: "excluded", detail: "inline attachment" },
            {
                sourceId: "cA:a1:att-png",
                reason: "excluded",
                detail: "unsupported attachment type image/png",
            },
        ]);
        expect(box.calls.filter(call => call.startsWith("attachment:"))).toEqual([
            "attachment:a1:att-pdf",
        ]);

        const conversation = sink.items.get("cA")!;
        const markdown = String(conversation.content);
        expect(conversation.title).toBe("Term sheet");
        expect(conversation.kind).toBe("outlook-conversation");
        expect(conversation.mimeType).toBe("text/markdown");
        expect(conversation.contentHash).toMatch(/^msgs:[0-9a-f]{64}$/);
        expect(markdown).toContain("Outlook conversation · 2 messages");
        expect(markdown).toContain("Folders: Investors");
        // Oldest first.
        expect(markdown.indexOf("Please review the attached.")).toBeLessThan(
            markdown.indexOf("Looks fine.")
        );
        // The draft is dropped and the quoted original is trimmed from the reply.
        expect(markdown).not.toContain("Half-written thought.");
        expect(markdown.match(/Please review the attached\./g)).toHaveLength(1);
        expect(markdown).not.toContain("Sent: Tuesday");
        expect(markdown).toContain("**Attachments:** term-sheet.pdf (13 B), chart.png (3 B)");
        expect(markdown).not.toContain("logo.pdf");

        // The link is the newest real message's.
        expect(conversation.location.origin).toBe("https://outlook.office.com/mail/id/a2");
        expect(conversation.metadata).toMatchObject({
            outlookConversationId: "cA",
            outlookLink: "https://outlook.office.com/mail/id/a2",
            subject: "Term sheet",
            messageCount: 2,
            participants: ["Ada <ada@example.com>", "Bob <bob@example.com>"],
            folders: ["Investors"],
            matchedSelectors: ["Investors"],
            attachmentCount: 2,
            extension: ".md",
        });

        const attachment = sink.items.get("cA:a1:att-pdf")!;
        expect(attachment.kind).toBe("outlook-attachment");
        expect(attachment.title).toBe("term-sheet.pdf");
        expect(attachment.contentHash).toBe("att:a1:att-pdf");
        expect(Buffer.from(attachment.content as Uint8Array).toString()).toBe("%PDF-1.4 fake");
        expect(attachment.metadata).toMatchObject({
            outlookConversationId: "cA",
            outlookMessageId: "a1",
            outlookAttachmentId: "att-pdf",
            extension: ".pdf",
        });
    });

    it("an idle mailbox costs the profile and one delta page per folder", async () => {
        const box = mailboxWithTwoConversations();
        const sink = new MemorySink();
        const first = await syncOutlook({ client: box, selectors: investors, sink });
        box.calls = [];

        const result = await syncOutlook({
            client: box,
            selectors: investors,
            sink,
            deltaLinks: first.nextDeltaLinks,
            knownSourceIds: [...sink.items.keys()],
        });

        expect(result.dirty).toBe(false);
        expect(result.changedConversations).toBe(0);
        expect(result.discovered).toBe(0);
        expect(result.nextDeltaLinks).toEqual(first.nextDeltaLinks);
        expect(box.calls).toEqual(["profile", "delta:f-investors:delta:f-investors:4"]);
        expect(sink.stores).toHaveLength(3);
    });

    it("an incremental run fetches only the conversation that changed, as a revision", async () => {
        const box = mailboxWithTwoConversations();
        const sink = new MemorySink();
        const first = await syncOutlook({ client: box, selectors: investors, sink });
        box.calls = [];
        box.add(
            "f-investors",
            message({
                id: "b2",
                conversationId: "cB",
                from: "Dan",
                subject: "RE: Lunch",
                date: "2026-09-04T12:00:00Z",
                text: "Tacos it is.",
            })
        );

        const result = await syncOutlook({
            client: box,
            selectors: investors,
            sink,
            deltaLinks: first.nextDeltaLinks,
            knownSourceIds: [...sink.items.keys()],
        });

        expect(result.dirty).toBe(true);
        expect(result.changedConversations).toBe(1);
        expect(result.discovered).toBe(1);
        expect(box.conversationFetches()).toEqual(["conversation:cB"]);
        expect(result.stored).toEqual([expect.objectContaining({ sourceId: "cB", revised: true })]);
        expect(String(sink.items.get("cB")!.content)).toContain("Tacos it is.");
        expect(result.nextDeltaLinks).toEqual({ "f-investors": "delta:f-investors:5" });
        // An incremental run saw a slice; it says nothing about what is gone.
        expect(result.missingSourceIds).toEqual([]);
    });

    it("a full run skips conversations whose message set is unchanged, before listing attachments", async () => {
        const box = mailboxWithTwoConversations();
        const sink = new MemorySink();
        await syncOutlook({ client: box, selectors: investors, sink });
        box.calls = [];

        const result = await syncOutlook({
            client: box,
            selectors: investors,
            sink,
            knownSourceIds: [...sink.items.keys()],
        });

        expect(result.stored).toEqual([]);
        expect(result.skipped).toEqual([
            { sourceId: "cA", reason: "unchanged" },
            { sourceId: "cB", reason: "unchanged" },
        ]);
        expect(box.calls.some(call => call.startsWith("attachment"))).toBe(false);
    });

    it("force re-reads everything and re-stores it", async () => {
        const box = mailboxWithTwoConversations();
        const sink = new MemorySink();
        const first = await syncOutlook({ client: box, selectors: investors, sink });

        const result = await syncOutlook({
            client: box,
            selectors: investors,
            sink,
            deltaLinks: first.nextDeltaLinks,
            force: true,
        });

        expect(result.changedConversations).toBeNull();
        expect(result.stored.map(entry => entry.sourceId).sort()).toEqual([
            "cA",
            "cA:a1:att-pdf",
            "cB",
        ]);
        expect(result.stored.every(entry => entry.revised)).toBe(true);
    });

    it("an expired delta link falls back to a full walk of that folder", async () => {
        const box = mailboxWithTwoConversations();
        const sink = new MemorySink();
        const first = await syncOutlook({ client: box, selectors: investors, sink });
        const known = [...sink.items.keys()];
        box.remove("b1");
        box.expiredBefore = 100;
        box.calls = [];

        const result = await syncOutlook({
            client: box,
            selectors: investors,
            sink,
            deltaLinks: first.nextDeltaLinks,
            knownSourceIds: known,
        });

        expect(result.deltaExpired).toBe(true);
        expect(result.dirty).toBe(true);
        expect(result.changedConversations).toBeNull();
        expect(box.calls.filter(call => call.startsWith("delta:"))).toEqual([
            "delta:f-investors:delta:f-investors:4",
            "delta:f-investors:scratch",
        ]);
        expect(result.nextDeltaLinks).toEqual({ "f-investors": "delta:f-investors:5" });
        // The walk was complete, so the deleted conversation is reported.
        expect(result.missingSourceIds).toEqual(["cB"]);
        expect(result.skipped).toEqual([{ sourceId: "cA", reason: "unchanged" }]);
    });

    it("a removal on an incremental run is counted, and reported missing by the next full run", async () => {
        const box = mailboxWithTwoConversations();
        const sink = new MemorySink();
        const first = await syncOutlook({ client: box, selectors: investors, sink });
        const known = [...sink.items.keys()];
        box.remove("a1");
        box.remove("a2");
        box.remove("a-draft");

        const incremental = await syncOutlook({
            client: box,
            selectors: investors,
            sink,
            deltaLinks: first.nextDeltaLinks,
            knownSourceIds: known,
        });
        expect(incremental.removedMessages).toBe(3);
        expect(incremental.dirty).toBe(true);
        expect(incremental.changedConversations).toBe(0);
        expect(incremental.missingSourceIds).toEqual([]);

        const full = await syncOutlook({
            client: box,
            selectors: investors,
            sink,
            deltaLinks: incremental.nextDeltaLinks,
            knownSourceIds: known,
            force: true,
        });
        expect([...full.missingSourceIds].sort()).toEqual(["cA", "cA:a1:att-pdf"]);
    });

    it("a failing selector becomes a skip, not an abort, and keeps its delta link", async () => {
        const box = mailboxWithTwoConversations();
        const sink = new MemorySink();

        const result = await syncOutlook({
            client: box,
            selectors: [
                { kind: "folder", value: "f-deleted", name: "Old deals" },
                { kind: "query", value: "broken (" },
                ...investors,
            ],
            sink,
            deltaLinks: { "f-deleted": "delta:f-deleted:1" },
            knownSourceIds: ["cZ"],
            force: true,
        });

        expect(result.skipped.slice(0, 2)).toEqual([
            {
                sourceId: "selector:folder:f-deleted",
                reason: "excluded",
                detail: "OutlookNotFoundError: Outlook resource folder f-deleted not found",
            },
            {
                sourceId: "selector:query:broken (",
                reason: "excluded",
                detail: "OutlookApiError: Syntax error in query",
            },
        ]);
        expect([...sink.stores].sort()).toEqual(["cA", "cA:a1:att-pdf", "cB"]);
        expect(result.nextDeltaLinks).toEqual({
            "f-deleted": "delta:f-deleted:1",
            "f-investors": "delta:f-investors:4",
        });
        // A selector that could not list hides what it matches: nothing is called missing.
        expect(result.missingSourceIds).toEqual([]);
    });

    it("a dead grant aborts the run instead of skipping every selector", async () => {
        const box = mailboxWithTwoConversations();
        box.authDead = true;

        await expect(
            syncOutlook({ client: box, selectors: investors, sink: new MemorySink() })
        ).rejects.toBeInstanceOf(OutlookAuthError);
    });

    it("truncates at the conversation cap and then reports nothing missing", async () => {
        const box = mailboxWithTwoConversations();
        const sink = new MemorySink();

        const result = await syncOutlook({
            client: box,
            selectors: investors,
            sink,
            maxConversations: 1,
            knownSourceIds: ["cB", "cGone"],
        });

        expect(result.truncated).toBe(true);
        expect(result.discovered).toBe(1);
        expect(sink.items.has("cA")).toBe(true);
        expect(sink.items.has("cB")).toBe(false);
        expect(result.missingSourceIds).toEqual([]);
        // A walk cut short has no delta link to resume from.
        expect(result.nextDeltaLinks).toEqual({});
    });

    it("pages through a folder's delta feed", async () => {
        const box = mailboxWithTwoConversations();
        box.pageSize = 2;
        const sink = new MemorySink();

        const result = await syncOutlook({ client: box, selectors: investors, sink });

        expect(box.calls.filter(call => call.startsWith("delta:"))).toEqual([
            "delta:f-investors:scratch",
            "delta:f-investors:next:f-investors:2",
        ]);
        expect(result.discovered).toBe(2);
        expect(result.nextDeltaLinks).toEqual({ "f-investors": "delta:f-investors:4" });
    });

    it("query selectors are re-listed every run but only new matches are fetched incrementally", async () => {
        const box = mailboxWithTwoConversations();
        box.add(
            "inbox-id",
            message({
                id: "c1",
                conversationId: "cC",
                from: "Eve",
                subject: "Lunch next week",
                date: "2026-09-05T12:00:00Z",
                text: "Same place?",
            })
        );
        const selectors = [
            ...investors,
            { kind: "query" as const, value: "lunch", name: "Lunches" },
        ];
        const sink = new MemorySink();

        const first = await syncOutlook({ client: box, selectors, sink });
        expect(sink.items.get("cB")!.metadata.matchedSelectors).toEqual(["Investors", "Lunches"]);
        expect(sink.items.get("cC")!.metadata.matchedSelectors).toEqual(["Lunches"]);
        // Inbox is a folder nobody wants named in a header.
        expect(String(sink.items.get("cC")!.content)).not.toContain("Folders:");

        box.add(
            "inbox-id",
            message({
                id: "d1",
                conversationId: "cD",
                from: "Finn",
                subject: "Team lunch",
                date: "2026-09-06T12:00:00Z",
                text: "Friday.",
            })
        );
        box.calls = [];
        const second = await syncOutlook({
            client: box,
            selectors,
            sink,
            deltaLinks: first.nextDeltaLinks,
            knownSourceIds: [...sink.items.keys()],
        });

        expect(box.calls).toContain("search:lunch");
        expect(box.conversationFetches()).toEqual(["conversation:cD"]);
        expect(second.stored.map(entry => entry.sourceId)).toEqual(["cD"]);
        expect(second.changedConversations).toBe(0);
    });

    it("never fetches a conversation that is drafts only", async () => {
        const box = new FakeMailbox();
        box.add(
            "inbox-id",
            message({
                id: "x1",
                conversationId: "cX",
                from: "Me",
                subject: "Unsent",
                date: "2026-09-01T09:00:00Z",
                text: "…",
                isDraft: true,
            })
        );
        const sink = new MemorySink();

        // Listings pass drafts over: a draft is not part of a conversation yet.
        const result = await syncOutlook({
            client: box,
            selectors: [{ kind: "folder", value: "inbox-id" }],
            sink,
        });
        expect(result.discovered).toBe(0);
        expect(sink.stores).toEqual([]);
        expect(box.conversationFetches()).toEqual([]);
    });

    it("reports a conversation deleted between listing and reading as not found", async () => {
        const box = mailboxWithTwoConversations();
        const original = box.listConversationMessages.bind(box);
        box.listConversationMessages = async conversationId =>
            conversationId === "cB" ? [] : original(conversationId);
        const sink = new MemorySink();

        const result = await syncOutlook({
            client: box,
            selectors: investors,
            sink,
            knownSourceIds: ["cB"],
        });

        expect(result.notFound).toEqual(["cB"]);
        expect(result.missingSourceIds).toEqual([]);
        expect(sink.items.has("cB")).toBe(false);
    });

    it("skips an attachment over the size cap without downloading it", async () => {
        const box = mailboxWithTwoConversations();
        const sink = new MemorySink();

        const result = await syncOutlook({
            client: box,
            selectors: investors,
            sink,
            attachmentPolicy: { maxBytes: 10 },
        });

        expect(result.skipped).toContainEqual({
            sourceId: "cA:a1:att-pdf",
            reason: "too-large",
            detail: "13 bytes exceeds the 10-byte cap",
        });
        expect(box.calls.some(call => call.startsWith("attachment:"))).toBe(false);
    });

    it("leaves attachments alone when asked to", async () => {
        const box = mailboxWithTwoConversations();
        const sink = new MemorySink();

        await syncOutlook({ client: box, selectors: investors, sink, includeAttachments: false });

        expect([...sink.stores].sort()).toEqual(["cA", "cB"]);
        expect(box.calls.some(call => call.startsWith("attachment"))).toBe(false);
    });

    it("falls back to the user principal name when the account has no mail address", async () => {
        const box = new FakeMailbox();
        box.profile = { id: "u1", mail: null, userPrincipalName: "me@corp.test" };

        const result = await syncOutlook({ client: box, selectors: [], sink: new MemorySink() });

        expect(result.accountEmail).toBe("me@corp.test");
    });
});

describe("listOutlookFolderTree", () => {
    it("flattens the folder tree with paths", async () => {
        const box = new FakeMailbox();

        const tree = await listOutlookFolderTree(box);

        expect(tree.map(folder => [folder.id, folder.path])).toEqual([
            ["inbox-id", "Inbox"],
            ["f-investors", "Investors"],
            ["f-seed", "Investors/Seed"],
        ]);
        expect(box.calls).toEqual(["folders", "children:f-investors"]);
    });
});
