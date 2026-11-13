/**
 * An in-browser stand-in for `/api/extraction/**`, for the preview harness
 * (`/dev/extract`). It keeps a small fictional workspace — invoices, photos
 * of receipts, supplier contracts — and answers every route the Extract tab
 * calls with the wire shapes of `~/lib/extraction/types`. A run is a clock:
 * a table reads one document every `paceMs`, so the grid fills while you
 * watch. Every company and person here is invented.
 */
import {
    EXTRACTION_FIELD_TYPES,
    EXTRACTION_LIMITS,
    type CreateExtractionBody,
    type ExtractionCell,
    type ExtractionCells,
    type ExtractionCounts,
    type ExtractionField,
    type ExtractionFieldType,
    type ExtractionRowStatus,
    type ExtractionRowView,
    type ExtractionSourceOption,
    type ExtractionTableStatus,
    type ExtractionTableSummary,
    type ExtractionTableView,
    type ExtractionValue,
} from "~/lib/extraction/types";

type FactKey =
    | "vendor"
    | "invoiceNumber"
    | "invoiceDate"
    | "totalAmount"
    | "currency"
    | "paid"
    | "lineItems"
    | "parties"
    | "effectiveDate"
    | "term"
    | "governingLaw"
    | "terminationNotice"
    | "contractValue"
    | "autoRenews";

interface Fact {
    value: ExtractionValue;
    quote: string;
    page: number;
}

interface SimDoc {
    id: number;
    title: string;
    folder: string | null;
    kind: string;
    indexed: boolean;
    facts: Partial<Record<FactKey, Fact>>;
    /** Facts read from the picture itself: the file has no text for them. */
    vision?: FactKey[];
    /** Fails the first time it is read; a retry gets through. */
    failsOnce?: string;
}

const US = "Calder & Rowe Advisory Ltd";
const longDate = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" }).format(
        new Date(`${iso}T00:00:00Z`)
    );
const money = (n: number) =>
    new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
        n
    );

function invoice(
    id: number,
    title: string,
    folder: string,
    kind: string,
    d: {
        vendor?: string;
        number?: string;
        date?: string;
        total?: number;
        currency?: string;
        paid?: boolean;
        items?: string[];
    },
    extra: Pick<SimDoc, "vision" | "failsOnce"> = {}
): SimDoc {
    const facts: SimDoc["facts"] = {};
    if (d.vendor) facts.vendor = { value: d.vendor, quote: `Remit to: ${d.vendor}`, page: 1 };
    if (d.number)
        facts.invoiceNumber = { value: d.number, quote: `Invoice No. ${d.number}`, page: 1 };
    if (d.date)
        facts.invoiceDate = { value: d.date, quote: `Date of issue: ${longDate(d.date)}`, page: 1 };
    if (d.total !== undefined) {
        const quote = `Total due ${d.currency ?? ""} ${money(d.total)}`.replace(/\s+/g, " ");
        facts.totalAmount = { value: d.total, quote, page: 1 };
        if (d.currency) facts.currency = { value: d.currency, quote, page: 1 };
    }
    if (d.paid !== undefined)
        facts.paid = {
            value: d.paid,
            quote: d.paid
                ? "Paid in full — thank you. No further amount is due."
                : "Payment is due within 30 days of the date of issue.",
            page: 1,
        };
    if (d.items)
        facts.lineItems = {
            value: d.items,
            quote: d.items.slice(0, 3).join("; "),
            page: d.items.length > 8 ? 2 : 1,
        };
    return { id, title, folder, kind, indexed: true, facts, ...extra };
}

