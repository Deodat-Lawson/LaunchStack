import type { ExtractionTableView } from "~/lib/extraction/types";
import type { ExportLabels } from "~/server/extraction/export";

export const LABELS: ExportLabels = {
    results: "Results",
    evidence: "Evidence",
    document: "Document",
    field: "Field",
    value: "Value",
    quote: "Quote",
    page: "Page",
    readFrom: "Read from",
    yes: "Yes",
    no: "No",
    text: "text",
    image: "image",
    fileName: "Extraction",
};

const found = (
    value: string | number | boolean | string[],
    quote: string,
    page: number | null = 1,
    via: "text" | "vision" = "text"
) => ({ status: "found" as const, value, quote, page, via });
const missing = {
    status: "not_found" as const,
    value: null,
    quote: null,
    page: null,
    via: "text" as const,
};

/** Five fields of every type; four rows: two read, one withheld, one failed. */
export function sampleView(overrides: Partial<ExtractionTableView> = {}): ExtractionTableView {
    return {
        id: 7,
        title: "Supplier contracts",
        status: "done",
        fieldCount: 5,
        counts: { total: 4, pending: 0, running: 0, done: 3, failed: 1 },
        createdAt: "2026-11-12T08:00:00.000Z",
        finishedAt: "2026-11-12T08:02:00.000Z",
        mine: true,
        shared: true,
        createdByName: "Ana",
        fields: [
            { id: "f1", name: "Supplier", type: "text" },
            { id: "f2", name: "Annual fee", type: "number", instruction: "In dollars" },
            { id: "f3", name: "Renewal date", type: "date" },
            { id: "f4", name: "Auto-renews", type: "boolean" },
            { id: "f5", name: "Services", type: "list" },
        ],
        rows: [
            {
                id: 1,
                documentId: 12,
                sourceId: "d12",
                title: "Acme MSA.pdf",
                status: "done",
                readable: true,
                error: null,
                cells: {
                    f1: found("Acme, Inc.", 'This agreement is with "Acme, Inc."', 1),
                    f2: found(12500.5, "an annual fee of $12,500.50", 3),
                    f3: found("2027-01-31", "renews on January 31, 2027", 4),
                    f4: found(true, "shall renew automatically", 4),
                    f5: found(["Hosting", "Support"], "Hosting and Support services", 2),
                },
            },
            {
                id: 2,
                documentId: 13,
                sourceId: "d13",
                title: '=HYPERLINK("http://evil")',
                status: "done",
                readable: true,
                error: null,
                cells: {
                    f1: found("+1 (555) 010-0000", "@call us", null, "vision"),
                    f2: missing,
                    f4: found(false, "does not renew", 2),
                },
            },
            {
                id: 3,
                documentId: 14,
                sourceId: "d14",
                title: "A file you don't have access to",
                status: "done",
                readable: false,
                error: null,
                cells: {},
            },
            {
                id: 4,
                documentId: 15,
                sourceId: "d15",
                title: "Scan.png",
                status: "failed",
                readable: true,
                error: "This file could not be read.",
                cells: {},
            },
        ],
        usage: { calls: 3, inputTokens: 900, outputTokens: 120 },
        error: null,
        canManage: true,
        ...overrides,
    };
}
