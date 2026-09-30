jest.mock("~/server/engine", () => ({ getEngine: jest.fn() }));
jest.mock("~/lib/storage", () => ({
    uploadFile: jest.fn(),
    deleteFile: jest.fn(),
    deleteFileByUrl: jest.fn(),
}));
jest.mock("~/server/services/document-upload", () => ({
    processDocumentUpload: jest.fn(),
    toAbsoluteUrl: jest.fn(),
}));
jest.mock("~/server/services/document-creation", () => ({
    createDocumentVersionLifecycle: jest.fn(),
    findDocumentByCreationKey: jest.fn(),
}));
jest.mock("~/server/services/document-delete", () => ({
    deleteDocumentCore: jest.fn(),
    deleteDocumentBlobs: jest.fn(),
}));
jest.mock("~/server/services/internal-file-ref", () => ({ authorizeInternalFileRef: jest.fn() }));
jest.mock("~/server/notes/embed-note", () => ({ embedNote: jest.fn() }));

import { SQL } from "drizzle-orm";

import { callNotesCalls } from "@launchstack/pipelines/schema";
import type { DbClient } from "@launchstack/store/client";
import { document, documentVersions, fileUploads } from "@launchstack/store/schema";
import { documentNotes } from "~/server/db/schema";
import { callNoteDocuments } from "~/server/backfills/call-note-documents";
import {
    createWebCallNoteIndex,
    type WebCallNoteIndexOptions,
} from "~/server/call-notes/document-index";

type Call = Pick<
    typeof callNotesCalls.$inferSelect,
    | "id"
    | "companyId"
    | "title"
    | "status"
    | "documentNoteId"
    | "noteOwnerUserId"
    | "noteVisibility"
    | "currentNoteRevision"
    | "indexedDocumentId"
    | "indexedRevision"
>;
type Note = Pick<
    typeof documentNotes.$inferSelect,
    "id" | "userId" | "companyId" | "title" | "content" | "contentMarkdown"
>;
type PublishedDocument = {
    id: number;
    title: string;
    category: string;
    ocrMetadata?: unknown;
    companyId?: bigint;
    url?: string;
    markdown?: string;
};

type UploadRow = {
    id: number;
    companyId: bigint;
    storageUrl: string | null;
    text: string;
};
type SqlToken = string | { value: unknown };

