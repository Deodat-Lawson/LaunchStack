/**
 * Recipient ingestion (member.md Phase 1).
 *
 * The load-bearing assertion is that nothing here ever invents an address:
 * a row that cannot yield a real email must be reported, never guessed.
 */

import {
    combineRecipients,
    looksLikeEmail,
    parsePastedRecipients,
    parseRecipientCsv,
    prospectContextNotes,
    recipientsFromProspects,
} from "@launchstack/features/email-pipeline/recipients";

describe("looksLikeEmail", () => {
    it.each(["ada@example.com", "ada.lovelace+tag@sub.example.co.uk", "  spaced@example.com  "])(
        "accepts %s",
        v => expect(looksLikeEmail(v)).toBe(true)
    );

    it.each(["", "   ", "ada", "ada@", "@example.com", "ada@example", "a b@c.com"])(
        "rejects %p",
        v => expect(looksLikeEmail(v)).toBe(false)
    );
});

describe("parsePastedRecipients", () => {
    it("parses one address per line", () => {
        const r = parsePastedRecipients("ada@example.com\ngrace@example.com");
        expect(r.recipients.map(x => x.email)).toEqual(["ada@example.com", "grace@example.com"]);
        expect(r.skipped).toEqual([]);
    });

    it("parses comma and semicolon separated addresses", () => {
        const r = parsePastedRecipients("ada@example.com, grace@example.com; alan@example.com");
        expect(r.recipients).toHaveLength(3);
    });

    it("extracts a display name from Name <addr>", () => {
        const r = parsePastedRecipients("Ada Lovelace <ada@example.com>");
        expect(r.recipients[0]).toMatchObject({
            email: "ada@example.com",
            name: "Ada Lovelace",
        });
    });

    it("keeps a comma inside a display name", () => {
        const r = parsePastedRecipients("Lovelace, Ada <ada@example.com>");
        expect(r.recipients).toHaveLength(1);
        expect(r.recipients[0]!.name).toBe("Lovelace, Ada");
    });

    it("lowercases addresses", () => {
        const r = parsePastedRecipients("ADA@Example.COM");
        expect(r.recipients[0]!.email).toBe("ada@example.com");
    });

    it("reports unparseable lines with their row number instead of dropping them", () => {
        const r = parsePastedRecipients("ada@example.com\nnot-an-email\n");
        expect(r.recipients).toHaveLength(1);
        expect(r.skipped).toEqual([
            { row: 2, reason: "not a valid email address", raw: "not-an-email" },
        ]);
    });

    it("handles empty input", () => {
        expect(parsePastedRecipients("")).toEqual({ recipients: [], skipped: [] });
    });
});

describe("parseRecipientCsv", () => {
    const csv = [
        "email,name,company,notes",
        "ada@example.com,Ada Lovelace,Analytical Engines,met at a conference",
        "grace@example.com,Grace Hopper,Compilers Inc,",
    ].join("\n");

    it("maps the canonical columns", () => {
        const r = parseRecipientCsv(csv);
        expect(r.recipients).toHaveLength(2);
        expect(r.recipients[0]).toMatchObject({
            email: "ada@example.com",
            name: "Ada Lovelace",
            company: "Analytical Engines",
            contextNotes: "met at a conference",
        });
    });

    it("treats an empty cell as null rather than an empty string", () => {
        const r = parseRecipientCsv(csv);
        expect(r.recipients[1]!.contextNotes).toBeNull();
    });

    it("accepts header aliases and odd casing", () => {
        const r = parseRecipientCsv("E-Mail Address,Full Name\nada@example.com,Ada");
        expect(r.recipients[0]).toMatchObject({
            email: "ada@example.com",
            name: "Ada",
        });
    });

    it("keeps unmapped columns as per-recipient merge vars", () => {
        const r = parseRecipientCsv("email,industry\nada@example.com,Rail");
        expect(r.recipients[0]!.vars).toEqual({ industry: "Rail" });
    });

    it("honours quoted fields containing commas and escaped quotes", () => {
        const r = parseRecipientCsv('email,company\nada@example.com,"Lovelace, Ada ""and Co"""');
        expect(r.recipients[0]!.company).toBe('Lovelace, Ada "and Co"');
    });

    it("fails the whole file when there is no email column", () => {
        const r = parseRecipientCsv("name,company\nAda,Analytical Engines");
        expect(r.recipients).toEqual([]);
        expect(r.skipped[0]!.reason).toMatch(/no email column/);
    });

    it("reports bad rows with a row number and keeps the good ones", () => {
        const r = parseRecipientCsv("email,name\nada@example.com,Ada\nnope,Bob\n,Carol");
        expect(r.recipients).toHaveLength(1);
        expect(r.skipped).toEqual([
            { row: 3, reason: "not a valid email address", raw: "nope,Bob" },
            { row: 4, reason: "empty email cell", raw: ",Carol" },
        ]);
    });

    it("handles an empty file", () => {
        expect(parseRecipientCsv("")).toEqual({ recipients: [], skipped: [] });
    });
});

