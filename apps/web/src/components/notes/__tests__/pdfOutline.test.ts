import {
    currentOutlineId,
    indexOutline,
    outlineAncestors,
    visibleOutlineRoots,
    loadPdfOutline,
    pageFromLabel,
    pageLabelFor,
    type PdfOutlineItem,
    type PdfOutlineNode,
    type PdfOutlineSource,
} from "../_shared/pdfOutline";

/**
 * A stand-in for pdf.js's document: page refs are `{ num }` objects whose
 * `num` is the 0-based page index, named destinations are looked up in a
 * table, and a ref with no `num` fails the way a damaged file does.
 */
function fakePdf(
    outline: PdfOutlineItem[] | null,
    named: Record<string, unknown[]> = {}
): PdfOutlineSource {
    return {
        getOutline: () => Promise.resolve(outline),
        getDestination: (name: string) => Promise.resolve(named[name] ?? null),
        getPageIndex: (ref: unknown) => {
            const num = (ref as { num?: number }).num;
            return typeof num === "number"
                ? Promise.resolve(num)
                : Promise.reject(new Error("bad ref"));
        },
    };
}

const ref = (index: number) => ({ num: index, gen: 0 });

describe("loadPdfOutline", () => {
    it("resolves explicit and named destinations to 1-based pages", async () => {
        const pdf = fakePdf(
            [
                { title: " Introduction ", dest: [ref(0), { name: "XYZ" }], items: [] },
                { title: "Methods", dest: "methods", items: [] },
                { title: "By index", dest: [4, { name: "Fit" }], items: [] },
            ],
            { methods: [ref(2), { name: "Fit" }] }
        );

        expect(await loadPdfOutline(pdf)).toEqual<PdfOutlineNode[]>([
            { id: "0", title: "Introduction", page: 1, children: [] },
            { id: "1", title: "Methods", page: 3, children: [] },
            { id: "2", title: "By index", page: 5, children: [] },
        ]);
    });

    it("keeps an entry whose destination fails, with no page", async () => {
        const pdf = fakePdf([
            { title: "Broken ref", dest: [{ gen: 0 }], items: [] },
            { title: "Unknown name", dest: "nowhere", items: [] },
            { title: "No destination", dest: null, items: [] },
        ]);

        expect((await loadPdfOutline(pdf)).map(node => node.page)).toEqual([null, null, null]);
    });

    it("hoists the children of an untitled entry into its place", async () => {
        const pdf = fakePdf([
            { title: "Part I", dest: [ref(0)], items: [] },
            {
                title: "   ",
                dest: [ref(1)],
                items: [
                    { title: "Chapter 1", dest: [ref(1)], items: [] },
                    { title: "Chapter 2", dest: [ref(5)], items: [] },
                ],
            },
            { title: "Part II", dest: [ref(9)], items: [] },
        ]);

        const nodes = await loadPdfOutline(pdf);
        expect(nodes.map(node => [node.id, node.title, node.page])).toEqual([
            ["0", "Part I", 1],
            ["1.0", "Chapter 1", 2],
            ["1.1", "Chapter 2", 6],
            ["2", "Part II", 10],
        ]);
    });

    it("nests children and gives them path ids", async () => {
        const pdf = fakePdf([
            {
                title: "Part I",
                dest: [ref(0)],
                items: [{ title: "Chapter 1", dest: [ref(0)], items: [] }],
            },
        ]);

        expect(await loadPdfOutline(pdf)).toEqual([
            {
                id: "0",
                title: "Part I",
                page: 1,
                children: [{ id: "0.0", title: "Chapter 1", page: 1, children: [] }],
            },
        ]);
    });

    it("is empty for a document without an outline, or one that cannot be read", async () => {
        expect(await loadPdfOutline(fakePdf(null))).toEqual([]);
        expect(await loadPdfOutline(fakePdf([]))).toEqual([]);
        expect(
            await loadPdfOutline({
                ...fakePdf([]),
                getOutline: () => Promise.reject(new Error("corrupt")),
            })
        ).toEqual([]);
    });
});