/** Evaluate the small SQL expression subset used by this in-memory store. */
function sqlValue(expression: unknown, columns: ReadonlyMap<unknown, unknown>): unknown {
    const tokens: SqlToken[] = [];
    function append(chunk: unknown): void {
        if (columns.has(chunk)) {
            tokens.push({ value: columns.get(chunk) });
        } else if (chunk instanceof SQL) {
            chunk.queryChunks.forEach(append);
        } else if (Array.isArray(chunk)) {
            tokens.push("(");
            chunk.forEach((value, index) => {
                if (index > 0) tokens.push(",");
                append(value);
            });
            tokens.push(")");
        } else if (chunk && typeof chunk === "object" && "value" in chunk) {
            const value = chunk.value;
            if (Object.getPrototypeOf(chunk)?.constructor?.name === "StringChunk") {
                const text = (value as string[]).join("");
                for (const token of text.match(/\s+|'(?:''|[^'])*'|::|->|\|\||[(),=><]|\w+/g) ??
                    []) {
                    if (/^\s+$/.test(token)) continue;
                    tokens.push(
                        token.startsWith("'")
                            ? { value: token.slice(1, -1).replace(/''/g, "'") }
                            : token.toLowerCase()
                    );
                }
            } else {
                tokens.push({ value });
            }
        } else {
            tokens.push({ value: chunk });
        }
    }
    append(expression);
    let position = 0;
    const take = (expected: string) => {
        if (tokens[position++] !== expected) throw new Error(`Expected SQL token ${expected}`);
    };
    const equal = (left: unknown, right: unknown) =>
        left !== null &&
        left !== undefined &&
        right !== null &&
        right !== undefined &&
        (left === right ||
            ((typeof left === "number" || typeof left === "bigint") &&
                (typeof right === "number" || typeof right === "bigint") &&
                String(left) === String(right)));

    function primary(): unknown {
        const token = tokens[position++];
        let value: unknown;
        if (token === "(") {
            value = logicalOr();
            if (tokens[position] === ",") {
                const values = [value];
                while (tokens[position] === ",") {
                    position++;
                    values.push(logicalOr());
                }
                value = values;
            }
            take(")");
        } else if (token === "coalesce" || token === "jsonb_build_object") {
            take("(");
            const values = [logicalOr()];
            while (tokens[position] === ",") {
                position++;
                values.push(logicalOr());
            }
            take(")");
            value =
                token === "coalesce"
                    ? values.find(item => item !== null && item !== undefined)
                    : Object.fromEntries(
                          values.flatMap((item, index) =>
                              index % 2 === 0 ? [[String(item), values[index + 1]]] : []
                          )
                      );
        } else if (token && typeof token === "object") {
            value = token.value;
        } else {
            throw new Error(`Unexpected SQL token ${String(token)}`);
        }
        while (tokens[position] === "::" || tokens[position] === "->") {
            if (tokens[position++] === "::") {
                take("jsonb");
                if (typeof value === "string") value = JSON.parse(value);
            } else {
                const key = tokens[position++];
                if (!key || typeof key !== "object") throw new Error("Expected JSON key");
                value = (value as Record<string, unknown> | null)?.[String(key.value)];
            }
        }
        return value;
    }
    function concatenation(): unknown {
        let value = primary();
        while (tokens[position] === "||") {
            position++;
            value = { ...(value as object), ...(primary() as object) };
        }
        return value;
    }
    function comparison(): unknown {
        const left = concatenation();
        const operator = tokens[position];
        if (operator === "=" || operator === ">" || operator === "like" || operator === "in") {
            position++;
            const right = concatenation();
            if (operator === "=") return equal(left, right);
            if (operator === ">") return String(left) > String(right);
            if (operator === "in")
                return (Array.isArray(right) ? right : [right]).some(value => equal(left, value));
            const pattern = String(right)
                .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
                .replace(/%/g, ".*")
                .replace(/_/g, ".");
            return typeof left === "string" && new RegExp(`^${pattern}$`).test(left);
        }
        if (operator === "is") {
            position++;
            take("distinct");
            take("from");
            return JSON.stringify(left) !== JSON.stringify(concatenation());
        }
        return left;
    }
    function logicalAnd(): unknown {
        let value = comparison();
        while (tokens[position] === "and") {
            position++;
            const right = comparison();
            value = Boolean(value) && Boolean(right);
        }
        return value;
    }
    function logicalOr(): unknown {
        let value = logicalAnd();
        while (tokens[position] === "or") {
            position++;
            const right = logicalAnd();
            value = Boolean(value) || Boolean(right);
        }
        return value;
    }
    const result = logicalOr();
    if (position !== tokens.length) throw new Error("Unconsumed SQL expression");
    return result;
}

class IndexDatabase {
    call: Call | null = {
        id: "call-42",
        companyId: 42n,
        title: "Customer call",
        status: "completed",
        documentNoteId: 314,
        noteOwnerUserId: "owner",
        noteVisibility: "company",
        currentNoteRevision: 3,
        indexedDocumentId: null,
        indexedRevision: null,
    };
    note: Note | null = {
        id: 314,
        userId: "owner",
        companyId: "42",
        title: "Approved Call Note",
        contentMarkdown: "## Outcome\n\nCanonical owner text.",
        content: "Legacy text that must not replace Markdown",
    };
    published: PublishedDocument | null = null;
    otherCalls: Call[] = [];
    otherDocuments: PublishedDocument[] = [];
    versions: { documentId: number; url: string }[] = [];
    uploads = new Map<number, UploadRow>();
    beforeLock?: () => void;
    beforeCallBatch?: () => void;
    beforeDocumentUpdate?: () => void;

    calls() {
        return [...(this.call ? [this.call] : []), ...this.otherCalls];
    }

    documents() {
        return [...(this.published ? [this.published] : []), ...this.otherDocuments];
    }

