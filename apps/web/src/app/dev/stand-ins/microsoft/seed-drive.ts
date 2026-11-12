/**
 * The files the Microsoft stand-in starts with: Morgan's OneDrive (client
 * folders two levels deep, a workpapers folder long enough to page, a OneNote
 * notebook and an empty file), Priya's OneDrive, and the document libraries of
 * two SharePoint sites.
 */

import { MORGAN, ONEDRIVE_HOST, PRIYA, SHAREPOINT_HOST } from "./directory";

export type FileSource =
    | { kind: "text"; text: string }
    | { kind: "docx"; markdown: string }
    | { kind: "xlsx"; rows: (string | number)[][] }
    | { kind: "pdf"; lines: string[] };

export interface SeedSite {
    id: string;
    name: string;
    displayName: string;
    webUrl: string;
}

export interface SeedDrive {
    id: string;
    name: string;
    driveType: "business" | "documentLibrary";
    webUrl: string;
    /** Set on a OneDrive: only this account can open it. */
    ownerOid?: string;
    /** Set on a document library. */
    siteId?: string;
    rootId: string;
}

export interface SeedItem {
    id: string;
    driveId: string;
    parent: string;
    name: string;
    kind: "folder" | "file" | "notebook";
    source?: FileSource;
    /** A "Copy link" URL that also resolves through /shares. */
    sharingUrl?: string;
    minutesAgo: number;
}

export const CLIENTS_SITE_ID = `${SHAREPOINT_HOST},2f6d1c0a-8e3b-4c57-9a41-0d5e7b9c3f11,6b0e4a92-1d7c-4f38-b5a6-3c8d2e1f7a40`;
export const KNOWLEDGE_SITE_ID = `${SHAREPOINT_HOST},9c4a7e15-2b6d-4e80-a3f9-5d1c8b0e6a27,1e7f3b58-4a9c-4d06-8c2b-7f5a0d9e4c63`;

export const CLIENTS_DRIVE_ID = "b!clients-documents";
export const KNOWLEDGE_DRIVE_ID = "b!knowledge-documents";

/** The sharing link on the Brightwater request list — resolves through /shares. */
export const SAMPLE_SHARING_URL = `https://${SHAREPOINT_HOST}/:x:/s/Clients/EbrightwaterPbcList?e=k3Tq9a`;

export const SEED_SITES: SeedSite[] = [
    {
        id: CLIENTS_SITE_ID,
        name: "Clients",
        displayName: "Clients",
        webUrl: `https://${SHAREPOINT_HOST}/sites/Clients`,
    },
    {
        id: KNOWLEDGE_SITE_ID,
        name: "FirmKnowledge",
        displayName: "Firm Knowledge",
        webUrl: `https://${SHAREPOINT_HOST}/sites/FirmKnowledge`,
    },
];

function oneDriveUrl(email: string): string {
    return `https://${ONEDRIVE_HOST}/personal/${email.replace(/[^a-z0-9]/gi, "_")}/Documents`;
}

export const SEED_DRIVES: SeedDrive[] = [
    {
        id: MORGAN.driveId,
        name: "OneDrive",
        driveType: "business",
        webUrl: oneDriveUrl(MORGAN.email),
        ownerOid: MORGAN.oid,
        rootId: "od-morgan-root",
    },
    {
        id: PRIYA.driveId,
        name: "OneDrive",
        driveType: "business",
        webUrl: oneDriveUrl(PRIYA.email),
        ownerOid: PRIYA.oid,
        rootId: "od-priya-root",
    },
    {
        id: CLIENTS_DRIVE_ID,
        name: "Documents",
        driveType: "documentLibrary",
        webUrl: `https://${SHAREPOINT_HOST}/sites/Clients/Shared%20Documents`,
        siteId: CLIENTS_SITE_ID,
        rootId: "sp-clients-root",
    },
    {
        id: KNOWLEDGE_DRIVE_ID,
        name: "Documents",
        driveType: "documentLibrary",
        webUrl: `https://${SHAREPOINT_HOST}/sites/FirmKnowledge/Shared%20Documents`,
        siteId: KNOWLEDGE_SITE_ID,
        rootId: "sp-knowledge-root",
    },
];

