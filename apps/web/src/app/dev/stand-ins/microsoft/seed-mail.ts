/**
 * The mail the Microsoft stand-in starts with, written once as conversations
 * and then filed into each account's mailbox the way Exchange would: what you
 * sent is in Sent Items, what you received is in the Inbox (or Inbox/Clients,
 * or Archive), your draft is in Drafts.
 *
 * Replies carry the earlier message quoted underneath in the three shapes a
 * connector has to strip: "On … wrote:" with `>` lines, Outlook's
 * "From: … Sent: …" block, and "-----Original Message-----".
 */

import {
    ACCOUNTS,
    BILLING,
    DANA,
    ELENA,
    LEARNING,
    MORGAN,
    PRIYA,
    TOMAS,
    person,
    type StandInAccount,
    type StandInPerson,
} from "./directory";
import { docxFromMarkdown, pdfFromLines, tinyPng, type Bytes } from "./office";

export type QuoteStyle = "on-wrote" | "outlook" | "original-message";

export interface QuotedMessage {
    from: StandInPerson;
    to: StandInPerson[];
    sent: Date;
    subject: string;
    text: string;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

function clock(date: Date): string {
    const hours = date.getUTCHours();
    const minutes = String(date.getUTCMinutes()).padStart(2, "0");
    return `${hours % 12 === 0 ? 12 : hours % 12}:${minutes} ${hours < 12 ? "AM" : "PM"}`;
}

/** "Tuesday, November 3, 2026 9:14 AM" — Outlook's Sent: line. */
function longDate(date: Date): string {
    return `${DAYS[date.getUTCDay()]!}, ${MONTHS[date.getUTCMonth()]!} ${date.getUTCDate()}, ${date.getUTCFullYear()} ${clock(date)}`;
}

/** "Tue, Nov 3, 2026 at 9:14 AM" — the "On … wrote:" line. */
function shortDate(date: Date): string {
    return `${DAYS[date.getUTCDay()]!.slice(0, 3)}, ${MONTHS[date.getUTCMonth()]!.slice(0, 3)} ${date.getUTCDate()}, ${date.getUTCFullYear()} at ${clock(date)}`;
}

function escapeHtml(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function paragraphs(text: string): string {
    return text
        .split(/\n{2,}/)
        .filter(block => block.trim() !== "")
        .map(block => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
        .join("");
}

function addressLine(p: StandInPerson): string {
    return `${p.name} <${p.address}>`;
}

/** A message's text and HTML bodies: what was written, then what it replies to. */
export function composeBodies(
    written: string,
    quote?: { style: QuoteStyle; previous: QuotedMessage },
    inlineImageCid?: string
): { text: string; html: string } {
    let text = written;
    let quotedHtml = "";
    if (quote) {
        const prev = quote.previous;
        const header = [
            `From: ${addressLine(prev.from)}`,
            `Sent: ${longDate(prev.sent)}`,
            `To: ${prev.to.map(addressLine).join("; ")}`,
            `Subject: ${prev.subject}`,
        ];
        if (quote.style === "on-wrote") {
            const intro = `On ${shortDate(prev.sent)} ${addressLine(prev.from)} wrote:`;
            text += `\n\n${intro}\n${prev.text
                .split("\n")
                .map(line => (line ? `> ${line}` : ">"))
                .join("\n")}`;
            quotedHtml =
                `<div class="gmail_quote"><div class="gmail_attr">${escapeHtml(intro)}<br></div>` +
                `<blockquote class="gmail_quote">${paragraphs(prev.text)}</blockquote></div>`;
        } else if (quote.style === "outlook") {
            text += `\n\n________________________________\n${header.join("\n")}\n\n${prev.text}`;
            quotedHtml =
                `<hr><div id="divRplyFwdMsg"><p>${header
                    .map(line => {
                        const at = line.indexOf(":");
                        return `<b>${line.slice(0, at + 1)}</b>${escapeHtml(line.slice(at + 1))}`;
                    })
                    .join("<br>")}</p></div>` + paragraphs(prev.text);
        } else {
            text += `\n\n-----Original Message-----\n${header.join("\n")}\n\n${prev.text}`;
            quotedHtml =
                `<p>-----Original Message-----<br>${header.map(escapeHtml).join("<br>")}</p>` +
                paragraphs(prev.text);
        }
    }
    const image = inlineImageCid
        ? `<p><img src="cid:${inlineImageCid}" alt="" width="1" height="1"></p>`
        : "";
    const html =
        '<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head>' +
        `<body>${paragraphs(written)}${image}${quotedHtml}</body></html>`;
    return { text, html };
}

// ── What the mailboxes hold ────────────────────────────────────────────────

export interface SeedAttachment {
    name: string;
    contentType: string;
    isInline: boolean;
    contentId?: string;
    content: Bytes;
}

export interface SeedMailFolder {
    id: string;
    oid: string;
    displayName: string;
    parentFolderId: string;
    wellKnownName?: string;
}

export interface SeedMessage {
    id: string;
    oid: string;
    folderId: string;
    conversationId: string;
    subject: string;
    from: StandInPerson;
    to: StandInPerson[];
    cc: StandInPerson[];
    sentDateTime: string;
    receivedDateTime: string;
    isDraft: boolean;
    isRead: boolean;
    html: string;
    /** Absent on the one message that only ever had an HTML part. */
    text?: string;
    internetMessageId: string;
    attachments: (SeedAttachment & { id: string })[];
}

interface Draft {
    from: StandInPerson;
    to: StandInPerson[];
    cc?: StandInPerson[];
    minutesAgo: number;
    text: string;
    /** How this message quotes the one before it. */
    quote?: QuoteStyle;
    attachments?: SeedAttachment[];
    draft?: boolean;
    /** Sent as HTML only, the way bulk mail often is. */
    htmlOnly?: boolean;
}

interface Conversation {
    key: string;
    subject: string;
    file?: "clients" | "archive";
    messages: Draft[];
}

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const morgan = person(MORGAN);
const priya = person(PRIYA);

function conversations(): Conversation[] {
    return [
        {
            key: "engagement",
            subject: "Engagement letter for the FY2026 audit",
            file: "clients",
            messages: [
                {
                    from: morgan,
                    to: [DANA],
                    cc: [priya],
                    minutesAgo: 4320,
                    text: "Hi Dana,\n\nAttached is our engagement letter for the audit of Northgate Bakery Group for the year ending 30 September 2026. The fee is $48,500 plus expenses, billed in three instalments.\n\nIf the terms look right, please sign and return it and we will lock in fieldwork for 12 to 23 October.\n\nBest,\nMorgan",
                    attachments: [
                        {
                            name: "Engagement letter FY2026.docx",
                            contentType: DOCX,
                            isInline: false,
                            content: docxFromMarkdown(
                                "# Engagement letter\n\nNorthgate Bakery Group — audit for the year ending 30 September 2026.\n\n## Fees\n\nOur fee is $48,500 plus expenses, billed in three instalments.\n"
                            ),
                        },
                    ],
                },
                {
                    from: DANA,
                    to: [morgan],
                    cc: [priya],
                    minutesAgo: 4100,
                    quote: "on-wrote",
                    text: "Thanks Morgan. One question before I sign: does the fee cover the stock count at the Mill Road site, or is that billed separately?\n\nDana",
                },
                {
                    from: morgan,
                    to: [DANA],
                    cc: [priya],
                    minutesAgo: 4040,
                    quote: "outlook",
                    text: "Hi Dana,\n\nThe Mill Road count is included. The only extras would be travel if we need to attend a second site, and we would agree that with you first.\n\nPriya will be your day-to-day contact during fieldwork.\n\nMorgan",
                },
                {
                    from: DANA,
                    to: [morgan],
                    cc: [priya],
                    minutesAgo: 2980,
                    quote: "on-wrote",
                    text: "Perfect. Signed copy attached. See you on the 12th.\n\nDana",
                    attachments: [
                        {
                            name: "Signed engagement letter.pdf",
                            contentType: "application/pdf",
                            isInline: false,
                            content: pdfFromLines([
                                "Engagement letter - Northgate Bakery Group",
                                "Fee: $48,500 plus expenses.",
                                "Signed: Dana Whitfield, Chief Financial Officer",
                            ]),
                        },
                    ],
                },
            ],
        },
        {
            key: "planning-meeting",
            subject: "Year-end planning meeting",
            file: "clients",
            messages: [
                {
                    from: TOMAS,
                    to: [morgan],
                    minutesAgo: 1500,
                    text: "Hi Morgan,\n\nCould we find an hour next week to go through year-end planning for the practice? I am free Tuesday afternoon or any time Thursday.\n\nTomas",
                },
                {
                    from: morgan,
                    to: [TOMAS],
                    minutesAgo: 1440,
                    quote: "outlook",
                    text: "Hi Tomas,\n\nThursday at 10:00 works. I will send an invite. Please bring the lease proposal for the second practice so we can look at the cash flow together.\n\nMorgan",
                },
                {
                    from: TOMAS,
                    to: [morgan],
                    minutesAgo: 1380,
                    quote: "on-wrote",
                    text: "Thursday at 10 is in the diary. I will bring the lease.\n\nTomas",
                },
            ],
        },
        {
            key: "invoice-2041",
            subject: "Invoice INV-2041 for October services",
            file: "clients",
            messages: [
                {
                    from: BILLING,
                    to: [DANA],
                    cc: [morgan],
                    minutesAgo: 1200,
                    text: "Dear Dana,\n\nPlease find attached invoice INV-2041 for $19,400, the first instalment of the FY2026 audit fee. Payment is due within 30 days.\n\nHarlow Reed Accounts",
                    attachments: [
                        {
                            name: "INV-2041.pdf",
                            contentType: "application/pdf",
                            isInline: false,
                            content: pdfFromLines([
                                "Harlow Reed LLP - Invoice INV-2041",
                                "To: Northgate Bakery Group",
                                "FY2026 audit, first instalment (40%): $19,400.00",
                                "Due within 30 days.",
                            ]),
                        },
                    ],
                },
                {
                    from: DANA,
                    to: [BILLING],
                    cc: [morgan],
                    minutesAgo: 1100,
                    quote: "original-message",
                    text: "Received, thank you. This will go in Friday's payment run.\n\nDana",
                },
            ],
        },
        {
            key: "tax-memo",
            subject: "Draft tax memo for review",
            messages: [
                {
                    from: priya,
                    to: [morgan],
                    minutesAgo: 900,
                    text: "Morgan,\n\nDraft memo on the capital allowances for Northgate's two new ovens is attached. The claim comes to $186,000 in the year. Could you review before I send it to Dana?\n\nPriya",
                    attachments: [
                        {
                            name: "Capital allowances memo.docx",
                            contentType: DOCX,
                            isInline: false,
                            content: docxFromMarkdown(
                                "# Capital allowances memo\n\nNorthgate bought two deck ovens and a delivery van for $186,000.\n\n- The ovens qualify for full expensing\n- The van goes to the main pool\n"
                            ),
                        },
                    ],
                },
                {
                    from: morgan,
                    to: [priya],
                    minutesAgo: 840,
                    quote: "outlook",
                    text: "Priya,\n\nGood memo. Two changes: say which pool the van goes into and why, and add the payment date for the tax saving. Then it can go.\n\nMorgan",
                },
                {
                    from: priya,
                    to: [morgan],
                    minutesAgo: 800,
                    quote: "outlook",
                    text: "Done, both added. Sending to Dana this afternoon.\n\nPriya",
                },
            ],
        },
        {
            key: "pbc-list",
            subject: "Document request list for the audit",
            file: "clients",
            messages: [
                {
                    from: priya,
                    to: [ELENA],
                    cc: [morgan],
                    minutesAgo: 700,
                    text: "Hi Elena,\n\nThe request list for the Brightwater audit is in the shared Clients site. Four items; the bank statements and receivables listing are the ones we need first, by 20 November.\n\nThanks,\nPriya",
                },
                {
                    from: ELENA,
                    to: [priya],
                    cc: [morgan],
                    minutesAgo: 640,
                    quote: "on-wrote",
                    text: "Hi Priya,\n\nBank statements and the aged receivables are uploaded. The fleet leases will follow next week once legal releases them.\n\nElena Marsh\nController, Brightwater Logistics",
                    attachments: [
                        {
                            name: "brightwater-logo.png",
                            contentType: "image/png",
                            isInline: true,
                            contentId: "logo@brightwater-logistics.example",
                            content: tinyPng(),
                        },
                    ],
                },
            ],
        },
        {
            key: "onboarding",
            subject: "Bookkeeping onboarding: what we still need",
            messages: [
                {
                    from: TOMAS,
                    to: [morgan, priya],
                    minutesAgo: 560,
                    text: "Hi both,\n\nI have sent the bank feed access. The prior-year tax returns are with my old accountant; I have asked for them twice. Is there anything else blocking the November close?\n\nTomas",
                },
            ],
        },
        {
            key: "cpe",
            subject: "Reminder: CPE hours are due by 31 December",
            messages: [
                {
                    from: LEARNING,
                    to: [morgan, priya],
                    minutesAgo: 480,
                    htmlOnly: true,
                    text: "You have logged 31 of the 40 CPE hours required this year.\n\nThe ethics update on 3 December counts for two hours. Book through the learning portal.",
                },
            ],
        },
        {
            key: "fee-estimate",
            subject: "Fee estimate for the inventory count",
            messages: [
                {
                    from: ELENA,
                    to: [morgan],
                    minutesAgo: 300,
                    text: "Morgan,\n\nBefore the count on 30 November, could you send a fee estimate for attending both warehouses? Our budget assumed one site.\n\nElena",
                },
                {
                    from: morgan,
                    to: [ELENA],
                    minutesAgo: 120,
                    quote: "outlook",
                    draft: true,
                    text: "Hi Elena,\n\nAttending the second warehouse adds one day for two staff, about $3,200 plus travel. I can hold that as a cap if",
                },
            ],
        },
        {
            key: "close-2025",
            subject: "Closing out the 2025 engagement",
            file: "archive",
            messages: [
                {
                    from: DANA,
                    to: [morgan],
                    minutesAgo: 400000,
                    text: "Morgan,\n\nThe board approved the 2025 accounts last night. Thank you and the team for turning the last adjustments around so quickly.\n\nDana",
                },
                {
                    from: morgan,
                    to: [DANA],
                    minutesAgo: 399000,
                    quote: "original-message",
                    text: "Thank you Dana. The signed audit report is in the post, and I will send the management letter next week.\n\nMorgan",
                },
            ],
        },
        {
            key: "bank-confirmations",
            subject: "Bank confirmations: two still outstanding",
            file: "clients",
            messages: [
                {
                    from: priya,
                    to: [DANA],
                    minutesAgo: 240,
                    text: "Hi Dana,\n\nWe have nine of the eleven receivable confirmations back. The two outstanding are Corner Cup Cafes and Harbourside Coffee. Could someone on your team nudge them?\n\nPriya",
                },
                {
                    from: DANA,
                    to: [priya],
                    cc: [morgan],
                    minutesAgo: 90,
                    quote: "on-wrote",
                    text: "Copying Morgan. I spoke to both this morning; Corner Cup will reply today and Harbourside has asked for the request to be re-sent to their new finance lead.\n\nDana",
                },
            ],
        },
    ];
}

const FOLDERS: [slug: string, displayName: string, wellKnownName?: string, parent?: string][] = [
    ["inbox", "Inbox", "inbox"],
    ["sent", "Sent Items", "sentitems"],
    ["drafts", "Drafts", "drafts"],
    ["archive", "Archive", "archive"],
    ["clients", "Clients", undefined, "inbox"],
];

export function mailFolderId(account: StandInAccount, slug: string): string {
    return `mf-${account.key}-${slug}`;
}

function isoSeconds(ms: number): string {
    return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function seedMail(now: number): { folders: SeedMailFolder[]; messages: SeedMessage[] } {
    const folders: SeedMailFolder[] = ACCOUNTS.flatMap(account =>
        FOLDERS.map(([slug, displayName, wellKnownName, parent]) => ({
            id: mailFolderId(account, slug),
            oid: account.oid,
            displayName,
            parentFolderId: mailFolderId(account, parent ?? "root"),
            wellKnownName,
        }))
    );

    const messages: SeedMessage[] = [];
    for (const conv of conversations()) {
        let previous: QuotedMessage | undefined;
        conv.messages.forEach((draft, index) => {
            const subject = index === 0 ? conv.subject : `RE: ${conv.subject}`;
            const sentAt = now - draft.minutesAgo * 60_000;
            const inline = draft.attachments?.find(a => a.isInline)?.contentId;
            const bodies = composeBodies(
                draft.text,
                draft.quote && previous ? { style: draft.quote, previous } : undefined,
                inline
            );
            const everyone = [draft.from, ...draft.to, ...(draft.cc ?? [])];
            for (const account of ACCOUNTS) {
                const mine = draft.from.address === account.email;
                if (!everyone.some(p => p.address === account.email)) continue;
                if (draft.draft && !mine) continue;
                const slug = draft.draft
                    ? "drafts"
                    : mine
                      ? "sent"
                      : conv.file === "archive"
                        ? "archive"
                        : conv.file === "clients"
                          ? "clients"
                          : "inbox";
                const id = `msg-${account.key}-${conv.key}-${index + 1}`;
                messages.push({
                    id,
                    oid: account.oid,
                    folderId: mailFolderId(account, slug),
                    conversationId: `conv-${account.key}-${conv.key}`,
                    subject,
                    from: draft.from,
                    to: draft.to,
                    cc: draft.cc ?? [],
                    sentDateTime: isoSeconds(sentAt),
                    // Delivery takes a few seconds; your own copy lands as you send it.
                    receivedDateTime: isoSeconds(mine ? sentAt : sentAt + 4000),
                    isDraft: draft.draft === true,
                    isRead: mine || draft.minutesAgo > 600,
                    html: bodies.html,
                    text: draft.htmlOnly ? undefined : bodies.text,
                    internetMessageId: `<${conv.key}-${index + 1}@${draft.from.address.split("@")[1]!}>`,
                    attachments: (draft.attachments ?? []).map((a, n) => ({
                        ...a,
                        id: `att-${account.key}-${conv.key}-${index + 1}-${n + 1}`,
                    })),
                });
            }
            previous = {
                from: draft.from,
                to: draft.to,
                sent: new Date(sentAt),
                subject,
                text: bodies.text,
            };
        });
    }
    return { folders, messages };
}