    columns(
        call?: Call | null,
        doc?: PublishedDocument | null,
        version?: { documentId: number; url: string } | null,
        upload?: UploadRow
    ) {
        return new Map<unknown, unknown>([
            [callNotesCalls.id, call?.id],
            [callNotesCalls.companyId, call?.companyId],
            [callNotesCalls.status, call?.status],
            [callNotesCalls.indexedDocumentId, call?.indexedDocumentId],
            [documentNotes.id, this.note?.id],
            [document.id, doc?.id],
            [document.companyId, doc?.companyId ?? 42n],
            [document.url, doc?.url],
            [document.ocrMetadata, doc?.ocrMetadata],
            [documentVersions.documentId, version?.documentId],
            [documentVersions.url, version?.url],
            [fileUploads.id, upload?.id],
            [fileUploads.companyId, upload?.companyId],
            [fileUploads.storageUrl, upload?.storageUrl],
        ]);
    }

    select() {
        return {
            from: (table: unknown) => {
                let joined = false;
                let condition: unknown;
                let limit = Infinity;
                let ordered = false;
                const rows = () => {
                    if (ordered) this.beforeCallBatch?.();
                    if (table === callNotesCalls) {
                        return this.calls()
                            .filter(call => !condition || sqlValue(condition, this.columns(call)))
                            .sort((left, right) => left.id.localeCompare(right.id))
                            .slice(0, limit)
                            .map(call =>
                                joined
                                    ? {
                                          call: structuredClone(call),
                                          note: structuredClone(this.note),
                                      }
                                    : structuredClone(call)
                            );
                    }
                    if (table === documentNotes)
                        return this.note && sqlValue(condition, this.columns())
                            ? [structuredClone(this.note)]
                            : [];
                    if (table === document) {
                        return this.documents()
                            .flatMap(doc => {
                                const versions = this.versions.filter(
                                    row => row.documentId === doc.id
                                );
                                return (joined && versions.length > 0 ? versions : [null])
                                    .filter(version =>
                                        sqlValue(condition, this.columns(null, doc, version))
                                    )
                                    .map(() => ({ ...doc }));
                            })
                            .slice(0, limit);
                    }
                    if (table === fileUploads)
                        return [...this.uploads.values()].filter(upload =>
                            sqlValue(condition, this.columns(null, null, null, upload))
                        );
                    throw new Error("Unexpected table");
                };
                const query = {
                    leftJoin: () => {
                        joined = true;
                        return query;
                    },
                    where: (value: unknown) => {
                        condition = value;
                        return query;
                    },
                    orderBy: () => {
                        ordered = true;
                        return query;
                    },
                    limit: (value: number) => {
                        limit = value;
                        return query;
                    },
                    for: () => {
                        this.beforeLock?.();
                        return query;
                    },
                    then: (resolve: (value: unknown[]) => unknown) =>
                        Promise.resolve(rows()).then(resolve),
                };
                return query;
            },
        };
    }

    update(table: unknown) {
        return {
            set: (values: Record<string, unknown>) => {
                let joined = false;
                const query = {
                    from: () => {
                        joined = true;
                        return query;
                    },
                    where: async (condition: unknown) => {
                        if (table === callNotesCalls) {
                            for (const call of this.calls()) {
                                if (sqlValue(condition, this.columns(call)))
                                    Object.assign(call, values);
                            }
                        } else if (table === document) {
                            this.beforeDocumentUpdate?.();
                            for (const doc of this.documents()) {
                                for (const call of joined ? this.calls() : [null]) {
                                    const columns = this.columns(call, doc);
                                    if (!sqlValue(condition, columns)) continue;
                                    for (const [key, value] of Object.entries(values)) {
                                        Object.assign(doc, {
                                            [key]:
                                                value instanceof SQL
                                                    ? sqlValue(value, columns)
                                                    : value,
                                        });
                                    }
                                }
                            }
                        }
                    },
                };
                return query;
            },
        };
    }

    delete(table: unknown) {
        return {
            where: async (condition: unknown) => {
                if (table !== fileUploads) throw new Error("Unexpected deletion table");
                for (const [id, upload] of this.uploads) {
                    if (sqlValue(condition, this.columns(null, null, null, upload)))
                        this.uploads.delete(id);
                }
            },
        };
    }

    async transaction<T>(run: (tx: IndexDatabase) => Promise<T>): Promise<T> {
        return run(this);
    }
}