describe("currentOutlineId", () => {
    const tree: PdfOutlineNode[] = [
        {
            id: "0",
            title: "Part I",
            page: 1,
            children: [
                { id: "0.0", title: "Chapter 1", page: 1, children: [] },
                { id: "0.1", title: "Chapter 2", page: 6, children: [] },
                { id: "0.2", title: "Unresolved", page: null, children: [] },
            ],
        },
        { id: "1", title: "Part II", page: 12, children: [] },
    ];

    it("picks the last node in reading order that starts at or before the page", () => {
        expect(currentOutlineId(tree, 3)).toBe("0.0");
        expect(currentOutlineId(tree, 6)).toBe("0.1");
        expect(currentOutlineId(tree, 11)).toBe("0.1");
        expect(currentOutlineId(tree, 40)).toBe("1");
    });

    it("gives a tie to the deeper node and skips nodes with no page", () => {
        expect(currentOutlineId(tree, 1)).toBe("0.0");
        expect(currentOutlineId(tree, 9)).toBe("0.1");
    });

    it("is null before the first node", () => {
        expect(currentOutlineId([{ ...tree[1]! }], 3)).toBeNull();
        expect(currentOutlineId([], 3)).toBeNull();
    });
});

describe("page labels", () => {
    const labels = ["A", "B", "1", "2"];

    it("labels a page, falling back to its number", () => {
        expect(pageLabelFor(labels, 1)).toBe("A");
        expect(pageLabelFor(labels, 3)).toBe("1");
        expect(pageLabelFor(labels, 9)).toBe("9");
        expect(pageLabelFor(null, 2)).toBe("2");
        expect(pageLabelFor(["", "ii"], 1)).toBe("1");
    });

    it("prefers a label the reader typed over the same digits as a page number", () => {
        expect(pageFromLabel(labels, "1", 4)).toBe(3);
        expect(pageFromLabel(labels, "2", 4)).toBe(4);
        expect(pageFromLabel(labels, " b ", 4)).toBe(2);
        expect(pageFromLabel(labels, "a", 4)).toBe(1);
    });

    it("falls back to a plain page number within the document", () => {
        expect(pageFromLabel(labels, "3", 4)).toBe(3);
        expect(pageFromLabel(null, "4", 4)).toBe(4);
        expect(pageFromLabel(labels, "5", 4)).toBeNull();
        expect(pageFromLabel(null, "0", 4)).toBeNull();
    });

    it("rejects what is neither", () => {
        expect(pageFromLabel(labels, "x", 4)).toBeNull();
        expect(pageFromLabel(labels, "", 4)).toBeNull();
        expect(pageFromLabel(null, "2.5", 4)).toBeNull();
    });
});

describe("outline shape", () => {
    const leaf = (id: string, page: number): PdfOutlineNode => ({
        id,
        title: id,
        page,
        children: [],
    });
    const wrapped: PdfOutlineNode[] = [
        {
            id: "0",
            title: "Table of Contents",
            page: 1,
            children: [leaf("0.0", 1), leaf("0.1", 5)],
        },
    ];

    it("drops a lone root that only holds the others", () => {
        expect(visibleOutlineRoots(wrapped).map(node => node.id)).toEqual(["0.0", "0.1"]);
        expect(visibleOutlineRoots([leaf("0", 1)]).map(node => node.id)).toEqual(["0"]);
        expect(visibleOutlineRoots([leaf("0", 1), leaf("1", 2)]).map(node => node.id)).toEqual([
            "0",
            "1",
        ]);
    });

    it("indexes parents and depths, and walks the ancestors of a node", () => {
        const tree: PdfOutlineNode[] = [
            { ...leaf("0", 1), children: [{ ...leaf("0.0", 1), children: [leaf("0.0.0", 2)] }] },
            leaf("1", 9),
        ];
        const { parents, depths } = indexOutline(tree);
        expect(parents.get("0.0.0")).toBe("0.0");
        expect(parents.get("1")).toBeNull();
        expect(depths.get("0.0.0")).toBe(2);
        expect(Array.from(outlineAncestors("0.0.0", parents))).toEqual(["0.0", "0"]);
        expect(outlineAncestors("1", parents).size).toBe(0);
        expect(outlineAncestors(null, parents).size).toBe(0);
    });
});