const WORKPAPERS: [id: string, name: string, text: string][] = [
    [
        "wp-01",
        "WP-01 Cash and bank.md",
        "# WP-01 Cash and bank\n\nThree operating accounts at First Harbor Bank. Balances agreed to confirmations received 14 October.\n\n- Reconciling items: two uncleared supplier payments, $4,180 in total\n- No unusual transfers in the last week of the year\n",
    ],
    [
        "wp-02",
        "WP-02 Receivables.md",
        "# WP-02 Receivables\n\nWholesale receivables of $412,600. Eleven balances circularised, nine replies agreed.\n\nThe two open replies are cafe chains paying on 60-day terms.\n",
    ],
    [
        "wp-03",
        "WP-03 Inventory.md",
        "# WP-03 Inventory\n\nFlour, packaging and finished goods counted at the Mill Road site on 30 September.\n\nCount differences were below $900 and were corrected in the ledger.\n",
    ],
    [
        "wp-04",
        "WP-04 Fixed assets.txt",
        "WP-04 Fixed assets\n\nAdditions of $186,000: two deck ovens and a delivery van.\nDepreciation recalculated without exception.\n",
    ],
    [
        "wp-05",
        "WP-05 Payables.txt",
        "WP-05 Payables\n\nSupplier statements reconciled for the eight largest balances.\nUnrecorded liabilities search found one utilities invoice of $2,340.\n",
    ],
    [
        "wp-06",
        "WP-06 Payroll.txt",
        "WP-06 Payroll\n\nHeadcount moved from 64 to 71. Monthly payroll agreed to the provider's reports.\nHoliday pay accrual recomputed: $38,900.\n",
    ],
    [
        "wp-07",
        "WP-07 Revenue.md",
        "# WP-07 Revenue\n\nRevenue of $6.4M, up 9% on the prior year. Cut-off tested for the five days either side of year end.\n\nNo exceptions.\n",
    ],
];

function file(
    id: string,
    driveId: string,
    parent: string,
    name: string,
    source: FileSource,
    minutesAgo: number,
    sharingUrl?: string
): SeedItem {
    return { id, driveId, parent, name, kind: "file", source, minutesAgo, sharingUrl };
}

function folder(
    id: string,
    driveId: string,
    parent: string,
    name: string,
    minutesAgo: number
): SeedItem {
    return { id, driveId, parent, name, kind: "folder", minutesAgo };
}