function setup(provider: "database" | "s3" = "database") {
    const database = new IndexDatabase();
    const markdown: string[] = [];
    let nextId = 1;
    const blobs = new Map<string, string>();
    const uploads = new Map<string, string>();
    let duringUpload: ((text: string) => void | Promise<void>) | undefined;
    const uploadFile: NonNullable<WebCallNoteIndexOptions["uploadFile"]> = jest.fn(async input => {
        const text = Buffer.from(input.data as Uint8Array).toString("utf8");
        markdown.push(text);
        const uploadId = markdown.length;
        const pathname = `documents/${uploadId}.md`;
        const url =
            provider === "database"
                ? `/api/files/${uploadId}`
                : `http://storage:9000/documents/${uploadId}.md`;
        uploads.set(url, text);
        database.uploads.set(uploadId, {
            id: uploadId,
            companyId: input.companyId!,
            storageUrl: provider === "database" ? null : url,
            text,
        });
        if (provider === "s3") blobs.set(pathname, text);
        await duringUpload?.(text);
        return { url, pathname, provider };
    });
    const processDocumentUpload: NonNullable<WebCallNoteIndexOptions["processDocumentUpload"]> =
        jest.fn(async input => {
            database.published = {
                id: nextId++,
                companyId: input.user.companyId,
                url: input.rawDocumentUrl,
                title: input.documentName,
                category: input.category ?? "",
                ocrMetadata: input.ocrMetadata,
                markdown: uploads.get(input.rawDocumentUrl),
            };
            return { document: { id: database.published.id } };
        });
    const createDocumentVersionLifecycle: NonNullable<
        WebCallNoteIndexOptions["createDocumentVersionLifecycle"]
    > = jest.fn(async input => {
        database.versions.push({ documentId: input.documentId, url: input.url });
        if (database.published) database.published.markdown = uploads.get(input.url);
        return { document: { id: input.documentId } };
    });
    const deleteDocumentCore: NonNullable<WebCallNoteIndexOptions["deleteDocumentCore"]> = jest.fn(
        async () => {
            database.published = null;
            return [];
        }
    );
    const deleteFile: NonNullable<WebCallNoteIndexOptions["deleteFile"]> = jest.fn(
        async pathname => {
            blobs.delete(pathname);
        }
    );
    const deleteFileByUrl: NonNullable<WebCallNoteIndexOptions["deleteFileByUrl"]> = jest.fn(
        async url => {
            if (!url.startsWith("/api/files/")) blobs.delete(new URL(url).pathname.slice(1));
        }
    );
    const index = createWebCallNoteIndex({
        db: database as unknown as DbClient,
        uploadFile,
        deleteFile,
        deleteFileByUrl,
        processDocumentUpload,
        createDocumentVersionLifecycle,
        findDocumentByCreationKey: async () => database.published,
        deleteDocumentCore,
        resolveProcessingUrl: async () => "http://app:3000/api/files/1",
        requestUrl: "http://app:3000",
    });
    return {
        database,
        markdown,
        blobs,
        deleteFile,
        deleteFileByUrl,
        uploadFile,
        processDocumentUpload,
        createDocumentVersionLifecycle,
        deleteDocumentCore,
        sync: () => index.sync({ companyId: "42", callId: "call-42" }),
        onUpload: (run: (text: string) => void | Promise<void>) => {
            duringUpload = run;
        },
    };
}

const CANONICAL_MARKDOWN = "# Approved Call Note\n\n## Outcome\n\nCanonical owner text.";

