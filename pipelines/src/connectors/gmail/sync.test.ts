import { describe, expect, it } from "vitest";

import type { DiscoveredKnowledgeItem, KnowledgeItem, KnowledgeSink, StoredKnowledgeItem } from "../types";
import {
    GmailApiError,
    GmailHistoryExpiredError,
    type GmailClient,
    type GmailHistoryRecord,
    type GmailLabel,
    type GmailMessage,
    type GmailPart,
    type GmailThread,
} from "./client";
import { syncGmail } from "./sync";

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");

function message(input: {
    id: string;
    threadId: string;
    from: string;
    subject: string;
    date: string;
    text: string;
    labels?: string[];
    attachments?: { partId: string; filename: string; mimeType: string; size: number; attachmentId: string }[];
}): GmailMessage {
    const parts: GmailPart[] = [
        { partId: "0", mimeType: "text/plain", body: { data: b64(input.text), size: input.text.length } },
        ...(input.attachments ?? []).map(att => ({
            partId: att.partId,
            mimeType: att.mimeType,
            filename: att.filename,
            body: { attachmentId: att.attachmentId, size: att.size },
        })),
    ];
    return {
        id: input.id,
        threadId: input.threadId,
        labelIds: input.labels ?? ["INBOX"],
        internalDate: String(Date.parse(input.date)),
        payload: {
            mimeType: "multipart/mixed",
            headers: [
                { name: "From", value: input.from },
                { name: "To", value: "me@example.com" },
                { name: "Subject", value: input.subject },
            ],
            parts,
        },
    };
}

/** An in-memory mailbox that counts what the sync asks of it. */
class FakeMailbox implements GmailClient {
    historyId = "100";
    labels: GmailLabel[] = [
        { id: "INBOX", name: "INBOX", type: "system" },
        { id: "Label_1", name: "Investors", type: "user" },
    ];
    threads = new Map<string, GmailThread>();
    history: GmailHistoryRecord[] = [];
    expiredBefore: string | null = null;
    attachments = new Map<string, string>();
    calls: string[] = [];

    addThread(id: string, messages: GmailMessage[]) {
        this.threads.set(id, { id, historyId: this.historyId, messages });
    }

    async getProfile() {
        this.calls.push("profile");
        return { emailAddress: "me@example.com", historyId: this.historyId };
    }

    async listLabels() {
        this.calls.push("labels");
        return this.labels;
    }

    async listThreads(params: { labelIds?: readonly string[]; q?: string }) {
        this.calls.push(`list:${params.labelIds?.join(",") ?? params.q ?? ""}`);
        const label = params.labelIds?.[0];
        if (label && !this.labels.some(entry => entry.id === label)) {
            throw new GmailApiError(`Label not found: ${label}`, 400);
        }
        const threads = [...this.threads.values()].filter(thread => {
            const messages = thread.messages ?? [];
            if (label) return messages.some(m => (m.labelIds ?? []).includes(label));
            if (params.q?.startsWith("subject:")) {
                const needle = params.q.slice("subject:".length).toLowerCase();
                return messages.some(m =>
                    (m.payload?.headers ?? []).some(
                        h => h.name === "Subject" && h.value.toLowerCase().includes(needle)
                    )
                );
            }
            return true;
        });
        return { threads: threads.map(t => ({ id: t.id, historyId: t.historyId, snippet: "" })) };
    }

    async getThread(threadId: string, format: "minimal" | "full" | "metadata") {
        this.calls.push(`get:${threadId}:${format}`);
        const thread = this.threads.get(threadId);
        if (!thread) throw new GmailApiError("not found", 404);
        if (format === "full") return thread;
        return {
            ...thread,
            messages: (thread.messages ?? []).map(({ payload: _payload, ...rest }) => rest),
        };
    }

    async listHistory(params: { startHistoryId: string }) {
        this.calls.push(`history:${params.startHistoryId}`);
        if (this.expiredBefore && Number(params.startHistoryId) < Number(this.expiredBefore)) {
            throw new GmailHistoryExpiredError(params.startHistoryId);
        }
        return {
            history: this.history.filter(record => Number(record.id) > Number(params.startHistoryId)),
            historyId: this.historyId,
        };
    }

    async getAttachment(messageId: string, attachmentId: string) {
        this.calls.push(`attachment:${messageId}:${attachmentId}`);
        const data = this.attachments.get(attachmentId);
        if (data === undefined) throw new GmailApiError("not found", 404);
        return { attachmentId, size: data.length, data: b64(data) };
    }
}

class MemorySink implements KnowledgeSink {
    readonly items = new Map<string, { hash: string; content: string | Uint8Array; title: string }>();
    readonly stores: string[] = [];
    private nextId = 1;

    async lastSyncedHash(item: DiscoveredKnowledgeItem): Promise<string | null> {
        return this.items.get(item.sourceId)?.hash ?? null;
    }