function contract(
    id: number,
    title: string,
    kind: string,
    d: {
        other: string;
        effective?: string;
        term?: string;
        law?: string;
        notice?: string;
        value?: [number, string];
        autoRenews?: boolean;
    },
    folder: string | null = "Legal/Supplier contracts"
): SimDoc {
    const facts: SimDoc["facts"] = {
        parties: {
            value: [US, d.other],
            quote: `This Agreement is made between ${US} and ${d.other}.`,
            page: 1,
        },
    };
    if (d.effective)
        facts.effectiveDate = {
            value: d.effective,
            quote: `This Agreement takes effect on ${longDate(d.effective)} (the "Effective Date").`,
            page: 1,
        };
    if (d.term)
        facts.term = {
            value: d.term,
            quote: `This Agreement shall continue for a term of ${d.term.toLowerCase()} from the Effective Date.`,
            page: 3,
        };
    if (d.law)
        facts.governingLaw = {
            value: d.law,
            quote: `This Agreement and any dispute arising out of it are governed by the laws of ${d.law}.`,
            page: 14,
        };
    if (d.notice)
        facts.terminationNotice = {
            value: d.notice,
            quote: `Either party may terminate this Agreement by giving ${d.notice}.`,
            page: 11,
        };
    if (d.value)
        facts.contractValue = {
            value: d.value[0],
            quote: `Total fees payable under this Agreement shall not exceed ${d.value[1]} ${money(d.value[0])}.`,
            page: 6,
        };
    if (d.autoRenews !== undefined)
        facts.autoRenews = {
            value: d.autoRenews,
            quote: d.autoRenews
                ? "This Agreement shall renew automatically for successive periods of twelve months."
                : "This Agreement shall not renew automatically on expiry.",
            page: 3,
        };
    return { id, title, folder, kind, indexed: true, facts };
}

const INVOICES = "Finance/Invoices 2026";
const RECEIPTS = "Finance/Receipts";

