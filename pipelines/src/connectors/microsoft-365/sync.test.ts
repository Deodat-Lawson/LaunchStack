import { describe, expect, it } from "vitest";

import {
    DELETED_HERE_DETAIL,
    SourceDeletedError,
    type DiscoveredKnowledgeItem,
    type KnowledgeItem,
    type KnowledgeSink,
    type StoredKnowledgeItem,
} from "../types";
import {
    Microsoft365AccessError,
    Microsoft365ApiError,
    type GraphDriveItem,
    type GraphDriveItemList,
    type Microsoft365Client,
} from "./client";
import { microsoft365SourceId, parseMicrosoft365SourceId } from "./discover";
import { resolveMicrosoft365Action } from "./export-rules";
import { syncMicrosoft365 } from "./sync";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DRIVE = "b!drive1";

interface FakeNode {
    item: GraphDriveItem;
    parentId: string | null;
    content?: string;
}

/** An in-memory drive that counts what the sync asks of it. */
class FakeDrive implements Microsoft365Client {
    readonly nodes = new Map<string, FakeNode>();
    readonly denied = new Set<string>();
    readonly broken = new Set<string>();
    pageSize = 200;
    calls: string[] = [];
    private revision = 1;

    constructor(readonly driveId: string = DRIVE) {
        this.nodes.set("root", {
            item: { id: "root", name: "root", folder: { childCount: 0 } },
            parentId: null,
        });
    }

    private pathOf(id: string | null): string {
        const names: string[] = [];
        let cursor = id;
        while (cursor && cursor !== "root") {
            const node = this.nodes.get(cursor);
            if (!node) break;
            names.unshift(encodeURIComponent(node.item.name));
            cursor = node.parentId;
        }
        return `/drives/${this.driveId}/root:${names.length ? `/${names.join("/")}` : ""}`;
    }

    addFolder(id: string, name: string, parentId = "root") {
        this.nodes.set(id, {
            item: {
                id,
                name,
                folder: { childCount: 0 },
                webUrl: `https://contoso.sharepoint.com/${name}`,
                parentReference: {
                    driveId: this.driveId,
                    id: parentId,
                    path: this.pathOf(parentId),
                },
            },
            parentId,
        });
    }

    addFile(
        id: string,
        name: string,
        parentId: string,
        content: string,
        extra: Partial<GraphDriveItem> & { mimeType?: string } = {}
    ) {
        const { mimeType = DOCX, ...rest } = extra;
        this.nodes.set(id, {
            item: {
                id,
                name,
                size: content.length,
                cTag: `c:{${id}},${this.revision++}`,
                eTag: `e:{${id}},1`,
                lastModifiedDateTime: "2026-10-01T10:00:00Z",
                webUrl: `https://contoso.sharepoint.com/${name}`,
                file: { mimeType },
                parentReference: {
                    driveId: this.driveId,
                    id: parentId,
                    path: this.pathOf(parentId),
                },
                ...rest,
            },
            parentId,
            content,
        });
    }

    edit(id: string, content: string) {
        const node = this.nodes.get(id)!;
        node.content = content;
        node.item = { ...node.item, size: content.length, cTag: `c:{${id}},${this.revision++}` };
    }

    private gate(id: string) {
        if (this.denied.has(id)) throw new Microsoft365AccessError(`${this.driveId}:${id}`, 403);
        if (this.broken.has(id)) throw new Microsoft365ApiError("upstream unavailable", 503);
    }

    async getMyDrive() {
        return { id: this.driveId, driveType: "business" };
    }

    async getItem(driveId: string, itemId: string) {
        this.calls.push(`get:${itemId}`);
        this.gate(itemId);
        const node = driveId === this.driveId ? this.nodes.get(itemId) : undefined;
        if (!node) throw new Microsoft365AccessError(`${driveId}:${itemId}`, 404);
        return node.item;
    }