    async store(item: KnowledgeItem): Promise<StoredKnowledgeItem> {
        const existed = this.items.has(item.sourceId);
        this.items.set(item.sourceId, { hash: item.contentHash, content: item.content, title: item.title });
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

function mailboxWithTwoThreads(): FakeMailbox {
    const box = new FakeMailbox();
    box.addThread("tA", [
        message({
            id: "a1",
            threadId: "tA",
            from: "Ada <ada@example.com>",
            subject: "Term sheet",
            date: "2026-09-01T09:00:00Z",
            text: "Please review the attached.",
            labels: ["INBOX", "Label_1"],
            attachments: [
                { partId: "1", filename: "term-sheet.pdf", mimeType: "application/pdf", size: 10, attachmentId: "att-pdf" },
            ],
        }),
        message({
            id: "a2",
            threadId: "tA",
            from: "Bob <bob@example.com>",
            subject: "Re: Term sheet",
            date: "2026-09-02T09:00:00Z",
            text: "Looks fine.",
            labels: ["INBOX", "Label_1"],
        }),
    ]);
    box.addThread("tB", [
        message({
            id: "b1",
            threadId: "tB",
            from: "Carol <carol@example.com>",
            subject: "Lunch",
            date: "2026-09-01T12:00:00Z",
            text: "Tacos?",
            labels: ["INBOX", "Label_1"],
            attachments: [
                { partId: "1", filename: "menu.png", mimeType: "image/png", size: 10, attachmentId: "att-png" },
            ],
        }),
    ]);
    box.attachments.set("att-pdf", "%PDF-1.4 fake");
    box.attachments.set("att-png", "PNG");
    return box;
}

const investors = [{ kind: "label" as const, value: "Label_1", name: "Investors" }];

describe("syncGmail", () => {
    it("first run walks every matching thread and stores threads plus ingestible attachments", async () => {
        const box = mailboxWithTwoThreads();
        const sink = new MemorySink();

        const result = await syncGmail({ client: box, selectors: investors, sink });

        expect(result.dirty).toBe(true);
        expect(result.nextHistoryId).toBe("100");
        expect(result.historyExpired).toBe(false);
        expect(result.changedThreads).toBeNull();
        expect(result.discovered).toBe(2);
        expect(result.accountEmail).toBe("me@example.com");
        expect(sink.stores.sort()).toEqual(["tA", "tA:a1:1", "tB"]);
        expect(result.skipped.map(s => `${s.sourceId}:${s.reason}`)).toEqual(["tB:b1:1:excluded"]);
        expect(result.missingSourceIds).toEqual([]);

        const threadA = sink.items.get("tA")!;
        expect(threadA.title).toBe("Term sheet");
        expect(threadA.hash).toMatch(/^msgs:/);
        expect(String(threadA.content)).toContain("Please review the attached.");
        expect(String(threadA.content)).toContain("Looks fine.");
        expect(String(threadA.content)).toContain("Labels: Investors");
        expect(sink.items.get("tA:a1:1")!.hash).toBe("att:a1:1");
        expect(sink.items.get("tA:a1:1")!.title).toBe("term-sheet.pdf");
        // Bodies were fetched once per thread; no minimal pre-check on unknown threads.
        expect(box.calls.filter(c => c.startsWith("get:"))).toEqual(["get:tA:full", "get:tB:full"]);
    });

    it("an idle mailbox costs the profile and one history page", async () => {
        const box = mailboxWithTwoThreads();
        const sink = new MemorySink();
        await syncGmail({ client: box, selectors: investors, sink });
        box.calls = [];

        const result = await syncGmail({
            client: box,
            selectors: investors,
            sink,
            historyId: "100",
            knownSourceIds: [...sink.items.keys()],
        });

        expect(result.dirty).toBe(false);
        expect(result.changedThreads).toBe(0);
        expect(box.calls).toEqual(["profile", "history:100"]);
        expect(sink.stores).toHaveLength(3);
    });

    it("a reply re-syncs only its thread, as a revision", async () => {
        const box = mailboxWithTwoThreads();
        const sink = new MemorySink();
        await syncGmail({ client: box, selectors: investors, sink });
        const storesBefore = sink.stores.length;

        const threadA = box.threads.get("tA")!;
        box.threads.set("tA", {
            ...threadA,
            messages: [
                ...(threadA.messages ?? []),
                message({
                    id: "a3",
                    threadId: "tA",
                    from: "Ada <ada@example.com>",
                    subject: "Re: Term sheet",
                    date: "2026-09-03T09:00:00Z",
                    text: "Signed.",
                    labels: ["SENT", "Label_1"],
                }),
            ],
        });
        box.historyId = "110";
        box.history = [{ id: "105", messagesAdded: [{ message: { id: "a3", threadId: "tA" } }] }];
        box.calls = [];

        const result = await syncGmail({
            client: box,
            selectors: investors,
            sink,
            historyId: "100",
            knownSourceIds: [...sink.items.keys()],
        });

        expect(result.dirty).toBe(true);
        expect(result.changedThreads).toBe(1);
        expect(result.discovered).toBe(1);
        expect(result.nextHistoryId).toBe("110");
        expect(result.stored.map(s => `${s.sourceId}:${s.revised}`)).toEqual(["tA:true"]);
        expect(sink.stores.slice(storesBefore)).toEqual(["tA"]);
        expect(String(sink.items.get("tA")!.content)).toContain("Signed.");
        // The unchanged attachment was confirmed by fingerprint, never re-downloaded.
        expect(result.skipped.map(s => `${s.sourceId}:${s.reason}`)).toEqual(["tA:a1:1:unchanged"]);
        expect(box.calls.filter(c => c.startsWith("get:"))).toEqual(["get:tA:minimal", "get:tA:full"]);
        expect(box.calls.filter(c => c.startsWith("attachment:"))).toEqual([]);
        // Incremental runs never declare anything missing.
        expect(result.missingSourceIds).toEqual([]);
    });

    it("a label-only change is confirmed unchanged without fetching bodies", async () => {
        const box = mailboxWithTwoThreads();
        const sink = new MemorySink();
        await syncGmail({ client: box, selectors: investors, sink });
        const storesBefore = sink.stores.length;

        box.historyId = "120";
        box.history = [
            { id: "115", labelsRemoved: [{ message: { id: "b1", threadId: "tB" }, labelIds: ["UNREAD"] }] },
        ];
        box.calls = [];

        const result = await syncGmail({
            client: box,
            selectors: investors,
            sink,
            historyId: "100",
            knownSourceIds: [...sink.items.keys()],
        });

        expect(result.stored).toEqual([]);
        expect(sink.stores).toHaveLength(storesBefore);
        expect(result.skipped.map(s => `${s.sourceId}:${s.reason}`)).toEqual(["tB:unchanged"]);
        expect(box.calls.filter(c => c.startsWith("get:"))).toEqual(["get:tB:minimal"]);
    });

    it("an expired cursor forces a full walk and reports what is gone", async () => {
        const box = mailboxWithTwoThreads();
        const sink = new MemorySink();
        await syncGmail({ client: box, selectors: investors, sink });
        box.expiredBefore = "200";
        box.historyId = "300";

        const result = await syncGmail({
            client: box,
            selectors: investors,
            sink,
            historyId: "100",
            knownSourceIds: [...sink.items.keys(), "tGone", "tGone:g1:1"],
        });

        expect(result.historyExpired).toBe(true);
        expect(result.changedThreads).toBeNull();
        expect(result.discovered).toBe(2);
        expect(result.nextHistoryId).toBe("300");
        expect([...result.missingSourceIds].sort()).toEqual(["tGone", "tGone:g1:1"]);
        // Known, unchanged threads were confirmed via minimal fetches only.
        expect(result.skipped.map(s => `${s.sourceId}:${s.reason}`).sort()).toEqual([
            "tA:unchanged",
            "tB:unchanged",
        ]);
        expect(result.stored).toEqual([]);
    });

    it("force re-stores known threads and attachments", async () => {
        const box = mailboxWithTwoThreads();
        const sink = new MemorySink();
        await syncGmail({ client: box, selectors: investors, sink });
        box.calls = [];

        const result = await syncGmail({
            client: box,
            selectors: investors,
            sink,
            historyId: "100",
            knownSourceIds: [...sink.items.keys()],
            force: true,
        });

        expect(result.stored.map(s => `${s.sourceId}:${s.revised}`).sort()).toEqual([
            "tA:a1:1:true",
            "tA:true",
            "tB:true",
        ]);
        expect(box.calls).not.toContain("history:100");
        expect(box.calls.filter(c => c.startsWith("get:"))).toEqual(["get:tA:full", "get:tB:full"]);
    });

    it("a bad selector is reported and the rest still sync", async () => {
        const box = mailboxWithTwoThreads();
        const sink = new MemorySink();

        const result = await syncGmail({
            client: box,
            selectors: [
                { kind: "label", value: "Label_missing", name: "Old label" },
                { kind: "query", value: "subject:lunch" },
            ],
            sink,
            includeAttachments: false,
        });

        expect(result.skipped).toEqual([
            {
                sourceId: "selector:label:Label_missing",
                reason: "excluded",
                detail: "GmailApiError: Label not found: Label_missing",
            },
        ]);
        expect(sink.stores).toEqual(["tB"]);
        expect(result.discovered).toBe(1);
    });

    it("a thread deleted between discovery and fetch is reported, not failed", async () => {
        const box = mailboxWithTwoThreads();
        const sink = new MemorySink();
        const original = box.getThread.bind(box);
        box.getThread = async (id, format) => {
            if (id === "tB") throw new (await import("./client")).GmailNotFoundError("thread tB");
            return original(id, format);
        };

        const result = await syncGmail({ client: box, selectors: investors, sink });

        expect(result.notFound).toEqual(["tB"]);
        expect(result.failed).toEqual([]);
        expect(sink.stores.sort()).toEqual(["tA", "tA:a1:1"]);
    });
});
