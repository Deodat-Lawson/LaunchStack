/**
 * The pure halves of shared chats (ADR-014 §4): what a reader's copy of a
 * transcript keeps, who counts as its audience, and what a fork is called.
 * The database halves run against Postgres in `chat-sharing.integration.test.ts`.
 */

jest.mock("~/server/db", () => ({ db: {} }));

import type { SessionMessage } from "~/server/sessions/repository";
import { forkTitle } from "~/server/sessions/fork";
import { chatAudience } from "~/server/sessions/sharing";
import { filterMessagesForReader, parseSourceId, sourceIdsIn } from "~/server/sessions/visibility";

function message(over: Partial<SessionMessage>): SessionMessage {
    return { seq: 0, role: "assistant", text: "", createdAt: "2026-10-10T00:00:00Z", ...over };
}

describe("parseSourceId", () => {
    it("reads documents and mindmaps, and nothing else", () => {
        expect(parseSourceId("d12")).toEqual({ kind: "document", id: 12 });
        expect(parseSourceId("m3")).toEqual({ kind: "mindmap", id: 3 });
        for (const id of ["s1", "d", "d-1", "d0", "x12", "d12; drop", "D12"]) {
            expect(parseSourceId(id)).toBeNull();
        }
    });
});

describe("filterMessagesForReader", () => {
    const visible = new Set(["d1", "m2"]);

    it("drops citations outside the reader's scope and counts them, per turn and in total", () => {
        const { messages, hiddenCitations } = filterMessagesForReader(
            [
                message({
                    citations: [
                        { sourceId: "d1", snippet: "ok" },
                        { sourceId: "d9", snippet: "secret", matchText: "secret" },
                        { sourceId: "m2", snippet: "map" },
                        { snippet: "no id" },
                        "garbage",
                    ],
                }),
                message({ seq: 1, citations: [{ sourceId: "d9", snippet: "secret" }] }),
            ],
            visible
        );

        expect(messages[0]!.citations).toEqual([
            { sourceId: "d1", snippet: "ok" },
            { sourceId: "m2", snippet: "map" },
        ]);
        expect(messages[0]!.hiddenCitations).toBe(3);
        expect(messages[1]!.citations).toEqual([]);
        expect(messages[1]!.hiddenCitations).toBe(1);
        expect(hiddenCitations).toBe(4);
        expect(JSON.stringify(messages)).not.toContain("secret");
    });

    it("filters pinned refs on the turn and on its send, and leaves the words alone", () => {
        const { messages } = filterMessagesForReader(
            [
                message({
                    role: "user",
                    text: "Compare d9 with the handbook",
                    refs: ["d1", "d9"],
                    metadata: {
                        id: "u1",
                        send: {
                            text: "Compare",
                            refs: ["d9", "m2"],
                            attachments: [],
                            webSearch: false,
                            thinking: false,
                            agentKey: null,
                        },
                    },
                }),
            ],
            visible
        );

        expect(messages[0]!.refs).toEqual(["d1"]);
        expect(messages[0]!.metadata?.send?.refs).toEqual(["m2"]);
        expect(messages[0]!.metadata?.id).toBe("u1");
        expect(messages[0]!.text).toBe("Compare d9 with the handbook");
        expect(messages[0]!.hiddenCitations).toBeUndefined();
    });

    it("never hands a reader the owner's other chats (threadRefs)", () => {
        const { messages } = filterMessagesForReader(
            [
                message({
                    role: "user",
                    text: "Like we said in the other chat",
                    metadata: {
                        send: {
                            text: "Like we said",
                            refs: [],
                            attachments: [],
                            webSearch: false,
                            thinking: false,
                            agentKey: null,
                            threadRefs: ["owner-private-chat"],
                        },
                    },
                }),
            ],
            visible
        );

        expect(messages[0]!.metadata?.send?.threadRefs).toBeUndefined();
        expect(JSON.stringify(messages)).not.toContain("owner-private-chat");
    });

    it("keeps an answer's steps and timings but never the names in them", () => {
        const { messages } = filterMessagesForReader(
            [
                message({
                    metadata: {
                        steps: [
                            {
                                id: "thread-refs",
                                label: "Read a referenced chat",
                                state: "done",
                                detail: "Owner's private chat: layoffs plan",
                                startMs: 10,
                                endMs: 90,
                            },
                            {
                                id: "search",
                                label: "Found 2 passages in 1 source",
                                state: "done",
                                detail: "Acquisition LOI - CONFIDENTIAL.pdf",
                                startMs: 100,
                                endMs: 700,
                            },
                            {
                                id: "attachments",
                                label: "Read 1 attachment",
                                state: "done",
                                detail: "salaries.xlsx",
                            },
                            {
                                id: "source-1",
                                label: "Reading “Acquisition LOI - CONFIDENTIAL.pdf”",
                                state: "done",
                            },
                            {
                                id: "web-2",
                                label: "Searching the web for “layoffs at our biggest client”",
                                state: "done",
                            },
                        ],
                    },
                }),
                message({
                    metadata: {
                        status: "stopped",
                        steps: [
                            {
                                id: "search",
                                label: "Searching Acquisition LOI - CONFIDENTIAL.pdf",
                                state: "active",
                                startMs: 40,
                                endMs: 300,
                            },
                        ],
                    },
                }),
            ],
            new Set()
        );
        expect(messages[0]!.metadata?.steps).toEqual([
            {
                id: "thread-refs",
                label: "Read a referenced chat",
                state: "done",
                startMs: 10,
                endMs: 90,
            },
            {
                id: "search",
                label: "Found 2 passages in 1 source",
                state: "done",
                startMs: 100,
                endMs: 700,
            },
            { id: "attachments", label: "Read 1 attachment", state: "done" },
            { id: "source-1", label: "Looked through the sources", state: "done" },
            { id: "web-2", label: "Searched the web", state: "done" },
        ]);
        expect(messages[1]!.metadata?.steps).toEqual([
            {
                id: "search",
                label: "Searching your sources",
                state: "active",
                startMs: 40,
                endMs: 300,
            },
        ]);
        expect(JSON.stringify(messages)).not.toMatch(/CONFIDENTIAL|layoffs|salaries/);
    });

    it("collects every source id a transcript mentions", () => {
        const ids = sourceIdsIn(
            [
                message({
                    refs: ["d1"],
                    citations: [{ sourceId: "m2" }, { nope: true }],
                    metadata: {
                        send: {
                            text: "",
                            refs: ["d3"],
                            attachments: [],
                            webSearch: false,
                            thinking: false,
                            agentKey: null,
                        },
                    },
                }),
            ],
            ["d4"]
        );
        expect([...ids].sort()).toEqual(["d1", "d3", "d4", "m2"]);
    });
});