const DOCS: SimDoc[] = [
    invoice(101, "Halvorsen Freight — INV-4471.pdf", INVOICES, "pdf", {
        vendor: "Halvorsen Freight AS",
        number: "INV-4471",
        date: "2026-07-03",
        total: 18450,
        currency: "NOK",
        paid: true,
        items: ["Road freight Oslo–Gothenburg", "Customs handling", "Fuel surcharge"],
    }),
    invoice(102, "Brightwater Analytics — 2026-0098.pdf", INVOICES, "pdf", {
        vendor: "Brightwater Analytics Ltd",
        number: "2026-0098",
        date: "2026-07-11",
        total: 1284500,
        currency: "GBP",
        paid: false,
        items: ["Platform licence, year 1", "Implementation services"],
    }),
    invoice(103, "Okonjo & Lindqvist — fee note 318.pdf", INVOICES, "pdf", {
        vendor: "Okonjo & Lindqvist LLP",
        number: "FN-318",
        date: "2026-07-15",
        total: 42750.5,
        currency: "EUR",
        paid: true,
        items: ["Advice on supply terms", "Disbursements"],
    }),
    invoice(104, "Meridian Cold Storage — July.pdf", INVOICES, "pdf", {
        vendor: "Meridian Cold Storage Inc.",
        date: "2026-07-31",
        total: 96320.75,
        currency: "USD",
        paid: false,
        items: [
            "Pallet storage, chilled",
            "Pallet storage, frozen",
            "Inbound handling",
            "Outbound handling",
            "Cross-docking",
            "Blast freezing",
            "Stretch wrapping",
            "Labelling",
            "Order picking",
            "Temperature logging",
            "Weekend access",
            "Pallet exchange",
            "Waste disposal",
            "Energy surcharge",
        ],
    }),
    invoice(105, "Tesselate Print — 77120.pdf", INVOICES, "pdf", {
        vendor: "Tesselate Print GmbH",
        number: "77120",
        date: "2026-08-02",
        total: 3980,
        currency: "EUR",
        paid: true,
        items: ["Annual report, 400 copies", "Proofing"],
    }),
    invoice(106, "Quillfeather Staffing — INV-20817.pdf", INVOICES, "pdf", {
        vendor: "Quillfeather Staffing Co.",
        number: "INV-20817",
        date: "2026-08-09",
        total: 212400,
        currency: "USD",
        items: ["Contract analysts, July", "Onboarding fee"],
    }),
    invoice(107, "Northgate Utilities — statement Aug.pdf", INVOICES, "pdf", {
        vendor: "Northgate Utilities Co-op",
        number: "NU-88-140233",
        date: "2026-08-14",
        total: 7412.18,
        currency: "CAD",
        paid: true,
    }),
    invoice(
        108,
        "INV-2291 Brightwater (scan).pdf",
        INVOICES,
        "pdf",
        {
            vendor: "Brightwater Analytics Ltd",
            number: "INV-2291",
            date: "2026-08-18",
            total: 64225,
            currency: "GBP",
            paid: false,
            items: ["Additional seats ×25"],
        },
        { failsOnce: "The model did not answer in time for this document. Retry to read it again." }
    ),
    invoice(109, "Sable & Finch Catering — 5521.pdf", INVOICES, "pdf", {
        vendor: "Sable & Finch Catering",
        number: "5521",
        date: "2026-08-21",
        total: 15890,
        currency: "EUR",
        paid: false,
        items: ["Client day, 120 covers", "Staffing", "Equipment hire"],
    }),
    invoice(
        110,
        "Taxi receipt 0412.jpg",
        RECEIPTS,
        "image",
        { vendor: "Citybound Cabs", date: "2026-08-04", total: 46.8, currency: "EUR", paid: true },
        { vision: ["totalAmount"] }
    ),
    invoice(
        111,
        "Café Lumen receipt.png",
        RECEIPTS,
        "image",
        {
            vendor: "Café Lumen",
            date: "2026-08-05",
            total: 23.4,
            currency: "EUR",
            paid: true,
            items: ["Flat white ×2", "Almond croissant", "Sparkling water"],
        },
        { vision: ["vendor"] }
    ),
    invoice(112, "Hotel Aldermoor folio.jpg", RECEIPTS, "image", {
        vendor: "Hotel Aldermoor",
        number: "F-209184",
        date: "2026-08-07",
        total: 1124,
        currency: "GBP",
        paid: true,
        items: ["3 nights, standard double", "City tax", "Breakfast ×3"],
    }),
    invoice(113, "Parking — Harbour Quay.png", RECEIPTS, "image", {
        vendor: "Harbour Quay Parking",
        date: "2026-08-07",
        total: 38,
        currency: "GBP",
        paid: true,
    }),
    invoice(114, "Stationery order photo.jpg", RECEIPTS, "image", {
        vendor: "Paperwell Supplies",
        number: "PW-66012",
        total: 289.9,
        currency: "EUR",
        items: ["A4 paper, 20 reams", "Toner, black ×4", "Notebooks ×30"],
    }),
    invoice(115, "Courier slip 88213.png", RECEIPTS, "image", {
        vendor: "Swiftline Couriers",
        number: "88213",
        date: "2026-08-12",
        total: 64.5,
        currency: "USD",
    }),
    contract(120, "Master Services Agreement — Brightwater Analytics.pdf", "pdf", {
        other: "Brightwater Analytics Ltd",
        effective: "2025-11-01",
        term: "36 months",
        law: "England and Wales",
        notice: "90 days' written notice",
        value: [3853500, "GBP"],
        autoRenews: true,
    }),
    contract(121, "Warehousing Agreement — Meridian Cold Storage.pdf", "pdf", {
        other: "Meridian Cold Storage Inc.",
        effective: "2026-01-15",
        term: "24 months",
        law: "the State of New York",
        notice: "60 days' written notice",
        value: [2311698, "USD"],
        autoRenews: true,
    }),
    contract(122, "Freight Framework — Halvorsen Freight.pdf", "pdf", {
        other: "Halvorsen Freight AS",
        effective: "2026-03-01",
        term: "12 months",
        law: "Norway",
        notice: "30 days' written notice",
        autoRenews: false,
    }),
    contract(123, "Staffing Terms — Quillfeather.docx", "docx", {
        other: "Quillfeather Staffing Co.",
        effective: "2025-09-20",
        law: "the State of Delaware",
        notice: "14 days' written notice",
        value: [850000, "USD"],
    }),
    contract(124, "Catering Agreement — Sable & Finch.pdf", "pdf", {
        other: "Sable & Finch Catering",
        effective: "2026-05-05",
        term: "18 months",
        law: "Ireland",
        value: [190680, "EUR"],
        autoRenews: false,
    }),
    contract(125, "NDA — Tesselate Print.pdf", "pdf", {
        other: "Tesselate Print GmbH",
        effective: "2026-02-10",
        term: "5 years",
        law: "Germany",
        autoRenews: false,
    }),
    contract(126, "Lease — 14 Harrow Lane, Unit 3.pdf", "pdf", {
        other: "Harrow Lane Estates LLP",
        effective: "2024-04-01",
        term: "10 years",
        law: "England and Wales",
        notice: "6 months' written notice, at the fifth anniversary only",
        value: [1920000, "GBP"],
        autoRenews: false,
    }),
    contract(127, "Software Licence — Kestrel Ledger.pdf", "pdf", {
        other: "Kestrel Ledger Systems, Inc.",
        effective: "2026-06-01",
        term: "12 months",
        law: "the State of California",
        notice: "30 days' written notice before renewal",
        value: [48000, "USD"],
        autoRenews: true,
    }),
    {
        id: 130,
        title: "Board pack — September.pdf",
        folder: null,
        kind: "pdf",
        indexed: true,
        facts: {},
    },
    { id: 131, title: "Scan 0412.pdf", folder: null, kind: "pdf", indexed: false, facts: {} },
    invoice(132, "Insurance schedule 2026.pdf", "", "pdf", {
        vendor: "Aldgate Mutual Assurance",
        number: "POL-7730914",
        date: "2026-01-01",
        total: 58200,
        currency: "GBP",
        paid: true,
    }),
];
// The insurance schedule sits outside any folder.
DOCS[DOCS.length - 1]!.folder = null;

