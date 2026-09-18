import { createDoc, createNode, createPage } from "../model/factory";
import { parseDoc } from "../model/serialize";
import { buildTemplate, kindForTemplate } from "../model/templates";
import { TEMPLATE_META } from "../model/template-meta";
import { DOC_SCHEMA_VERSION } from "../model/types";

/**
 * The document knows what kind of diagram it is, and old documents are
 * classified on load rather than left in limbo.
 */

describe("diagram kind", () => {
    test("every template seeds a kind, and only the tree templates auto-arrange", () => {
        for (const meta of TEMPLATE_META) {
            const doc = buildTemplate(meta.id);
            expect(doc.settings.kind).toBe(kindForTemplate(meta.id, meta.category));
            expect(doc.settings.autoLayout !== null).toBe(
                meta.id === "blank" || meta.id === "mindmap"
            );
        }
    });

    test("the gallery's categories fold to the editor's kinds", () => {
        expect(kindForTemplate("mindmap", "Mindmap")).toBe("mindmap");
        expect(kindForTemplate("flowchart", "Flowchart")).toBe("flowchart");
        expect(kindForTemplate("erd", "Technical")).toBe("flowchart");
        expect(kindForTemplate("kanban", "Planning")).toBe("board");
        // Columns of stickies are a board even though the gallery files it under Mindmap.
        expect(kindForTemplate("brainstorm", "Mindmap")).toBe("board");
    });

    test("a stored kind round-trips through parseDoc", () => {
        const doc = buildTemplate("flowchart");
        const parsed = parseDoc(JSON.parse(JSON.stringify(doc)));
        expect(parsed.settings.kind).toBe("flowchart");
        expect(parsed.settings.autoLayout).toBeNull();
        expect(parsed.schemaVersion).toBe(DOC_SCHEMA_VERSION);
    });

    test("an auto-layout setting round-trips, and junk is dropped", () => {
        const doc = buildTemplate("mindmap");
        const parsed = parseDoc(JSON.parse(JSON.stringify(doc)));
        expect(parsed.settings.autoLayout).toEqual({ kind: "mindmap" });

        const junk = parseDoc({
            ...JSON.parse(JSON.stringify(doc)),
            settings: { autoLayout: { kind: "spiral" } },
        });
        expect(junk.settings.autoLayout).toBeNull();
    });

    describe("documents saved before kinds existed", () => {
        function legacy(shapes: string[]) {
            const page = createPage("Page 1", {
                nodes: shapes.map((shape, i) =>
                    createNode({ shape, x: i * 200, y: 0, w: 120, h: 40 })
                ),
            });
            const doc = createDoc("Old map", [page]);
            // Strip what a schema-1 file would not have carried.
            const raw = JSON.parse(JSON.stringify(doc)) as {
                schemaVersion: number;
                settings: Record<string, unknown>;
            };
            raw.schemaVersion = 1;
            delete raw.settings.kind;
            delete raw.settings.autoLayout;
            return parseDoc(raw);
        }

        test("a page of nothing but topics is a mindmap", () => {
            expect(legacy(["mind-root", "mind-branch", "mind-leaf"]).settings.kind).toBe("mindmap");
        });

        test("topics with a sticky note beside them are still a mindmap", () => {
            expect(legacy(["mind-root", "mind-branch", "sticky"]).settings.kind).toBe("mindmap");
        });

        test("anything drawn with other shapes keeps the full editor", () => {
            expect(legacy(["mind-root", "rectangle"]).settings.kind).toBe("freeform");
            expect(legacy(["rectangle", "diamond"]).settings.kind).toBe("freeform");
        });

        test("an empty page says nothing, so it keeps the full editor", () => {
            expect(legacy([]).settings.kind).toBe("freeform");
        });

        test("classification never switches auto-arrange on by itself", () => {
            expect(legacy(["mind-root", "mind-branch"]).settings.autoLayout).toBeNull();
        });
    });
});
