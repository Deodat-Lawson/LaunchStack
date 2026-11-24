/**
 * End to end, as Ask's model sees it: the chat's real diagram tools over the
 * real diagram service and model engine, with only storage faked — one row in
 * memory that a write replaces only over the revision it read, and a version
 * history. A flowchart is created from step text, read back as step text with
 * its box ids, rewritten from steps (ids kept, one undoable revision, the old
 * version kept), refused when a line cannot be read (nothing written), edited
 * by id, and read again.
 *
 * Set AGENTS_TRANSCRIPT_OUT to a file path to save the exchange as a
 * transcript.
 */
import { writeFileSync } from "node:fs";

import { activePage } from "~/app/employer/documents/_mindmap/model/doc";
import { flowchartLook, flowchartToSteps } from "~/app/employer/documents/_mindmap/model/flowchart";
import { parseDoc } from "~/app/employer/documents/_mindmap/model/serialize";
import { createDiagramTools, diagramToolsPrompt } from "~/server/chat-diagram-tools";
import type { ChatTool } from "~/server/chat-tool-loop";
import { summariseDoc } from "~/server/mindmap/repository";

import { makeWorkspaceContext } from "../helpers/workspace-context";

interface StoredRow {
    id: number;
    title: string;
    folder: string;
    doc: unknown;
    revision: number;
    nodeCount: number;
    edgeCount: number;
    searchText: string;
    deletedAt: null;
    createdByUserId: string;
    updatedByUserId: string;
    openedAt: Date;
    updatedAt: Date;
}

// One row of storage. The doc goes in and out as JSON, as through jsonb.
const store: { row: StoredRow | null; history: Array<{ revision: number; label?: string }> } = {
    row: null,
    history: [],
};
const stored = (): StoredRow => ({
    ...store.row!,
    doc: JSON.parse(JSON.stringify(store.row!.doc)),
});

jest.mock("~/server/db", () => ({
    db: {
        // editDiagram's compare-and-set: the write lands only over the revision it read.
        update: () => ({
            set: (patch: { revision: number; doc: unknown }) => ({
                where: () => ({
                    returning: async () => {
                        if (!store.row || patch.revision !== store.row.revision + 1) return [];
                        store.row = {
                            ...store.row,
                            ...patch,
                            doc: JSON.parse(JSON.stringify(patch.doc)),
                        };
                        return [stored()];
                    },
                }),
            }),
        }),
    },
}));
jest.mock("~/server/mindmap/repository", () => {
    const actual = jest.requireActual("~/server/mindmap/repository");
    return {
        ...actual,
        getMindmap: jest.fn(async (id: number) => (store.row?.id === id ? stored() : null)),
        listMindmaps: jest.fn(async () =>
            store.row
                ? [
                      {
                          id: store.row.id,
                          title: store.row.title,
                          folder: store.row.folder,
                          nodeCount: store.row.nodeCount,
                          updatedAt: "2026-11-21T09:00:00.000Z",
                          openedAt: "2026-11-21T09:00:00.000Z",
                      },
                  ]
                : []
        ),
        writeRevision: jest.fn(async (input: { revision: number; label?: string }) => {
            store.history.push({ revision: input.revision, label: input.label });
        }),
    };
});
jest.mock("~/server/mindmap/access", () => ({
    canEditDraftAt: (level: string | null) => level === "edit" || level === "manage",
    draftAccess: jest.fn(async () => ({ level: "manage" })),
    draftReader: jest.fn(async () => ({ companyId: BigInt(5), authUserId: "u1", scope: {} })),
}));
jest.mock("~/server/mindmap/create", () => ({
    DraftFolderError: class extends Error {},
    createMindmapDraft: jest.fn(
        async (_ctx: unknown, input: { title: string; folder?: string; doc: unknown }) => {
            const stats = jest.requireActual("~/server/mindmap/repository").summariseDoc(input.doc);
            store.row = {
                id: 21,
                title: input.title,
                folder: input.folder ?? "Unfiled",
                doc: JSON.parse(JSON.stringify(input.doc)),
                revision: 1,
                nodeCount: stats.nodeCount,
                edgeCount: stats.edgeCount,
                searchText: stats.searchText,
                deletedAt: null,
                createdByUserId: "u1",
                updatedByUserId: "u1",
                openedAt: new Date(),
                updatedAt: new Date(),
            };
            return stored();
        }
    ),
}));

const ctx = makeWorkspaceContext({ companyId: BigInt(5), userPk: BigInt(7) });
const signal = new AbortController().signal;

const transcript: string[] = [];
const say = (...lines: string[]) => transcript.push(...lines);

/** Call a tool as the chat loop does, and write the call and its answer down. */
async function call(
    tools: ChatTool[],
    name: string,
    args: Record<string, unknown>
): Promise<string> {
    const tool = tools.find(t => t.name === name)!;
    say("", `>>> ${name}(${JSON.stringify(args, null, 2)})`);
    try {
        const answer = await tool.run(args, signal);
        say("<<< ok", answer);
        return answer;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        say("<<< error", message);
        throw error;
    }
}