describe("recipientsFromProspects", () => {
    const prospects = [
        {
            name: "Cedar Ridge Coffee",
            address: "12 Mill St",
            website: "https://cedarridge.example",
            categories: ["Coffee Shop", "Bakery"],
            rationale: "independent, no national chain nearby",
        },
        { name: "Northgate Hardware", address: "4 North Rd" },
    ];

    it("never invents an address — prospects without one land in needsEmail", () => {
        const r = recipientsFromProspects(prospects);
        expect(r.recipients).toEqual([]);
        expect(r.needsEmail).toHaveLength(2);
        expect(r.needsEmail[0]!.prospect.name).toBe("Cedar Ridge Coffee");
    });

    it("preserves grounded context for a human to complete", () => {
        const r = recipientsFromProspects(prospects);
        expect(r.needsEmail[0]!.contextNotes).toContain("Coffee Shop");
        expect(r.needsEmail[0]!.contextNotes).toContain("12 Mill St");
    });

    it("uses a supplied address and carries the prospect as the company", () => {
        const r = recipientsFromProspects(prospects, {
            "Cedar Ridge Coffee": "hello@cedarridge.example",
        });
        expect(r.recipients).toHaveLength(1);
        expect(r.recipients[0]).toMatchObject({
            email: "hello@cedarridge.example",
            company: "Cedar Ridge Coffee",
        });
        expect(r.recipients[0]!.vars.website).toBe("https://cedarridge.example");
        expect(r.needsEmail).toHaveLength(1);
    });

    it("rejects a supplied address that is malformed", () => {
        const r = recipientsFromProspects(prospects, {
            "Cedar Ridge Coffee": "not-an-email",
        });
        expect(r.recipients).toEqual([]);
        expect(r.skipped[0]!.reason).toMatch(/not valid/);
    });

    it("builds context notes from whatever fields exist", () => {
        expect(prospectContextNotes({ name: "X" })).toBe("");
        expect(prospectContextNotes({ name: "X", address: "1 A St" })).toBe("1 A St");
    });
});

describe("combineRecipients", () => {
    it("de-duplicates across sources, keeping the first occurrence", () => {
        const a = parsePastedRecipients("Ada Lovelace <ada@example.com>");
        const b = parsePastedRecipients("ada@example.com\ngrace@example.com");
        const combined = combineRecipients(a, b);

        expect(combined.recipients).toHaveLength(2);
        expect(combined.recipients[0]!.name).toBe("Ada Lovelace");
        expect(combined.skipped.some(s => s.reason.includes("duplicate"))).toBe(true);
    });

    it("carries skipped rows through from every source", () => {
        const combined = combineRecipients(
            parsePastedRecipients("bad-row"),
            parsePastedRecipients("ada@example.com")
        );
        expect(combined.recipients).toHaveLength(1);
        expect(combined.skipped).toHaveLength(1);
    });

    it("handles no sources", () => {
        expect(combineRecipients()).toEqual({ recipients: [], skipped: [] });
    });
});