    async listChildren(
        driveId: string,
        itemId: string,
        nextLink?: string
    ): Promise<GraphDriveItemList> {
        this.calls.push(`list:${itemId}${nextLink ? `@${nextLink}` : ""}`);
        this.gate(itemId);
        if (!this.nodes.has(itemId)) throw new Microsoft365AccessError(`${driveId}:${itemId}`, 404);
        const children = [...this.nodes.values()]
            .filter(node => node.parentId === itemId)
            .map(node => node.item);
        const offset = nextLink ? Number(nextLink.split("skip=")[1]) : 0;
        const value = children.slice(offset, offset + this.pageSize);
        const more = offset + this.pageSize < children.length;
        return {
            value,
            "@odata.nextLink": more
                ? `https://graph.test/next?skip=${offset + this.pageSize}`
                : undefined,
        };
    }

    async download(driveId: string, itemId: string) {
        this.calls.push(`download:${itemId}`);
        this.gate(itemId);
        const node = this.nodes.get(itemId);
        if (node?.content === undefined) {
            throw new Microsoft365AccessError(`${driveId}:${itemId}`, 404);
        }
        return new Uint8Array(Buffer.from(node.content, "utf8"));
    }

    async getSharedItem(): Promise<GraphDriveItem> {
        throw new Error("not used");
    }

    async searchSites() {
        return [];
    }

    async listSiteDrives() {
        return [];
    }

    downloads(): string[] {
        return this.calls.filter(call => call.startsWith("download:"));
    }
}

class MemorySink implements KnowledgeSink {
    readonly items = new Map<string, KnowledgeItem>();
    readonly stores: string[] = [];
    readonly deletedHere = new Set<string>();
    private nextId = 1;

    async lastSyncedHash(item: DiscoveredKnowledgeItem): Promise<string | null> {
        return this.items.get(item.sourceId)?.contentHash ?? null;
    }