const fenced = (text: string) => /```steps\n([\s\S]*?)\n```/.exec(text)![1]!;
const idFor = (text: string, words: string) =>
    new RegExp(`^- ${words.replace(/[?]/g, "\\?")} \\(id: (n_\\w+)\\)`, "m").exec(text)![1]!;

const ORDERS = [
    "Start",
    "Receive the order",
    "In stock?",
    "  Yes: Pick and pack",
    "  No: Reorder from supplier -> Receive the order",
    "Ship it",
    "End",
].join("\n");

const REWRITE = [
    "Start",
    "Receive the order",
    "Paid?",
    "  Yes: Check stock",
    "  No: Send a payment reminder -> Paid?",
    "In stock?",
    "  Yes: Pick and pack",
    "  No: Reorder from supplier -> In stock?",
    "Ship it",
    "End",
].join("\n");

afterAll(() => {
    const out = process.env.AGENTS_TRANSCRIPT_OUT;
    if (out) writeFileSync(out, `${transcript.join("\n")}\n`, "utf8");
});

it("creates, reads, rewrites and edits a flowchart through Ask's tools, in step text", async () => {
    const session = createDiagramTools(ctx, {
        locale: "en",
        mode: "light",
        canCreate: true,
        canEdit: true,
    });
    const { tools } = session;
    say(
        "Ask's diagram tools, end to end: real tools, real diagram service, real model engine; storage is one row in memory.",
        "",
        "=== The system-prompt section the model is given ===",
        diagramToolsPrompt(session)
    );

    // 1. Create from steps.
    const created = await call(tools, "create_diagram", {
        title: "Order handling",
        type: "flowchart",
        steps: ORDERS,
    });
    expect(created).toContain('Created the flowchart "Order handling" (m21) with 7 shapes');
    const made = parseDoc(store.row!.doc);
    expect(made.settings.kind).toBe("flowchart");
    expect(made.settings.flowLayout).toBe("auto");
    for (const n of activePage(made).nodes) {
        expect(n.style.fill).toBe(flowchartLook.boxLook(n.shape, "light").style.fill);
        expect(n.style.strokeWidth).toBe(0); // no outline
        expect(n.textStyle.size).toBe(15);
    }

    // 2. Find it and read it: step text, Yes before No, an id per step.
    const found = await call(tools, "find_diagrams", {});
    expect(found).toContain('m21 "Order handling"');
    const read = await call(tools, "read_diagram", { diagram: "m21" });
    expect(fenced(read)).toBe(ORDERS);
    expect(read).not.toMatch(/\[n_/);
    const ids = Object.fromEntries(
        [
            "Start",
            "Receive the order",
            "In stock?",
            "Pick and pack",
            "Reorder from supplier",
            "Ship it",
            "End",
        ].map(w => [w, idFor(read, w)])
    );

    // 3. Rewrite from steps: a payment check before the stock check.
    const rewritten = await call(tools, "edit_diagram", { diagram: "m21", steps: REWRITE });
    expect(rewritten).toMatch(
        /Redrew the flowchart from 10 steps: kept 7 of its boxes; added n_\w+ "Paid\?", n_\w+ "Check stock", n_\w+ "Send a payment reminder"\./
    );
    expect(store.row!.revision).toBe(2);
    expect(store.history).toEqual([{ revision: 1, label: "Before an AI edit" }]);
    const afterRewrite = fenced(rewritten);
    expect(afterRewrite).toBe(REWRITE);
    for (const [words, id] of Object.entries(ids)) expect(idFor(rewritten, words)).toBe(id);

    // 4. A rewrite with a line that cannot be read: refused, nothing written.
    await expect(
        call(tools, "edit_diagram", {
            diagram: "m21",
            steps: REWRITE.replace("-> In stock?", "-> Restock"),
        })
    ).rejects.toThrow(/Line 8 .*"-> Restock" points at no step.*Nothing was changed/);
    expect(store.row!.revision).toBe(2);

    // 5. One small change by id: a note-worthy step after shipping.
    const edited = await call(tools, "edit_diagram", {
        diagram: "m21",
        edits: [
            { op: "disconnect", from: ids["Ship it"], to: ids.End },
            { op: "add", under: ids["Ship it"], text: "Email the tracking link", ref: "mail" },
            { op: "connect", from: "mail", to: ids.End },
        ],
    });
    expect(store.row!.revision).toBe(3);
    expect(fenced(edited)).toContain("Ship it\nEmail the tracking link\nEnd");

    // 6. Read it back.
    const final = await call(tools, "read_diagram", { diagram: "m21" });
    expect(fenced(final)).toBe(
        REWRITE.replace("Ship it\nEnd", "Ship it\nEmail the tracking link\nEnd")
    );
    expect(flowchartToSteps(activePage(parseDoc(store.row!.doc))).text).toBe(fenced(final));
    expect(summariseDoc(store.row!.doc).nodeCount).toBe(11);
    expect(session.touched).toEqual([
        {
            kind: "diagram",
            mindmapId: 21,
            title: "Order handling",
            folder: "Unfiled",
            edited: false,
        },
    ]);
    say(
        "",
        `=== Stored: revision ${store.row!.revision}; history: ${JSON.stringify(store.history)} ===`
    );
});
