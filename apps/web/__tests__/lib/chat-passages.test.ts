import {
    addPassage,
    cleanSelectionText,
    isChatPassage,
    makePassage,
    MAX_PASSAGE_CHARS,
    MAX_PASSAGES,
    passageLabel,
    passagesAsText,
    toPassagePayload,
    withoutQuotedContext,
    type ChatPassage,
} from "~/lib/chat-passages";

const passage = (text: string, page?: number): ChatPassage => ({
    sourceId: "d7",
    documentId: 7,
    title: "Dense X Retrieval.pdf",
    ...(page ? { page } : {}),
    text,
});

describe("cleanSelectionText", () => {
    it("joins a PDF column's visual lines into one paragraph", () => {
        expect(
            cleanSelectionText(
                "We discover that the retrieval unit\nchoice significantly impacts the performance of\nboth retrieval and downstream tasks."
            )
        ).toBe(
            "We discover that the retrieval unit choice significantly impacts the performance of both retrieval and downstream tasks."
        );
    });

    it("joins a word broken across lines and keeps its hyphen, so it still matches the page", () => {
        expect(cleanSelectionText("a novel re-\ntrieval unit")).toBe("a novel re-trieval unit");
    });

    it("keeps paragraph breaks and trims edge whitespace", () => {
        expect(cleanSelectionText("  First line\nsame para.\n\n\nSecond para.  ")).toBe(
            "First line same para.\n\nSecond para."
        );
    });

    it("caps the passage length", () => {
        expect(cleanSelectionText("x".repeat(MAX_PASSAGE_CHARS + 50))).toHaveLength(
            MAX_PASSAGE_CHARS
        );
    });
});

describe("makePassage", () => {
    it("builds a passage with page and document id", () => {
        expect(
            makePassage({
                sourceId: "d7",
                documentId: 7,
                title: "Dense X Retrieval.pdf",
                page: 3,
                text: "line one\nline two",
            })
        ).toEqual({
            sourceId: "d7",
            documentId: 7,
            title: "Dense X Retrieval.pdf",
            page: 3,
            text: "line one line two",
        });
    });

    it("returns null for an empty selection and drops a page it does not know", () => {
        expect(makePassage({ sourceId: "d7", title: "Doc", text: "  \n " })).toBeNull();
        expect(makePassage({ sourceId: "chat", title: "Chat", page: 0, text: "hi" })).toEqual({
            sourceId: "chat",
            title: "Chat",
            text: "hi",
        });
    });
});

describe("addPassage", () => {
    it("skips a passage that is already attached", () => {
        const list = addPassage([], passage("same", 2));
        expect(addPassage(list, passage("same", 2))).toHaveLength(1);
        expect(addPassage(list, passage("same", 3))).toHaveLength(2);
    });

    it("keeps the newest five", () => {
        let list: ChatPassage[] = [];
        for (let i = 1; i <= MAX_PASSAGES + 2; i++) list = addPassage(list, passage(`p${i}`));
        expect(list.map(item => item.text)).toEqual(["p3", "p4", "p5", "p6", "p7"]);
    });
});

describe("labels and text forms", () => {
    it("names the page when known", () => {
        expect(passageLabel(passage("t", 4))).toBe("Dense X Retrieval.pdf · p. 4");
        expect(passageLabel(passage("t"))).toBe("Dense X Retrieval.pdf");
    });

    it("writes passages as plain text for conversation history", () => {
        expect(passagesAsText([passage("A proposition is an atomic fact.", 2)])).toBe(
            '[Selected passage from "Dense X Retrieval.pdf · p. 2"]\n"A proposition is an atomic fact."'
        );
    });

    it("sends the server only what it needs", () => {
        expect(toPassagePayload(passage("t", 4))).toEqual({
            documentId: 7,
            title: "Dense X Retrieval.pdf",
            page: 4,
            text: "t",
        });
    });

    it("recognises stored passages and rejects malformed ones", () => {
        expect(isChatPassage(passage("t", 1))).toBe(true);
        expect(isChatPassage({ sourceId: "d7", title: "x", text: "" })).toBe(false);
        expect(isChatPassage({ sourceId: "d7", title: "x", text: "t", page: -1 })).toBe(false);
        expect(isChatPassage("t")).toBe(false);
    });
});

describe("withoutQuotedContext", () => {
    it("strips an old pasted quote and its machine link, keeping the question", () => {
        expect(
            withoutQuotedContext(
                "> sentence. We discover that\n> the retrieval unit\n\n[Quoted context](#launchstack-quoted-context)\n\nWhat do they propose?"
            )
        ).toBe("What do they propose?");
    });

    it("leaves a message without quotes alone", () => {
        expect(withoutQuotedContext("What is the indemnity cap?")).toBe(
            "What is the indemnity cap?"
        );
    });
});
