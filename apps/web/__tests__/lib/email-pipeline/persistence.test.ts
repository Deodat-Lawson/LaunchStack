/**
 * Persistence round-trips for the two gaps found in Phase 0:
 *
 *   1. `Recipient.vars` existed in the contract but had no column, so extra
 *      per-recipient merge variables were lost on write.
 *   2. `email_sends.subject` existed in the schema but was never written, so
 *      the audit trail recorded *that* something was sent, not *what*.
 *
 * The DB is mocked: these assert the exact values the persistence layer hands
 * to Drizzle, and that a read reconstructs an equivalent `Recipient`. No real
 * database is touched.
 */

type Row = Record<string, unknown>;

const inserted: { table: string; values: Row[] }[] = [];
let selectRows: Row[] = [];

/** Minimal Drizzle stand-in: records inserts, replays a canned select. */
const fakeDb = {
    insert(table: { _tableName?: string }) {
        return {
            values(values: Row | Row[]) {
                inserted.push({
                    table: table?._tableName ?? "unknown",
                    values: Array.isArray(values) ? values : [values],
                });
                return { onConflictDoNothing: () => Promise.resolve() };
            },
        };
    },
    select() {
        return { from: () => ({ where: () => Promise.resolve(selectRows) }) };
    },
};

jest.mock("@launchstack/core/db", () => ({ getDb: () => fakeDb }));

jest.mock("@launchstack/core/db/schema", () => ({
    emailCampaigns: { _tableName: "email_campaigns" },
    emailRecipients: {
        _tableName: "email_recipients",
        campaignId: "campaign_id",
        email: "email",
        name: "name",
        company: "company",
        contextNotes: "context_notes",
        vars: "vars",
    },
    emailSends: {
        _tableName: "email_sends",
        campaignId: "campaign_id",
        recipientEmail: "recipient_email",
        status: "status",
    },
    emailSuppressions: { _tableName: "email_suppressions" },
}));

import { loadRecipients, saveRecipients, saveSends } from "@launchstack/features/email-pipeline/db";
import { sendCampaign } from "@launchstack/features/email-pipeline/send";
import { RecipientSchema } from "@launchstack/features/email-pipeline/types";
import type { SendResult } from "@launchstack/features/email-pipeline/types";

const recipient = (over: Record<string, unknown> = {}) =>
    RecipientSchema.parse({ email: "ada@example.com", ...over });

beforeEach(() => {
    inserted.length = 0;
    selectRows = [];
});

const rowsFor = (table: string) => inserted.filter(i => i.table === table).flatMap(i => i.values);

/* ──────────────────────────────────────────────────────────────
 * 1 — Recipient.vars survives a round trip
 * ────────────────────────────────────────────────────────────── */

describe("saveRecipients", () => {
    it("writes vars so extra merge variables are not lost", async () => {
        await saveRecipients(7, [
            recipient({
                name: "Ada Lovelace",
                company: "Analytical Engines",
                contextNotes: "met at a conference",
                vars: { industry: "Rail", tier: "gold" },
            }),
        ]);

        const [row] = rowsFor("email_recipients");
        expect(row).toMatchObject({
            campaignId: 7,
            email: "ada@example.com",
            name: "Ada Lovelace",
            company: "Analytical Engines",
            contextNotes: "met at a conference",
            vars: { industry: "Rail", tier: "gold" },
        });
    });

    it("stores null rather than {} when there are no extra variables", async () => {
        await saveRecipients(7, [recipient()]);
        expect(rowsFor("email_recipients")[0]!.vars).toBeNull();
    });

    it("writes one row per recipient", async () => {
        await saveRecipients(7, [recipient(), recipient({ email: "grace@example.com" })]);
        expect(rowsFor("email_recipients")).toHaveLength(2);
    });

    it("does not touch the DB for an empty list", async () => {
        await saveRecipients(7, []);
        expect(inserted).toHaveLength(0);
    });
});

describe("loadRecipients", () => {
    it("restores vars from the stored JSON", async () => {
        selectRows = [
            {
                email: "ada@example.com",
                name: "Ada Lovelace",
                company: "Analytical Engines",
                contextNotes: "met at a conference",
                vars: { industry: "Rail" },
            },
        ];

        const [loaded] = await loadRecipients(7);
        expect(loaded).toEqual(
            recipient({
                name: "Ada Lovelace",
                company: "Analytical Engines",
                contextNotes: "met at a conference",
                vars: { industry: "Rail" },
            })
        );
    });

    it("treats a null vars column as no extra variables", async () => {
        selectRows = [
            { email: "ada@example.com", name: null, company: null, contextNotes: null, vars: null },
        ];
        const [loaded] = await loadRecipients(7);
        expect(loaded!.vars).toEqual({});
    });

    it("round-trips: what saveRecipients writes, loadRecipients reads back", async () => {
        const original = recipient({
            name: "Grace Hopper",
            company: "Compilers Inc",
            vars: { industry: "Defence", seat: "12" },
        });

        await saveRecipients(9, [original]);
        const written = rowsFor("email_recipients")[0]!;

        // Feed exactly what was written back through the read path.
        selectRows = [
            {
                email: written.email,
                name: written.name,
                company: written.company,
                contextNotes: written.contextNotes,
                vars: written.vars,
            },
        ];

        const [loaded] = await loadRecipients(9);
        expect(loaded).toEqual(original);
    });

    it("returns an empty list when the campaign has no recipients", async () => {
        selectRows = [];
        expect(await loadRecipients(7)).toEqual([]);
    });
});