describe("canonical Call Note document index", () => {
    it("publishes the saved canonical Markdown as the Call's first document", async () => {
        const state = setup();
        await state.sync();

        expect(state.markdown).toEqual([CANONICAL_MARKDOWN]);
        expect(state.database.published).toMatchObject({
            id: 1,
            title: "Approved Call Note",
            category: "Calls",
        });
        expect(state.processDocumentUpload).toHaveBeenCalledWith(
            expect.objectContaining({
                creationKey: "call-note:call-42",
                ocrMetadata: { callNote: { callId: "call-42" } },
            })
        );
        expect(state.database.call).toMatchObject({ indexedDocumentId: 1n, indexedRevision: 3 });
    });

    it("versions a later saved revision under the same document identity", async () => {
        const state = setup();
        await state.sync();
        state.database.call!.currentNoteRevision = 4;
        state.database.note!.title = "Revised title";
        state.database.note!.contentMarkdown = "New accepted content.";
        state.database.published!.ocrMetadata = { processingProgress: { percent: 100 } };
        await state.sync();

        expect(state.markdown).toEqual([
            CANONICAL_MARKDOWN,
            "# Revised title\n\nNew accepted content.",
        ]);
        expect(state.database.published).toMatchObject({
            id: 1,
            title: "Revised title",
            category: "Calls",
            ocrMetadata: {
                processingProgress: { percent: 100 },
                callNote: { callId: "call-42" },
            },
        });
        expect(state.database.call).toMatchObject({ indexedDocumentId: 1n, indexedRevision: 4 });
        expect([...state.database.uploads.values()].map(upload => upload.text)).toEqual([
            CANONICAL_MARKDOWN,
            "# Revised title\n\nNew accepted content.",
        ]);
        expect(state.processDocumentUpload).toHaveBeenCalledTimes(1);
        expect(state.createDocumentVersionLifecycle).toHaveBeenCalledWith(
            expect.objectContaining({ documentId: 1, creationKey: "call-note:call-42:r4" })
        );
    });

    it("discards a successful lifecycle retry's upload when the existing version owns different bytes", async () => {
        const state = setup();
        await state.sync();
        state.database.call!.currentNoteRevision = 4;
        jest.mocked(state.createDocumentVersionLifecycle).mockResolvedValueOnce({
            document: { id: 1 },
        });
        await state.sync();

        expect([...state.database.uploads.keys()]).toEqual([1]);
        expect(state.database.published!.markdown).toBe(CANONICAL_MARKDOWN);
        expect(state.database.call).toMatchObject({ indexedDocumentId: 1n, indexedRevision: 4 });
    });

    it("does not upload or version an unchanged revision", async () => {
        const state = setup();
        await state.sync();
        await state.sync();

        expect(state.uploadFile).toHaveBeenCalledTimes(1);
        expect(state.createDocumentVersionLifecycle).not.toHaveBeenCalled();
        expect(state.database.call).toMatchObject({ indexedDocumentId: 1n, indexedRevision: 3 });
    });

    it("restores missing provenance on an unchanged document without discarding OCR metadata", async () => {
        const state = setup();
        await state.sync();
        state.database.published!.ocrMetadata = { processingProgress: { percent: 100 } };
        await state.sync();

        expect(state.database.published!.ocrMetadata).toEqual({
            processingProgress: { percent: 100 },
            callNote: { callId: "call-42" },
        });
        expect(state.database.published!.markdown).toBe(CANONICAL_MARKDOWN);
        expect(state.uploadFile).toHaveBeenCalledTimes(1);
        expect(state.createDocumentVersionLifecycle).not.toHaveBeenCalled();
    });

    it.each(["database", "s3"] as const)(
        "discards the %s upload when another sync has already published that revision",
        async provider => {
            const state = setup(provider);
            await state.sync();
            state.database.call!.currentNoteRevision = 4;
            state.onUpload(() => {
                state.database.call!.indexedRevision = 4;
                state.database.published!.ocrMetadata = { processingProgress: { percent: 100 } };
            });
            await state.sync();

            expect([...state.database.uploads.keys()]).toEqual([1]);
            expect([...state.blobs.keys()]).toEqual(provider === "s3" ? ["documents/1.md"] : []);
            expect(state.database.published!.ocrMetadata).toEqual({
                processingProgress: { percent: 100 },
                callNote: { callId: "call-42" },
            });
            expect(state.database.published!.markdown).toBe(CANONICAL_MARKDOWN);
            expect(state.createDocumentVersionLifecycle).not.toHaveBeenCalled();
        }
    );

    it("removes a private Call Note from the document corpus, including for its owner", async () => {
        const state = setup();
        await state.sync();
        state.database.call!.noteVisibility = "private";
        await state.sync();

        expect(state.database.published).toBeNull();
        expect(state.database.call).toMatchObject({
            indexedDocumentId: null,
            indexedRevision: null,
        });
        expect(state.database.note!.contentMarkdown).toBe("## Outcome\n\nCanonical owner text.");
        expect(state.uploadFile).toHaveBeenCalledTimes(1);
        expect(state.deleteDocumentCore).toHaveBeenCalledTimes(1);
    });

    it("never uploads a private note that has not been indexed", async () => {
        const state = setup();
        state.database.call!.noteVisibility = "private";
        await state.sync();

        expect(state.database.published).toBeNull();
        expect(state.uploadFile).not.toHaveBeenCalled();
        expect(state.database.call).toMatchObject({
            indexedDocumentId: null,
            indexedRevision: null,
        });
    });

    it("publishes again when a private note becomes company-visible", async () => {
        const state = setup();
        await state.sync();
        state.database.call!.noteVisibility = "private";
        await state.sync();
        state.database.call!.noteVisibility = "company";
        await state.sync();

        expect(state.database.published).toMatchObject({ id: 2, category: "Calls" });
        expect(state.database.call).toMatchObject({ indexedDocumentId: 2n, indexedRevision: 3 });
        expect(state.processDocumentUpload).toHaveBeenCalledTimes(2);
        expect(state.createDocumentVersionLifecycle).not.toHaveBeenCalled();
    });

    it("finds and removes the indexed document after its Call has been deleted", async () => {
        const state = setup();
        await state.sync();
        state.database.call = null;
        state.database.note = null;
        await state.sync();

        expect(state.database.published).toBeNull();
        expect(state.deleteDocumentCore).toHaveBeenCalledTimes(1);
    });

    it.each(["active", "finalizing", "failed"] as const)(
        "removes a document when the Call is %s",
        async status => {
            const state = setup();
            await state.sync();
            state.database.call!.status = status;
            await state.sync();

            expect(state.database.published).toBeNull();
            expect(state.database.call).toMatchObject({
                indexedDocumentId: null,
                indexedRevision: null,
            });
        }
    );

    it.each(["missing note", "zero revision"])("removes a document for %s", async reason => {
        const state = setup();
        await state.sync();
        if (reason === "missing note") state.database.note = null;
        else state.database.call!.currentNoteRevision = 0;
        await state.sync();

        expect(state.database.published).toBeNull();
        expect(state.database.call).toMatchObject({
            indexedDocumentId: null,
            indexedRevision: null,
        });
    });

    it("does not publish or record a rendered revision that became stale during upload", async () => {
        const state = setup();
        state.onUpload(() => {
            state.database.call!.currentNoteRevision = 4;
            state.database.note!.contentMarkdown = "Newer canonical content.";
        });
        await state.sync();

        expect(state.database.call).toMatchObject({
            indexedDocumentId: null,
            indexedRevision: null,
        });
        expect(state.database.published).toBeNull();
        expect(state.database.uploads.size).toBe(0);
        expect(state.processDocumentUpload).not.toHaveBeenCalled();
        state.onUpload(() => undefined);
        await state.sync();

        expect(state.database.published?.markdown).toBe(
            "# Approved Call Note\n\nNewer canonical content."
        );
        expect(state.database.call).toMatchObject({ indexedDocumentId: 1n, indexedRevision: 4 });
        expect(state.createDocumentVersionLifecycle).not.toHaveBeenCalled();
    });

    it("recovers a keyed document left by a prior interrupted publication", async () => {
        const state = setup();
        state.database.published = {
            id: 9,
            title: "Older title",
            category: "Calls",
            markdown: "Older content",
        };
        await state.sync();

        expect(state.database.published).toMatchObject({ id: 9, markdown: CANONICAL_MARKDOWN });
        expect(state.database.call).toMatchObject({ indexedDocumentId: 9n, indexedRevision: 3 });
        expect(state.processDocumentUpload).not.toHaveBeenCalled();
        expect(state.createDocumentVersionLifecycle).toHaveBeenCalledTimes(1);
    });

    it("does not let an older in-flight upload replace a newer indexed document", async () => {
        const state = setup();
        await state.sync();
        state.database.call!.currentNoteRevision = 4;
        state.database.note!.contentMarkdown = "Older revision.";
        let releaseOlderUpload!: () => void;
        let markOlderUploaded!: () => void;
        const delayedUpload = new Promise<void>(resolve => {
            releaseOlderUpload = resolve;
        });
        const olderUploaded = new Promise<void>(resolve => {
            markOlderUploaded = resolve;
        });
        state.onUpload(text => {
            if (text.includes("Older revision.")) {
                markOlderUploaded();
                return delayedUpload;
            }
        });
        const olderSync = state.sync();
        await olderUploaded;
        state.database.call!.currentNoteRevision = 5;
        state.database.note!.contentMarkdown = "Newest accepted revision.";
        await state.sync();
        releaseOlderUpload();
        await olderSync;
        await state.sync();

        expect(state.database.published).toMatchObject({
            id: 1,
            markdown: "# Approved Call Note\n\nNewest accepted revision.",
        });
        expect(state.database.call).toMatchObject({ indexedDocumentId: 1n, indexedRevision: 5 });
        expect([...state.database.uploads.keys()]).toEqual([1, 3]);
        expect(state.createDocumentVersionLifecycle).toHaveBeenCalledTimes(1);
    });

    it.each(["database", "s3"] as const)(
        "revokes the %s upload when the Call becomes private before taking the lock",
        async provider => {
            const state = setup(provider);
            state.onUpload(() => {
                state.database.call!.noteVisibility = "private";
            });
            await state.sync();

            expect(state.database.published).toBeNull();
            expect(state.database.call).toMatchObject({
                indexedDocumentId: null,
                indexedRevision: null,
            });
            expect(state.database.uploads.size).toBe(0);
            expect(state.blobs.size).toBe(0);
            expect(state.processDocumentUpload).not.toHaveBeenCalled();
        }
    );

    it.each(["database", "s3"] as const)(
        "revokes the %s upload when the Call is deleted during upload",
        async provider => {
            const state = setup(provider);
            state.onUpload(() => {
                state.database.call = null;
                state.database.note = null;
            });
            await state.sync();

            expect(state.database.published).toBeNull();
            expect(state.database.uploads.size).toBe(0);
            expect(state.blobs.size).toBe(0);
            expect(state.processDocumentUpload).not.toHaveBeenCalled();
        }
    );

    it.each(["database", "s3"] as const)(
        "discards an unreferenced %s upload when publication throws",
        async provider => {
            const state = setup(provider);
            jest.mocked(state.processDocumentUpload).mockRejectedValueOnce(
                new Error("Ingestion unavailable")
            );

            await expect(state.sync()).rejects.toThrow("Ingestion unavailable");

            expect(state.database.published).toBeNull();
            expect(state.database.uploads.size).toBe(0);
            expect(state.blobs.size).toBe(0);
            expect(state.database.call!.indexedDocumentId).toBeNull();
        }
    );

    it.each(["database", "s3"] as const)(
        "discards the unused %s upload and retains durable provenance when deleted-Call cleanup throws",
        async provider => {
            const state = setup(provider);
            await state.sync();
            state.database.published!.ocrMetadata = { processingProgress: { percent: 100 } };
            state.database.call!.currentNoteRevision = 4;
            state.onUpload(() => {
                state.database.call = null;
                state.database.note = null;
            });
            jest.mocked(state.deleteDocumentCore).mockRejectedValueOnce(
                new Error("Cleanup failed")
            );

            await expect(state.sync()).rejects.toThrow("Cleanup failed");

            expect([...state.database.uploads.keys()]).toEqual([1]);
            expect([...state.blobs.keys()]).toEqual(provider === "s3" ? ["documents/1.md"] : []);
            expect(state.database.published!.ocrMetadata).toEqual({
                processingProgress: { percent: 100 },
                callNote: { callId: "call-42" },
            });
            expect(state.database.call).toBeNull();
        }
    );

    it.each(["database", "s3"] as const)(
        "keeps a referenced %s upload when the Call bookkeeping fails after ingestion commits",
        async provider => {
            const state = setup(provider);
            state.database.beforeDocumentUpdate = () => {
                throw new Error("Call transaction failed");
            };

            await expect(state.sync()).rejects.toThrow("Call transaction failed");

            expect(state.database.published!.markdown).toBe(CANONICAL_MARKDOWN);
            expect([...state.database.uploads.values()].map(upload => upload.text)).toEqual([
                CANONICAL_MARKDOWN,
            ]);
            expect([...state.blobs.values()]).toEqual(
                provider === "s3" ? [CANONICAL_MARKDOWN] : []
            );
        }
    );

    it.each(["database", "s3"] as const)(
        "keeps a version-only %s reference when Call bookkeeping fails after the version commits",
        async provider => {
            const state = setup(provider);
            await state.sync();
            state.database.call!.currentNoteRevision = 4;
            state.database.note!.contentMarkdown = "New version bytes.";
            state.database.beforeDocumentUpdate = () => {
                if (state.database.versions.length > 0) throw new Error("Call transaction failed");
            };

            await expect(state.sync()).rejects.toThrow("Call transaction failed");

            expect([...state.database.uploads.values()].map(upload => upload.text)).toEqual([
                CANONICAL_MARKDOWN,
                "# Approved Call Note\n\nNew version bytes.",
            ]);
            expect([...state.blobs.values()]).toEqual(
                provider === "s3"
                    ? [CANONICAL_MARKDOWN, "# Approved Call Note\n\nNew version bytes."]
                    : []
            );
        }
    );

    it("does not let delayed private cleanup erase a newer company-visible revision", async () => {
        const state = setup();
        await state.sync();
        state.database.call!.noteVisibility = "private";
        state.database.beforeLock = () => {
            state.database.call!.noteVisibility = "company";
        };
        await state.sync();

        expect(state.database.published).toMatchObject({ id: 1, title: "Approved Call Note" });
        expect(state.database.call).toMatchObject({ indexedDocumentId: 1n, indexedRevision: 3 });
        expect(state.deleteDocumentCore).not.toHaveBeenCalled();
    });
});