export function seedItems(): SeedItem[] {
    const od = MORGAN.driveId;
    return [
        // ── Morgan's OneDrive ──────────────────────────────────────────────
        folder("od-client-files", od, "od-morgan-root", "Client files", 9000),
        folder("od-northgate", od, "od-client-files", "Northgate Bakery Group", 8800),
        file(
            "od-engagement-letter",
            od,
            "od-northgate",
            "Engagement letter FY2026.docx",
            {
                kind: "docx",
                markdown:
                    "# Engagement letter\n\nNorthgate Bakery Group — audit of the financial statements for the year ending 30 September 2026.\n\n## Scope\n\nWe will audit the balance sheet, income statement and cash flow statement, and report to the directors.\n\n## Fees\n\nOur fee is $48,500 plus expenses, billed in three instalments.\n\n- 40% on signing\n- 40% at the end of fieldwork\n- 20% on delivery of the audit report\n\n## Timetable\n\nFieldwork runs from 12 October to 23 October. We expect to sign by 20 November.\n",
            },
            4300,
            `https://${ONEDRIVE_HOST}/:w:/p/morgan_ellis/EnorthgateEngagementFy26`
        ),
        file(
            "od-planning-memo",
            od,
            "od-northgate",
            "Audit planning memo.docx",
            {
                kind: "docx",
                markdown:
                    "# Audit planning memo\n\n## Materiality\n\nOverall materiality is set at $64,000, 1% of revenue.\n\n## Significant risks\n\n- Revenue cut-off around year end\n- Valuation of finished goods inventory\n- Management override of controls\n\n## Team\n\nMorgan Ellis is the engagement partner. Priya Nair leads fieldwork.\n",
            },
            4100
        ),
        file(
            "od-trial-balance",
            od,
            "od-northgate",
            "Trial balance FY2026.xlsx",
            {
                kind: "xlsx",
                rows: [
                    ["Account", "Description", "Debit", "Credit"],
                    ["1000", "Cash at bank", 318400, 0],
                    ["1100", "Trade receivables", 412600, 0],
                    ["1200", "Inventory", 264900, 0],
                    ["1500", "Plant and equipment", 1184000, 0],
                    ["2000", "Trade payables", 0, 296300],
                    ["2100", "Bank loan", 0, 540000],
                    ["3000", "Share capital", 0, 250000],
                    ["3100", "Retained earnings", 0, 1093600],
                ],
            },
            3900
        ),
        file(
            "od-signed-letter",
            od,
            "od-northgate",
            "Signed engagement letter.pdf",
            {
                kind: "pdf",
                lines: [
                    "Harlow Reed LLP",
                    "Engagement letter - Northgate Bakery Group",
                    "",
                    "Audit of the financial statements for the year ending 30 September 2026.",
                    "Fee: $48,500 plus expenses, billed in three instalments.",
                    "",
                    "Signed for Northgate Bakery Group: Dana Whitfield, Chief Financial Officer",
                    "Signed for Harlow Reed LLP: Morgan Ellis, Partner",
                ],
            },
            3000
        ),
        folder("od-workpapers", od, "od-northgate", "Workpapers", 2900),
        ...WORKPAPERS.map(([id, name, text], i) =>
            file(`od-${id}`, od, "od-workpapers", name, { kind: "text", text }, 2800 - i * 60)
        ),
        folder("od-lumen", od, "od-client-files", "Lumen Dental Studio", 2000),
        file(
            "od-onboarding",
            od,
            "od-lumen",
            "Onboarding checklist.md",
            {
                kind: "text",
                text: "# Onboarding checklist — Lumen Dental Studio\n\n- [x] Signed engagement letter\n- [x] Read-only access to the bank feed\n- [ ] Prior-year tax returns\n- [ ] Payroll provider export for the last 12 months\n\nMonthly bookkeeping starts with the November close.\n",
            },
            1900
        ),
        file(
            "od-fee-schedule",
            od,
            "od-lumen",
            "Fee schedule.xlsx",
            {
                kind: "xlsx",
                rows: [
                    ["Service", "Frequency", "Fee"],
                    ["Monthly bookkeeping", "Monthly", 1250],
                    ["Payroll processing", "Monthly", 320],
                    ["Year-end accounts", "Annual", 4800],
                    ["Corporate tax return", "Annual", 2600],
                ],
            },
            1800
        ),
        file(
            "od-call-notes",
            od,
            "od-lumen",
            "Call notes 2026-10-28.txt",
            {
                kind: "text",
                text: "Call with Tomas Okafor, 28 October\n\nTomas wants monthly management accounts by the tenth working day.\nSecond practice opens in March; he will need a cash flow forecast before signing the lease.\nNext call: 12 November, 10:00.\n",
            },
            1700
        ),
        file(
            "od-fee-quote",
            od,
            "od-morgan-root",
            "Fee quote template.docx",
            {
                kind: "docx",
                markdown:
                    "# Fee quote\n\nThank you for asking Harlow Reed LLP to quote.\n\n## What is included\n\n- Year-end accounts\n- Corporate tax return\n- One planning meeting before year end\n\nQuotes are valid for 60 days.\n",
            },
            6000
        ),
        {
            id: "od-notebook",
            driveId: od,
            parent: "od-morgan-root",
            name: "Partner meeting notes",
            kind: "notebook",
            minutesAgo: 5000,
        },
        file("od-scratch", od, "od-morgan-root", "Scratch.txt", { kind: "text", text: "" }, 400),

        // ── Priya's OneDrive ───────────────────────────────────────────────
        file(
            "od-priya-review",
            PRIYA.driveId,
            "od-priya-root",
            "Review notes.md",
            {
                kind: "text",
                text: "# Review notes\n\n- Northgate: chase the two open receivable confirmations\n- Brightwater: inventory count is on 30 November, book travel\n",
            },
            600
        ),

        // ── SharePoint: Clients ────────────────────────────────────────────
        folder(
            "sp-brightwater",
            CLIENTS_DRIVE_ID,
            "sp-clients-root",
            "Brightwater Logistics",
            7000
        ),
        file(
            "sp-pbc-list",
            CLIENTS_DRIVE_ID,
            "sp-brightwater",
            "PBC request list.xlsx",
            {
                kind: "xlsx",
                rows: [
                    ["Ref", "Document", "Owner", "Due", "Status"],
                    ["1", "Year-end bank statements", "Elena Marsh", "2026-11-20", "Received"],
                    ["2", "Aged receivables listing", "Elena Marsh", "2026-11-20", "Received"],
                    ["3", "Fleet lease agreements", "Elena Marsh", "2026-11-27", "Outstanding"],
                    ["4", "Inventory count sheets", "Warehouse lead", "2026-12-02", "Outstanding"],
                ],
            },
            2500,
            SAMPLE_SHARING_URL
        ),
        file(
            "sp-count-instructions",
            CLIENTS_DRIVE_ID,
            "sp-brightwater",
            "Inventory count instructions.docx",
            {
                kind: "docx",
                markdown:
                    "# Inventory count instructions\n\nThe count at the Harbour Road warehouse is on 30 November, starting at 07:00.\n\n## Before the count\n\n- Stop goods movements at 18:00 the evening before\n- Print count sheets in bay order\n\n## During the count\n\nCount in pairs. Harlow Reed staff will re-perform a sample of 40 lines.\n",
            },
            2400
        ),
        folder("sp-correspondence", CLIENTS_DRIVE_ID, "sp-brightwater", "Correspondence", 2300),
        file(
            "sp-bank-confirmation",
            CLIENTS_DRIVE_ID,
            "sp-correspondence",
            "Bank confirmation - First Harbor.pdf",
            {
                kind: "pdf",
                lines: [
                    "First Harbor Bank",
                    "Confirmation of balances as at 31 October 2026",
                    "",
                    "Customer: Brightwater Logistics",
                    "Operating account: $742,118.40",
                    "Fleet loan outstanding: $1,960,000.00",
                    "No other facilities or guarantees.",
                ],
            },
            2200
        ),
        folder("sp-northgate", CLIENTS_DRIVE_ID, "sp-clients-root", "Northgate Bakery Group", 6500),
        file(
            "sp-rep-letter",
            CLIENTS_DRIVE_ID,
            "sp-northgate",
            "Management representation letter.docx",
            {
                kind: "docx",
                markdown:
                    "# Management representation letter\n\nTo Harlow Reed LLP.\n\nWe confirm that the financial statements for the year ending 30 September 2026 give a true and fair view.\n\n- All transactions have been recorded\n- We have disclosed all known claims and litigation\n- There have been no events after the year end that require adjustment\n",
            },
            2100
        ),

        // ── SharePoint: Firm Knowledge ─────────────────────────────────────
        folder("sp-policies", KNOWLEDGE_DRIVE_ID, "sp-knowledge-root", "Policies", 20000),
        file(
            "sp-acceptance-policy",
            KNOWLEDGE_DRIVE_ID,
            "sp-policies",
            "Client acceptance policy.docx",
            {
                kind: "docx",
                markdown:
                    "# Client acceptance policy\n\nNo engagement starts before these checks are complete.\n\n## Checks\n\n- Identity verification of every director and owner above 25%\n- Independence confirmation from each team member\n- Conflict search across the client list\n\nA partner signs off the acceptance form.\n",
            },
            19000
        ),
        file(
            "sp-independence",
            KNOWLEDGE_DRIVE_ID,
            "sp-policies",
            "Independence checklist.md",
            {
                kind: "text",
                text: "# Independence checklist\n\n1. Do you or a close family member hold shares in the client?\n2. Have you worked for the client in the last two years?\n3. Has the client offered gifts above $100?\n\nAny yes goes to the ethics partner before work starts.\n",
            },
            18000
        ),
        folder("sp-templates", KNOWLEDGE_DRIVE_ID, "sp-knowledge-root", "Templates", 17000),
        file(
            "sp-letter-template",
            KNOWLEDGE_DRIVE_ID,
            "sp-templates",
            "Engagement letter template.docx",
            {
                kind: "docx",
                markdown:
                    "# Engagement letter template\n\nReplace the bracketed text before sending.\n\n## Scope\n\n[Describe the services]\n\n## Fees\n\n[Fee and billing schedule]\n\n## Timetable\n\n[Key dates]\n",
            },
            16000
        ),
        folder("sp-tax", KNOWLEDGE_DRIVE_ID, "sp-templates", "Tax", 15000),
        file(
            "sp-tax-guide",
            KNOWLEDGE_DRIVE_ID,
            "sp-tax",
            "Year-end tax planning guide.pdf",
            {
                kind: "pdf",
                lines: [
                    "Harlow Reed LLP - Year-end tax planning guide",
                    "",
                    "1. Review capital purchases before year end.",
                    "2. Confirm director loan balances are cleared or documented.",
                    "3. Check pension contributions against the annual allowance.",
                    "4. Estimate the corporate tax payment and its due date.",
                ],
            },
            14000
        ),
    ];
}