/* ──────────────────────────────────────────────────────────────
 * 2 — the rendered subject is recorded for every send
 * ────────────────────────────────────────────────────────────── */

describe("saveSends", () => {
    it("writes the rendered subject", async () => {
        const results: SendResult[] = [
            {
                recipientEmail: "ada@example.com",
                status: "sent",
                subject: "A quick thought for Analytical Engines",
                providerMessageId: "msg-1",
            },
        ];

        await saveSends(3, results);

        expect(rowsFor("email_sends")[0]).toMatchObject({
            campaignId: 3,
            recipientEmail: "ada@example.com",
            subject: "A quick thought for Analytical Engines",
            status: "sent",
            providerMessageId: "msg-1",
        });
    });

    it("records the subject for a dry run too", async () => {
        await saveSends(3, [
            { recipientEmail: "ada@example.com", status: "dry_run", subject: "Hello Ada" },
        ]);
        expect(rowsFor("email_sends")[0]!.subject).toBe("Hello Ada");
    });

    it("records the subject on a failed send, so a retry is diagnosable", async () => {
        await saveSends(3, [
            {
                recipientEmail: "ada@example.com",
                status: "failed",
                subject: "Hello Ada",
                error: "provider timeout",
            },
        ]);
        expect(rowsFor("email_sends")[0]).toMatchObject({
            subject: "Hello Ada",
            error: "provider timeout",
        });
    });

    it("stores null for statuses decided before rendering", async () => {
        await saveSends(3, [
            { recipientEmail: "a@example.com", status: "suppressed" },
            { recipientEmail: "b@example.com", status: "skipped" },
        ]);
        const rows = rowsFor("email_sends");
        expect(rows.map(r => r.subject)).toEqual([null, null]);
    });

    it("sets sentAt only for a real send", async () => {
        await saveSends(3, [
            { recipientEmail: "a@example.com", status: "sent", subject: "s" },
            { recipientEmail: "b@example.com", status: "dry_run", subject: "s" },
        ]);
        const rows = rowsFor("email_sends");
        expect(rows[0]!.sentAt).toBeInstanceOf(Date);
        expect(rows[1]!.sentAt).toBeNull();
    });

    it("does not touch the DB for an empty result set", async () => {
        await saveSends(3, []);
        expect(inserted).toHaveLength(0);
    });
});

/* ──────────────────────────────────────────────────────────────
 * The other half of fix 2: the send path must *produce* a subject
 * for saveSends to have anything to write.
 * ────────────────────────────────────────────────────────────── */

describe("sendCampaign populates SendResult.subject", () => {
    const template = {
        subject: "Hello {{firstName}}",
        body: "Hi {{firstName}} — {{senderIdentity}} — {{unsubscribeUrl}}",
        variables: ["firstName", "senderIdentity", "unsubscribeUrl"],
    };
    const base = {
        template,
        senderIdentity: "Meridian, 12 Mill St",
        unsubscribeBaseUrl: "https://example.com/u",
    };

    it("carries the rendered subject on a dry run", async () => {
        const results = await sendCampaign({
            ...base,
            recipients: [recipient({ name: "Ada Lovelace" })],
            mode: "dry_run",
        });
        expect(results[0]).toMatchObject({ status: "dry_run", subject: "Hello Ada" });
    });

    it("carries the rendered subject on a real send", async () => {
        const results = await sendCampaign({
            ...base,
            recipients: [recipient({ name: "Ada Lovelace" })],
            mode: "send",
            adapter: {
                name: "test",
                send: () => Promise.resolve({ messageId: "m-1" }),
            },
        });
        expect(results[0]).toMatchObject({ status: "sent", subject: "Hello Ada" });
    });

    it("carries the subject when the adapter throws, so a failure is diagnosable", async () => {
        const results = await sendCampaign({
            ...base,
            recipients: [recipient({ name: "Ada Lovelace" })],
            mode: "send",
            adapter: {
                name: "test",
                send: () => Promise.reject(new Error("provider down")),
            },
        });
        expect(results[0]).toMatchObject({
            status: "failed",
            subject: "Hello Ada",
            error: "provider down",
        });
    });

    it("omits the subject for recipients rejected before rendering", async () => {
        const results = await sendCampaign({
            ...base,
            recipients: [
                recipient({ email: "sup@example.com" }),
                recipient({ email: "dupe@example.com" }),
            ],
            mode: "dry_run",
            isSuppressed: email => email === "sup@example.com",
            alreadySent: email => email === "dupe@example.com",
        });
        expect(results.map(r => [r.status, r.subject])).toEqual([
            ["suppressed", undefined],
            ["skipped", undefined],
        ]);
    });
});