describe("chatAudience", () => {
    const members = [
        { userId: "1", role: "owner", groupIds: new Set<string>() },
        { userId: "2", role: "member", groupIds: new Set(["10"]) },
        { userId: "3", role: "member", groupIds: new Set<string>() },
        { userId: "4", role: "guest", groupIds: new Set<string>() },
        { userId: "5", role: "admin", groupIds: new Set<string>() },
    ];

    it("is the owner alone while private", () => {
        expect(chatAudience(members, "1", [])).toBe(1);
    });

    it("counts people reached through a person, a group or a role, once each", () => {
        expect(
            chatAudience(members, "1", [
                { principalType: "user", principalId: "2" },
                { principalType: "group", principalId: "10" },
                { principalType: "role", principalId: "admin" },
            ])
        ).toBe(3);
    });

    it("reaches everyone but guests through General access", () => {
        expect(chatAudience(members, "1", [{ principalType: "workspace", principalId: "*" }])).toBe(
            4
        );
    });

    it("doesn't count an owner who has left", () => {
        expect(chatAudience(members, null, [{ principalType: "user", principalId: "3" }])).toBe(1);
    });
});

describe("forkTitle", () => {
    it("marks the copy and stays within the column", () => {
        expect(forkTitle("Indemnity cap")).toBe("Indemnity cap (copy)");
        expect(forkTitle("  ")).toBe("Chat (copy)");
        const long = forkTitle("x".repeat(300));
        expect(long.length).toBeLessThanOrEqual(300);
        expect(long.endsWith("… (copy)")).toBe(true);
    });
});