describe("Call Note document backfill provenance", () => {
    it("stamps every same-company indexed reference before syncing, regardless of Call eligibility", async () => {
        const state = setup();
        await state.sync();
        state.database.published!.ocrMetadata = { processingProgress: { percent: 100 } };
        state.database.otherCalls = [
            {
                ...state.database.call!,
                id: "active-call",
                status: "active",
                indexedDocumentId: 2n,
            },
            {
                ...state.database.call!,
                id: "private-call",
                companyId: 43n,
                noteVisibility: "private",
                status: "failed",
                indexedDocumentId: 3n,
            },
            {
                ...state.database.call!,
                id: "mismatched-company",
                status: "active",
                indexedDocumentId: 4n,
            },
        ];
        state.database.otherDocuments = [
            { id: 2, companyId: 42n, title: "Active", category: "Calls", ocrMetadata: null },
            { id: 3, companyId: 43n, title: "Private", category: "Calls" },
            {
                id: 4,
                companyId: 43n,
                title: "Different company",
                category: "Calls",
                ocrMetadata: { source: "ordinary" },
            },
            {
                id: 5,
                companyId: 42n,
                title: "Not Call-owned",
                category: "Reports",
                ocrMetadata: { source: "ordinary" },
            },
        ];
        const expectedMetadata = [
            { processingProgress: { percent: 100 }, callNote: { callId: "call-42" } },
            { callNote: { callId: "active-call" } },
            { callNote: { callId: "private-call" } },
            { source: "ordinary" },
            { source: "ordinary" },
        ];
        state.database.beforeCallBatch = () => {
            expect(state.database.documents().map(doc => doc.ocrMetadata)).toEqual(
                expectedMetadata
            );
        };
        const db = state.database as unknown as DbClient;

        await expect(callNoteDocuments.step({ db, cursor: null, batchSize: 1 })).resolves.toEqual({
            cursor: "call-42",
            processed: 1,
        });
        await expect(
            callNoteDocuments.step({ db, cursor: "call-42", batchSize: 1 })
        ).resolves.toEqual({ cursor: null, processed: 0 });

        expect(state.database.documents().map(doc => doc.ocrMetadata)).toEqual(expectedMetadata);
        expect(state.database.published!.markdown).toBe(CANONICAL_MARKDOWN);
        expect(state.uploadFile).toHaveBeenCalledTimes(1);
    });
});