/** A document only a colleague's shared table knows: this viewer may not open it. */
const WITHHELD = { id: 140, title: "Settlement Agreement — Harrow Lane (confidential).pdf" };

const DOC_BY_ID = new Map(DOCS.map(doc => [doc.id, doc]));

/** Which fact a field asks for, by its name — the starter sets in English and Chinese, and close variants. */
const FACT_BY_NAME: [FactKey, RegExp][] = [
    ["invoiceNumber", /invoice\s*(number|no\b|#)|发票号/i],
    ["invoiceDate", /invoice\s*date|date\s*of\s*issue|issued|开票日期|^date$|^日期$/i],
    ["effectiveDate", /effective|start\s*date|commence|生效/i],
    ["totalAmount", /total|amount\s*due|总金额|金额/i],
    ["contractValue", /contract\s*value|value|fees|合同金额/i],
    ["currency", /currency|币种|货币/i],
    ["paid", /paid|settled|已付|付款/i],
    ["lineItems", /line\s*items|items|明细|项目/i],
    ["vendor", /vendor|supplier|seller|merchant|供应商|商家/i],
    ["parties", /part(y|ies)|counterpart|签约方|当事人/i],
    ["terminationNotice", /terminat|notice|终止|通知/i],
    ["autoRenews", /renew|续约|续期/i],
    ["term", /term|duration|期限/i],
    ["governingLaw", /law|jurisdiction|法律|管辖/i],
];

function factFor(name: string): FactKey | null {
    return FACT_BY_NAME.find(([, pattern]) => pattern.test(name))?.[0] ?? null;
}

interface SimField extends ExtractionField {
    fact: FactKey | null;
}

interface SimRow {
    id: number;
    documentId: number;
    title: string;
    status: ExtractionRowStatus;
    cells: ExtractionCells;
    error: string | null;
    attempts: number;
    readable: boolean;
}

interface SimTable {
    id: number;
    title: string;
    fields: SimField[];
    rows: SimRow[];
    status: ExtractionTableStatus;
    mine: boolean;
    shared: boolean;
    createdByName: string | null;
    createdAt: number;
    finishedAt: number | null;
    error: string | null;
    /** Row ids still to read in this run, in order, and when the run began. */
    queue: number[];
    runStart: number;
    paceMs: number;
    calls: number;
}

const NOT_FOUND: ExtractionCell = {
    status: "not_found",
    value: null,
    quote: null,
    page: null,
    via: "text",
};

/** A value in the shape the field's type wants, when the document's fact can be read that way. */
function coerce(value: ExtractionValue, type: ExtractionFieldType): ExtractionValue {
    if (value === null) return null;
    if (type === "list") return Array.isArray(value) ? value : [String(value)];
    if (Array.isArray(value)) return type === "text" ? value.join(", ") : null;
    if (type === "number") return typeof value === "number" ? value : null;
    if (type === "boolean") return typeof value === "boolean" ? value : null;
    if (type === "date")
        return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
    return typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
}

function readRow(row: SimRow, fields: SimField[]): void {
    const doc = DOC_BY_ID.get(row.documentId);
    row.attempts += 1;
    if (!doc) {
        row.status = "failed";
        row.error = "This document is no longer in the workspace.";
        return;
    }
    if (doc.failsOnce && row.attempts === 1) {
        row.status = "failed";
        row.error = doc.failsOnce;
        return;
    }
    const cells: ExtractionCells = {};
    for (const field of fields) {
        const fact = field.fact ? doc.facts[field.fact] : undefined;
        const value = fact ? coerce(fact.value, field.type) : null;
        cells[field.id] =
            fact && value !== null
                ? {
                      status: "found",
                      value,
                      quote: fact.quote,
                      page: fact.page,
                      via: field.fact && doc.vision?.includes(field.fact) ? "vision" : "text",
                  }
                : NOT_FOUND;
    }
    row.cells = cells;
    row.status = "done";
    row.error = null;
}

/** Moves a table's clock forward: rows whose turn has come are read, the next two are in hand. */
function advance(table: SimTable, now: number): void {
    if (table.status === "queued" && now - table.runStart >= 0) table.status = "running";
    if (table.status !== "running") return;
    const due = Math.floor((now - table.runStart) / table.paceMs);
    const byId = new Map(table.rows.map(row => [row.id, row]));
    table.queue.forEach((rowId, index) => {
        const row = byId.get(rowId);
        if (!row || row.status === "done" || row.status === "failed") return;
        if (index < due) {
            readRow(row, table.fields);
            table.calls += 1;
        } else {
            row.status = index < due + 2 ? "running" : "pending";
        }
    });
    if (due >= table.queue.length) {
        table.status = "done";
        table.finishedAt = table.runStart + table.queue.length * table.paceMs;
        table.queue = [];
    }
}

function counts(table: SimTable): ExtractionCounts {
    const c: ExtractionCounts = {
        total: table.rows.length,
        pending: 0,
        running: 0,
        done: 0,
        failed: 0,
    };
    for (const row of table.rows) c[row.status] += 1;
    return c;
}

function summary(table: SimTable): ExtractionTableSummary {
    return {
        id: table.id,
        title: table.title,
        status: table.status,
        fieldCount: table.fields.length,
        counts: counts(table),
        createdAt: new Date(table.createdAt).toISOString(),
        finishedAt: table.finishedAt ? new Date(table.finishedAt).toISOString() : null,
        mine: table.mine,
        shared: table.shared,
        createdByName: table.createdByName,
    };
}

function view(table: SimTable): ExtractionTableView {
    return {
        ...summary(table),
        fields: table.fields.map(({ fact: _fact, ...field }) => field),
        rows: table.rows.map(
            (row): ExtractionRowView => ({
                id: row.id,
                documentId: row.documentId,
                sourceId: `d${row.documentId}`,
                title: row.title,
                status: row.status,
                cells: row.readable ? row.cells : {},
                error: row.readable ? row.error : null,
                readable: row.readable,
            })
        ),
        usage: {
            calls: table.calls,
            inputTokens: table.calls * 6400,
            outputTokens: table.calls * 310,
        },
        error: table.error,
        canManage: table.mine,
    };
}

let tables: SimTable[] = [];
let nextTableId = 1;
let nextRowId = 1;

function makeTable(input: {
    title: string;
    fields: { name: string; type: ExtractionFieldType; instruction?: string; fact?: FactKey }[];
    documentIds: number[];
    now: number;
    createdAt?: number;
    runStart?: number;
    paceMs?: number;
    mine?: boolean;
    shared?: boolean;
    createdByName?: string | null;
    withheld?: { id: number; title: string }[];
}): SimTable {
    const table: SimTable = {
        id: nextTableId++,
        title: input.title,
        fields: input.fields.map((field, index) => ({
            id: `f${index + 1}`,
            name: field.name,
            type: field.type,
            ...(field.instruction ? { instruction: field.instruction } : {}),
            fact: field.fact ?? factFor(field.name),
        })),
        rows: [
            ...input.documentIds.map(
                (documentId): SimRow => ({
                    id: nextRowId++,
                    documentId,
                    title: DOC_BY_ID.get(documentId)?.title ?? `Document ${documentId}`,
                    status: "pending",
                    cells: {},
                    error: null,
                    attempts: 0,
                    readable: true,
                })
            ),
            ...(input.withheld ?? []).map(
                (doc): SimRow => ({
                    id: nextRowId++,
                    documentId: doc.id,
                    title: doc.title,
                    status: "done",
                    cells: {},
                    error: null,
                    attempts: 1,
                    readable: false,
                })
            ),
        ],
        status: "queued",
        mine: input.mine ?? true,
        shared: input.shared ?? false,
        createdByName: input.createdByName === undefined ? "You" : input.createdByName,
        createdAt: input.createdAt ?? input.now,
        finishedAt: null,
        error: null,
        queue: [],
        runStart: input.runStart ?? input.now + 500,
        paceMs: input.paceMs ?? 700,
        calls: 0,
    };
    table.queue = table.rows.filter(row => row.readable).map(row => row.id);
    return table;
}

const HOUR = 3_600_000;

function seed(now: number): void {
    nextTableId = 1;
    nextRowId = 1;
    tables = [
        // 1 — finished two days ago: the grid, straight away.
        makeTable({
            title: "Q3 vendor invoices",
            fields: [
                { name: "Vendor", type: "text" },
                { name: "Invoice number", type: "text" },
                { name: "Invoice date", type: "date" },
                {
                    name: "Total amount",
                    type: "number",
                    instruction: "The final amount due, including tax",
                },
                { name: "Currency", type: "text" },
                {
                    name: "Paid",
                    type: "boolean",
                    instruction: "Whether the document says it has been paid",
                },
                { name: "Line items", type: "list" },
            ],
            documentIds: [
                101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115,
            ],
            now,
            createdAt: now - 50 * HOUR,
            runStart: now - 50 * HOUR,
            paceMs: 4000,
        }),
        // 2 — started a few seconds ago: three documents in, the rest arriving.
        makeTable({
            title: "Supplier contracts — key terms",
            fields: [
                { name: "Parties", type: "list" },
                { name: "Effective date", type: "date" },
                { name: "Term", type: "text" },
                { name: "Governing law", type: "text" },
                {
                    name: "Termination notice",
                    type: "text",
                    instruction: "How much notice either party must give to end the agreement",
                },
                { name: "Contract value", type: "number", fact: "contractValue" },
            ],
            documentIds: [120, 121, 122, 123, 124, 125, 126, 127, 130, 132],
            now,
            createdAt: now - 9000,
            runStart: now - 8000,
            paceMs: 2500,
        }),
        // 3 — a colleague's, shared with the workspace; one row is a file this viewer cannot open.
        makeTable({
            title: "Lease and licence review",
            fields: [
                { name: "Parties", type: "list" },
                { name: "Effective date", type: "date" },
                { name: "Term", type: "text" },
                { name: "Renews automatically", type: "boolean", fact: "autoRenews" },
                { name: "Contract value", type: "number", fact: "contractValue" },
            ],
            documentIds: [126, 127, 125],
            withheld: [WITHHELD],
            now,
            createdAt: now - 6 * 24 * HOUR,
            runStart: now - 6 * 24 * HOUR,
            paceMs: 4000,
            mine: false,
            shared: true,
            createdByName: "Ingrid Vasquez-Moll",
        }),
    ];
    for (const table of tables) advance(table, now);
}

let seeded = false;
let startEmpty = false;

export function configureExtractSim(options: { empty: boolean }): void {
    startEmpty = options.empty;
    seeded = false;
}

function ensure(now: number): void {
    if (seeded) return;
    seeded = true;
    if (startEmpty) {
        tables = [];
        nextTableId = 1;
        nextRowId = 1;
    } else {
        seed(now);
    }
}

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
const fail = (status: number, error: string, code?: string) =>
    json({ error, ...(code ? { code } : {}) }, status);

function parseBody(init?: RequestInit): Record<string, unknown> {
    if (typeof init?.body !== "string" || !init.body) return {};
    try {
        const body: unknown = JSON.parse(init.body);
        return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

function create(body: Partial<CreateExtractionBody>, now: number): Response {
    const fields = Array.isArray(body.fields) ? body.fields : [];
    const documentIds = Array.isArray(body.documentIds) ? body.documentIds : [];
    if (fields.length === 0 || fields.length > EXTRACTION_LIMITS.maxFields)
        return fail(400, `A table needs between 1 and ${EXTRACTION_LIMITS.maxFields} fields.`);
    if (documentIds.length === 0 || documentIds.length > EXTRACTION_LIMITS.maxDocuments)
        return fail(
            400,
            `A table needs between 1 and ${EXTRACTION_LIMITS.maxDocuments} documents.`
        );
    const names = new Set<string>();
    for (const field of fields) {
        const name = typeof field?.name === "string" ? field.name.trim() : "";
        if (!name || !EXTRACTION_FIELD_TYPES.includes(field.type))
            return fail(400, "Every field needs a name and a type.");
        if (names.has(name.toLowerCase())) return fail(400, `Two fields are named "${name}".`);
        names.add(name.toLowerCase());
    }
    const unknown = documentIds.filter(id => !DOC_BY_ID.get(id)?.indexed);
    if (unknown.length > 0)
        return fail(400, "Some of those documents cannot be read yet.", "documents_unavailable");
    const title =
        typeof body.title === "string" && body.title.trim()
            ? body.title.trim()
            : `${fields[0]!.name.trim()} and ${fields.length - 1} more — ${documentIds.length} documents`;
    const table = makeTable({
        title: fields.length === 1 ? title.replace(" and 0 more", "") : title,
        fields: fields.map(field => ({
            name: field.name.trim(),
            type: field.type,
            instruction: field.instruction,
        })),
        documentIds,
        now,
    });
    tables.push(table);
    return json({ table: view(table) }, 201);
}

/** Answers one `/api/extraction/**` request, or null for a path this simulator does not know. */
export async function simulateExtraction(
    url: URL,
    init?: RequestInit,
    now = Date.now()
): Promise<Response | null> {
    ensure(now);
    for (const table of tables) advance(table, now);
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname.replace(/\/+$/, "");

    if (path === "/api/extraction") {
        if (method === "GET") {
            const list = [...tables].sort((a, b) => b.createdAt - a.createdAt).map(summary);
            return json({ tables: list });
        }
        if (method === "POST") return create(parseBody(init) as Partial<CreateExtractionBody>, now);
        return fail(405, "Method not allowed.");
    }
    if (path === "/api/extraction/sources" && method === "GET") {
        const sources: ExtractionSourceOption[] = DOCS.map(doc => ({
            documentId: doc.id,
            sourceId: `d${doc.id}`,
            title: doc.title,
            folder: doc.folder,
            kind: doc.kind,
            indexed: doc.indexed,
        }));
        return json({ sources });
    }

    const match = /^\/api\/extraction\/(\d+)(?:\/(cancel|rerun|export))?$/.exec(path);
    if (!match) return null;
    const table = tables.find(t => t.id === Number(match[1]));
    if (!table) return fail(404, "This table does not exist, or is not shared with you.");
    const action = match[2];

    if (!action) {
        if (method === "GET") return json({ table: view(table) });
        if (!table.mine) return fail(403, "Only the person who made this table can change it.");
        if (method === "PATCH") {
            const body = parseBody(init);
            if (typeof body.title === "string" && body.title.trim())
                table.title = body.title.trim();
            if (typeof body.shared === "boolean") table.shared = body.shared;
            return json({ table: view(table) });
        }
        if (method === "DELETE") {
            tables = tables.filter(t => t !== table);
            return json({ ok: true });
        }
        return fail(405, "Method not allowed.");
    }
    if (action === "export") return null;
    if (method !== "POST") return fail(405, "Method not allowed.");
    if (!table.mine) return fail(403, "Only the person who made this table can change it.");

    if (action === "cancel") {
        if (table.status === "queued" || table.status === "running") {
            table.status = "cancelled";
            table.finishedAt = now;
            table.queue = [];
            for (const row of table.rows) if (row.status === "running") row.status = "pending";
        }
        return json({ table: view(table) });
    }
    // rerun
    const body = parseBody(init);
    const asked = Array.isArray(body.rowIds) ? new Set(body.rowIds as number[]) : null;
    const again = table.rows.filter(
        row => row.readable && row.status === "failed" && (!asked || asked.has(row.id))
    );
    if (again.length === 0) return fail(409, "No failed documents to retry.");
    const running = table.status === "running";
    for (const row of again) {
        row.status = "pending";
        row.cells = {};
        row.error = null;
    }
    if (running) {
        table.queue.push(...again.map(row => row.id));
    } else {
        table.status = "running";
        table.finishedAt = null;
        table.queue = again.map(row => row.id);
        table.runStart = now + 400;
        table.paceMs = 1800;
    }
    advance(table, now);
    return json({ table: view(table) });
}

function csvCell(value: string): string {
    return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvValue(value: ExtractionValue): string {
    if (value === null) return "";
    if (Array.isArray(value)) return value.join("; ");
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return String(value);
}

/** The table as a CSV file: a value column and a quote column per field, a row per document. */
export function exportCsv(
    tableId: number,
    now = Date.now()
): { name: string; content: string } | null {
    ensure(now);
    for (const table of tables) advance(table, now);
    const table = tables.find(t => t.id === tableId);
    if (!table) return null;
    const header = [
        "Document",
        "Status",
        ...table.fields.flatMap(field => [
            field.name,
            `${field.name} — quote`,
            `${field.name} — page`,
        ]),
    ];
    const lines = table.rows.map(row => {
        const status = !row.readable ? "no access" : row.status;
        return [
            row.title,
            status,
            ...table.fields.flatMap(field => {
                const cell = row.readable ? row.cells[field.id] : undefined;
                return cell?.status === "found"
                    ? [
                          csvValue(cell.value),
                          cell.quote ?? "",
                          cell.page === null ? "" : String(cell.page),
                      ]
                    : ["", "", ""];
            }),
        ];
    });
    const content = [header, ...lines].map(line => line.map(csvCell).join(",")).join("\r\n");
    const name = `${table.title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "table"}.csv`;
    // A byte-order mark, so a spreadsheet reads the accents and dashes as UTF-8.
    return { name, content: `﻿${content}\r\n` };
}