    async store(item: KnowledgeItem): Promise<StoredKnowledgeItem> {
        if (this.deletedHere.has(item.sourceId)) throw new SourceDeletedError(item.sourceId);
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

const sid = (itemId: string) => microsoft365SourceId(DRIVE, itemId);

/** Clients/ → plan.docx, notes.md, Acme/ → contract.pdf; plus a loose budget.xlsx. */
function driveWithClientsFolder(): FakeDrive {
    const drive = new FakeDrive();
    drive.addFolder("clients", "Clients");
    drive.addFile("plan", "plan.docx", "clients", "plan v1");
    drive.addFile("notes", "notes.md", "clients", "# notes", {
        mimeType: "application/octet-stream",
    });
    drive.addFolder("acme", "Acme Co", "clients");
    drive.addFile("contract", "contract.pdf", "acme", "%PDF-1.7", { mimeType: "application/pdf" });
    drive.addFile("budget", "budget.xlsx", "root", "cells", {
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    return drive;
}

const clientsFolder = [{ driveId: DRIVE, itemId: "clients", kind: "folder" as const }];

describe("syncMicrosoft365", () => {
    it("first run walks a picked folder recursively and uploads every supported file", async () => {
        const drive = driveWithClientsFolder();
        const sink = new MemorySink();

        const result = await syncMicrosoft365({
            client: drive,
            pickedItems: [...clientsFolder, { driveId: DRIVE, itemId: "budget", kind: "file" }],
            sink,
        });

        expect(result.connectorId).toBe("microsoft-365");
        expect(result.dirty).toBe(true);
        expect(result.discovered).toBe(4);
        expect(sink.stores.sort()).toEqual(
            [sid("budget"), sid("contract"), sid("notes"), sid("plan")].sort()
        );
        expect(result.failed).toEqual([]);
        expect(result.missingSourceIds).toEqual([]);
        expect(result.accessLost).toEqual([]);
        expect(result.emptyFolders).toEqual([]);
        expect(result.truncated).toBe(false);

        const contract = sink.items.get(sid("contract"))!;
        expect(contract.title).toBe("contract.pdf");
        expect(contract.kind).toBe("microsoft-365-file");
        expect(contract.mimeType).toBe("application/pdf");
        expect(contract.contentHash).toMatch(/^ctag:/);
        expect(Buffer.from(contract.content as Uint8Array).toString("utf8")).toBe("%PDF-1.7");
        expect(contract.location.relativePath).toBe("Clients/Acme Co/contract.pdf");
        expect(contract.metadata).toEqual({
            driveId: DRIVE,
            itemId: "contract",
            webUrl: "https://contoso.sharepoint.com/contract.pdf",
            parentPath: "/Clients/Acme Co",
            pickedRoot: sid("clients"),
            folderPath: ["Acme Co"],
            graphMimeType: "application/pdf",
        });

        // A picked file is its own root, at the top of it.
        const budget = sink.items.get(sid("budget"))!;
        expect(budget.metadata.pickedRoot).toBe(sid("budget"));
        expect(budget.metadata.folderPath).toEqual([]);
        expect(budget.metadata.parentPath).toBe("/");

        // Markdown that Graph calls octet-stream is typed by its name.
        expect(sink.items.get(sid("notes"))!.mimeType).toBe("text/markdown");
    });

    it("an unchanged corpus is skipped without a single download", async () => {
        const drive = driveWithClientsFolder();
        const sink = new MemorySink();
        await syncMicrosoft365({ client: drive, pickedItems: clientsFolder, sink });
        drive.calls = [];

        const result = await syncMicrosoft365({
            client: drive,
            pickedItems: clientsFolder,
            sink,
            knownSourceIds: [...sink.items.keys()],
        });

        expect(result.dirty).toBe(false);
        expect(result.stored).toEqual([]);
        expect(result.skipped.map(s => s.reason)).toEqual(["unchanged", "unchanged", "unchanged"]);
        expect(drive.downloads()).toEqual([]);
        expect(sink.stores).toHaveLength(3);
    });

    it("a changed fingerprint re-uploads only that file, as a revision", async () => {
        const drive = driveWithClientsFolder();
        const sink = new MemorySink();
        await syncMicrosoft365({ client: drive, pickedItems: clientsFolder, sink });
        drive.calls = [];
        drive.edit("plan", "plan v2, longer");

        const result = await syncMicrosoft365({ client: drive, pickedItems: clientsFolder, sink });

        expect(result.dirty).toBe(true);
        expect(result.stored).toHaveLength(1);
        expect(result.stored[0]).toMatchObject({ sourceId: sid("plan"), revised: true });
        expect(drive.downloads()).toEqual(["download:plan"]);
        expect(Buffer.from(sink.items.get(sid("plan"))!.content as Uint8Array).toString()).toBe(
            "plan v2, longer"
        );
    });

    it("force re-uploads everything", async () => {
        const drive = driveWithClientsFolder();
        const sink = new MemorySink();
        await syncMicrosoft365({ client: drive, pickedItems: clientsFolder, sink });

        const result = await syncMicrosoft365({
            client: drive,
            pickedItems: clientsFolder,
            sink,
            force: true,
        });

        expect(result.stored).toHaveLength(3);
        expect(result.stored.every(entry => entry.revised)).toBe(true);
    });

    it("falls back through the fingerprint sources when cTag is absent", async () => {
        const drive = new FakeDrive();
        drive.addFile("a", "a.pdf", "root", "A", {
            mimeType: "application/pdf",
            cTag: undefined,
            file: { mimeType: "application/pdf", hashes: { quickXorHash: "qx==" } },
        });
        drive.addFile("b", "b.pdf", "root", "B", {
            mimeType: "application/pdf",
            cTag: undefined,
            file: { mimeType: "application/pdf", hashes: { sha256Hash: "ABC" } },
        });
        drive.addFile("c", "c.pdf", "root", "C", { mimeType: "application/pdf", cTag: undefined });
        drive.addFile("d", "d.pdf", "root", "D", {
            mimeType: "application/pdf",
            cTag: undefined,
            eTag: undefined,
        });
        const sink = new MemorySink();

        await syncMicrosoft365({
            client: drive,
            pickedItems: [{ driveId: DRIVE, itemId: "root", kind: "folder" }],
            sink,
        });

        expect(sink.items.get(sid("a"))!.contentHash).toBe("qxh:qx==");
        expect(sink.items.get(sid("b"))!.contentHash).toBe("sha256:ABC");
        expect(sink.items.get(sid("c"))!.contentHash).toBe("etag:e:{c},1");
        expect(sink.items.get(sid("d"))!.contentHash).toBe("mod:1:2026-10-01T10:00:00Z");
        // The whole-drive pick is the root every file reports.
        expect(sink.items.get(sid("a"))!.metadata.pickedRoot).toBe(sid("root"));
    });

    it("reports a removed file as missing after a complete walk", async () => {
        const drive = driveWithClientsFolder();
        const sink = new MemorySink();
        await syncMicrosoft365({ client: drive, pickedItems: clientsFolder, sink });
        const known = [...sink.items.keys()];
        drive.nodes.delete("contract");

        const result = await syncMicrosoft365({
            client: drive,
            pickedItems: clientsFolder,
            sink,
            knownSourceIds: known,
        });

        expect(result.missingSourceIds).toEqual([sid("contract")]);
        expect(result.dirty).toBe(true);
        expect(result.stored).toEqual([]);
    });

    it("does not report anything missing when the walk was truncated", async () => {
        const drive = driveWithClientsFolder();
        const sink = new MemorySink();
        await syncMicrosoft365({ client: drive, pickedItems: clientsFolder, sink });
        const known = [...sink.items.keys()];
        drive.nodes.delete("contract");

        const result = await syncMicrosoft365({
            client: drive,
            pickedItems: clientsFolder,
            sink,
            knownSourceIds: known,
            maxItems: 1,
        });

        expect(result.truncated).toBe(true);
        expect(result.discovered).toBe(1);
        expect(result.skipped.some(s => s.reason === "limit-reached")).toBe(true);
        expect(result.missingSourceIds).toEqual([]);
    });

    it("does not report a subtree missing when its folder stopped listing", async () => {
        const drive = driveWithClientsFolder();
        const sink = new MemorySink();
        await syncMicrosoft365({ client: drive, pickedItems: clientsFolder, sink });
        const known = [...sink.items.keys()];

        drive.denied.add("acme");
        const denied = await syncMicrosoft365({
            client: drive,
            pickedItems: clientsFolder,
            sink,
            knownSourceIds: known,
        });
        expect(denied.accessLost).toEqual([sid("acme")]);
        expect(denied.missingSourceIds).toEqual([]);

        drive.denied.clear();
        drive.broken.add("acme");
        const broken = await syncMicrosoft365({
            client: drive,
            pickedItems: clientsFolder,
            sink,
            knownSourceIds: known,
        });
        expect(broken.accessLost).toEqual([]);
        expect(broken.skipped).toContainEqual({
            sourceId: sid("acme"),
            reason: "unreadable",
            detail: "Microsoft365ApiError: upstream unavailable",
        });
        expect(broken.missingSourceIds).toEqual([]);
    });

    it("an access-lost pick is reported and never mistaken for deletions", async () => {
        const drive = driveWithClientsFolder();
        const sink = new MemorySink();
        const picks = [
            ...clientsFolder,
            { driveId: DRIVE, itemId: "budget", kind: "file" as const },
        ];
        await syncMicrosoft365({ client: drive, pickedItems: picks, sink });
        const known = [...sink.items.keys()];

        // A picked file that is gone is an answer: it is access-lost, and
        // the rest of the walk still stands.
        drive.nodes.delete("budget");
        drive.nodes.delete("plan");
        const fileGone = await syncMicrosoft365({
            client: drive,
            pickedItems: picks,
            sink,
            knownSourceIds: known,
        });
        expect(fileGone.accessLost).toEqual([sid("budget")]);
        expect(fileGone.missingSourceIds).toEqual([sid("plan")]);

        // A picked folder that is gone hides everything under it.
        drive.denied.add("clients");
        const folderGone = await syncMicrosoft365({
            client: drive,
            pickedItems: picks,
            sink,
            knownSourceIds: known,
        });
        expect([...folderGone.accessLost].sort()).toEqual([sid("budget"), sid("clients")].sort());
        expect(folderGone.missingSourceIds).toEqual([]);
        expect(folderGone.discovered).toBe(0);
    });

    it("skips files deleted here before downloading them", async () => {
        const drive = driveWithClientsFolder();
        const sink = new MemorySink();

        const result = await syncMicrosoft365({
            client: drive,
            pickedItems: clientsFolder,
            sink,
            deletedSourceIds: [sid("plan")],
            knownSourceIds: [],
        });

        expect(drive.downloads()).not.toContain("download:plan");
        expect(sink.items.has(sid("plan"))).toBe(false);
        expect(result.skipped).toContainEqual({
            sourceId: sid("plan"),
            reason: "excluded",
            detail: DELETED_HERE_DETAIL,
        });
        expect(result.stored).toHaveLength(2);
    });

    it("treats a sink's SourceDeletedError as a skip, not a failure", async () => {
        const drive = driveWithClientsFolder();
        const sink = new MemorySink();
        sink.deletedHere.add(sid("plan"));

        const result = await syncMicrosoft365({ client: drive, pickedItems: clientsFolder, sink });

        expect(result.failed).toEqual([]);
        expect(result.skipped).toContainEqual({
            sourceId: sid("plan"),
            reason: "excluded",
            detail: DELETED_HERE_DETAIL,
        });
    });

    it("pages through a large folder", async () => {
        const drive = new FakeDrive();
        drive.addFolder("big", "Big");
        for (let index = 0; index < 5; index++) {
            drive.addFile(`f${index}`, `f${index}.docx`, "big", `file ${index}`);
        }
        drive.pageSize = 2;
        const sink = new MemorySink();

        const result = await syncMicrosoft365({
            client: drive,
            pickedItems: [{ driveId: DRIVE, itemId: "big", kind: "folder" }],
            sink,
        });

        expect(result.stored).toHaveLength(5);
        expect(drive.calls.filter(call => call.startsWith("list:big"))).toEqual([
            "list:big",
            "list:big@https://graph.test/next?skip=2",
            "list:big@https://graph.test/next?skip=4",
        ]);
    });

    it("skips OneNote notebooks, unsupported, empty and oversized files with reasons", async () => {
        const drive = new FakeDrive();
        drive.addFolder("mixed", "Mixed");
        drive.addFile("ok", "ok.docx", "mixed", "fine");
        drive.addFile("huge", "huge.pdf", "mixed", "x".repeat(64), { mimeType: "application/pdf" });
        drive.addFile("blank", "blank.txt", "mixed", "", { mimeType: "text/plain" });
        drive.addFile("app", "setup.exe", "mixed", "MZ", {
            mimeType: "application/x-msdownload",
        });
        drive.nodes.set("nb", {
            item: { id: "nb", name: "Team Notebook", package: { type: "oneNote" } },
            parentId: "mixed",
        });
        const sink = new MemorySink();

        const result = await syncMicrosoft365({
            client: drive,
            pickedItems: [{ driveId: DRIVE, itemId: "mixed", kind: "folder" }],
            sink,
            maxItemBytes: 32,
        });

        expect(sink.stores).toEqual([sid("ok")]);
        const bySource = new Map(result.skipped.map(skip => [skip.sourceId, skip]));
        expect(bySource.get(sid("nb"))).toMatchObject({
            reason: "excluded",
            detail: "OneNote notebook",
        });
        expect(bySource.get(sid("app"))).toMatchObject({
            reason: "excluded",
            detail: "unsupported type application/x-msdownload",
        });
        expect(bySource.get(sid("blank"))).toMatchObject({ reason: "empty" });
        expect(bySource.get(sid("huge"))).toMatchObject({
            reason: "too-large",
            detail: "64 bytes exceeds the 32-byte cap",
        });
        // Neither the empty nor the oversized file was fetched.
        expect(drive.downloads()).toEqual(["download:ok"]);
    });

    it("reports a picked folder that lists empty", async () => {
        const drive = new FakeDrive();
        drive.addFolder("empty", "Empty");
        const sink = new MemorySink();

        const result = await syncMicrosoft365({
            client: drive,
            pickedItems: [{ driveId: DRIVE, itemId: "empty", kind: "folder" }],
            sink,
        });

        expect(result.emptyFolders).toEqual([sid("empty")]);
        expect(result.dirty).toBe(false);
    });

    it("follows a shared-with-me entry to the drive it lives in", async () => {
        const drive = new FakeDrive();
        drive.addFile("theirs", "theirs.docx", "root", "shared words");
        drive.nodes.set("pointer", {
            item: {
                id: "pointer",
                name: "theirs.docx",
                remoteItem: { id: "theirs", parentReference: { driveId: DRIVE }, file: {} },
            },
            parentId: null,
        });
        const sink = new MemorySink();

        await syncMicrosoft365({
            client: drive,
            pickedItems: [{ driveId: DRIVE, itemId: "pointer", kind: "file" }],
            sink,
        });

        expect(sink.stores).toEqual([sid("theirs")]);
        expect(sink.items.get(sid("theirs"))!.metadata.pickedRoot).toBe(sid("pointer"));
    });

    it("stamps the report with the injected clock", async () => {
        const times = [new Date("2026-11-12T10:00:00Z"), new Date("2026-11-12T10:00:02Z")];
        const result = await syncMicrosoft365({
            client: new FakeDrive(),
            pickedItems: [],
            sink: new MemorySink(),
            now: () => times.shift()!,
        });

        expect(result.startedAt).toBe("2026-11-12T10:00:00.000Z");
        expect(result.durationMs).toBe(2000);
    });
});

describe("source ids and rules", () => {
    it("builds and parses drive:item source ids", () => {
        expect(microsoft365SourceId("b!abc", "01XYZ")).toBe("b!abc:01XYZ");
        expect(parseMicrosoft365SourceId("b!abc:01XYZ")).toEqual({
            driveId: "b!abc",
            itemId: "01XYZ",
        });
        expect(parseMicrosoft365SourceId("no-colon")).toBeNull();
        expect(parseMicrosoft365SourceId("trailing:")).toBeNull();
    });

    it("decides per item like the Drive rules do", () => {
        expect(resolveMicrosoft365Action({ name: "Docs", folder: { childCount: 2 } })).toEqual({
            action: "recurse",
        });
        expect(resolveMicrosoft365Action({ name: "a.docx", file: { mimeType: DOCX } })).toEqual({
            action: "download",
            mimeType: DOCX,
        });
        expect(
            resolveMicrosoft365Action({ name: "a.png", file: { mimeType: "image/png" } })
        ).toEqual({ action: "download", mimeType: "image/png" });
        expect(
            resolveMicrosoft365Action({
                name: "a.bin",
                file: { mimeType: "application/octet-stream" },
            })
        ).toEqual({ action: "skip", reason: "unsupported type application/octet-stream" });
        expect(resolveMicrosoft365Action({ name: "gone.docx", file: {}, deleted: {} })).toEqual({
            action: "skip",
            reason: "deleted",
        });
    });
});
