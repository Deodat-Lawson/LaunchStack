import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import pilot from "../../../fixtures/vantage-benchmarks/rag-multi-corpus/pilot.json";
import { parseCsv } from "./csv";
import {
    benchmarkCaseSchema,
    caseId,
    histogram,
    importPinnedCsv,
    normalizeCsv,
    pilotSchema,
    selectPilot,
    serializePilot,
    sha256,
    sourceLock,
} from "./rag-multi-corpus";

const header = ["Enterprise Name", "Query Type", "Query", "Supporting Facts"];
const encode = (rows: string[][], newline = "\n") =>
    rows.map(row => row.map(cell => `"${cell.replaceAll('"', '""')}"`).join(",")).join(newline);
const row = (
    question = "What changed?",
    evidence: unknown = [{ filename: "note.md", text: "A fact." }]
) => ["Synthetic test enterprise", "Descriptive", question, JSON.stringify(evidence)];
const csv = (...rows: string[][]) => encode([header, ...rows]);
const sample = readFileSync(
    new URL(
        "../../../fixtures/vantage-benchmarks/rag-multi-corpus/pilot-source.csv",
        import.meta.url
    ),
    "utf8"
);

/**
 * Independent oracle. `raw` is the exact record text from the pinned upstream CSV (which
 * uses CRLF line endings). `expected` and `id` were produced by Python's standard csv and
 * json modules from that pinned file, not by this importer, so a parser bug shared by
 * pilot.json and pilot-source.csv cannot make both sides agree.
 */
const upstreamHeader = "Enterprise Name,Query Type,Query,Supporting Facts";
const upstreamOracle = [
    {
        recordNumber: 539,
        raw: String.raw`Aventro Motors,Analytical,Why is it important to use the parking brake when opening the fuel knob?,"[{""filename"": ""How to Open the Fuel Knob in Aventro Cars.md"", ""text"": ""Ensure your car is completely stopped and the engine is turned off. Engage the parking brake for safety.""}, {""filename"": ""How to Open the Fuel Knob in Aventro Cars.md"", ""text"": ""Using the parking brake prevents accidental movement and provides additional safety during the process.""}]"`,
        id: "rag-multi-corpus:04f17833242b4009d050c049ee40893af31f218091745c3bdcd9847dac1dcbdf",
        expected: {
            enterprise: "Aventro Motors",
            queryType: "Analytical",
            question: "Why is it important to use the parking brake when opening the fuel knob?",
            supportingFacts: [
                {
                    filename: "How to Open the Fuel Knob in Aventro Cars.md",
                    text: "Ensure your car is completely stopped and the engine is turned off. Engage the parking brake for safety.",
                },
                {
                    filename: "How to Open the Fuel Knob in Aventro Cars.md",
                    text: "Using the parking brake prevents accidental movement and provides additional safety during the process.",
                },
            ],
        },
    },
    {
        recordNumber: 1165,
        raw: String.raw`Cloudway 24,Supporting,What are the options for using SkyPoints 24 for upgrades at CloudWay 24?,"[{""filename"": ""Upgrade Your Seat.md"", ""text"": ""- Use your accumulated points for full or partial upgrades.\n- Tier status may offer complimentary or discounted upgrades on select flights (check your benefits).""}]"`,
        id: "rag-multi-corpus:280a5829a65cb691b2c6be038e2a656e4ba4ff1e91f711322521f7338b5e9619",
        expected: {
            enterprise: "Cloudway 24",
            queryType: "Supporting",
            question: "What are the options for using SkyPoints 24 for upgrades at CloudWay 24?",
            supportingFacts: [
                {
                    filename: "Upgrade Your Seat.md",
                    // The JSON escape \n in the CSV decodes once to a real newline.
                    text: "- Use your accumulated points for full or partial upgrades.\n- Tier status may offer complimentary or discounted upgrades on select flights (check your benefits).",
                },
            ],
        },
    },
];

/** Synthetic cases with chosen labels; questions are distinct so no duplicates arise. */
const pool = (spec: [enterprise: string, category: string, copies: number][]) =>
    normalizeCsv(
        csv(
            ...spec.flatMap(([enterprise, category, copies]) =>
                Array.from({ length: copies }, (_, i) => [
                    enterprise,
                    category,
                    `${enterprise} / ${category} question ${i}`,
                    JSON.stringify([{ filename: "note.md", text: "A fact." }]),
                ])
            )
        )
    ).cases;
const pairCounts = (cases: readonly { enterprise: string; queryType: string }[]) => {
    const counts: Record<string, number> = {};
    for (const item of cases) {
        const key = `${item.enterprise}/${item.queryType}`;
        counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
};

describe("benchmark CSV transport", () => {
    it("preserves embedded commas, escaped quotes, Unicode, spaces and literal newlines", () => {
        const cells = [
            " Org, Inc. ",
            "Category",
            'Who said "yes"?\r\nAnd when?\nSecond line',
            ' [{"filename":" café.md ","text":"  Keep this.  "}] ',
        ];
        expect(parseCsv(encode([header, cells], "\r\n"))[1]!.cells).toEqual(cells);
    });
    it("handles BOM, LF/CRLF/CR records, blank physical lines, EOF and trailing fields", () => {
        expect(parseCsv("\uFEFFa,b\r\n\r\nx,y\nz,\r")).toEqual([
            { cells: ["a", "b"], recordNumber: 1, startLine: 1 },
            { cells: ["x", "y"], recordNumber: 2, startLine: 3 },
            { cells: ["z", ""], recordNumber: 3, startLine: 4 },
        ]);
        expect(parseCsv('"a",""')[0]!.cells).toEqual(["a", ""]);
        expect(parseCsv("a,b")[0]!.cells).toEqual(["a", "b"]);
        expect(parseCsv("a,")[0]!.cells).toEqual(["a", ""]);
    });
    it("tracks logical record numbers separately from physical multiline positions", () => {
        const records = parseCsv(encode([header, row("A\r\nB"), row("C")], "\r\n"));
        expect(records[1]).toMatchObject({ recordNumber: 2, startLine: 2 });
        expect(records[2]).toMatchObject({ recordNumber: 3, startLine: 4 });
    });
    it.each(['a,"unclosed', 'a,"closed"junk', 'un"quoted,b', '"a" "b",c'])(
        "rejects malformed quoting: %s",
        text => {
            expect(() => parseCsv(text)).toThrow(/quot/);
        }
    );
});

describe("lossless normalization and validation", () => {
    it("preserves original columns and decoded evidence without rewriting or double unescaping", () => {
        const evidence = [
            {
                filename: " ../opaque filename.md ",
                text: '  Evidence, with "quotes".\nLiteral escape: \\u2019. Actual: ’.  ',
            },
        ];
        const input = [
            " Enterprise ",
            " Unusual label ",
            " Question?\n ",
            JSON.stringify(evidence, null, 2),
        ];
        const item = normalizeCsv(csv(input)).cases[0]!;
        expect([item.enterprise, item.queryType, item.question]).toEqual(input.slice(0, 3));
        expect(item.groundTruth).toEqual({
            kind: "supporting-facts",
            referenceAnswer: null,
            supportingFacts: evidence,
        });
        expect(item.vantageAnnotations).toBeNull();
    });
    it("accepts reordered known headers but rejects duplicates, unknown headers and absent data", () => {
        const original = row();
        expect(
            normalizeCsv(encode([[...header].reverse(), [...original].reverse()])).cases
        ).toEqual(normalizeCsv(csv(original)).cases);
        for (const text of [
            "",
            encode([header]),
            encode([
                [...header, "Answer"],
                [...original, "invented"],
            ]),
            encode([[header[0]!, header[0]!, header[2]!, header[3]!], original]),
        ])
            expect(() => normalizeCsv(text)).toThrow();
    });
    it.each(
        [
            [],
            [{ filename: "x" }],
            [{ filename: "", text: "fact" }],
            [{ filename: "x", text: "  " }],
            [{ filename: "x", text: 42 }],
            [{ filename: "x", text: "fact", answer: "invented" }],
            { filename: "x", text: "fact" },
            null,
            "text",
        ].map(evidence => ({ evidence }))
    )("rejects invalid supporting facts %#", ({ evidence }) => {
        expect(() => normalizeCsv(csv(row("Question", evidence)))).toThrow(/Supporting Facts/);
    });
    it("reports invalid JSON, wrong widths and blank identity fields with row locations", () => {
        expect(() => normalizeCsv(csv([...row().slice(0, 3), "not JSON"]))).toThrow(
            /Record 2.*not valid JSON/
        );
        expect(() => normalizeCsv(csv(row().slice(0, 3)))).toThrow(/four fields/);
        for (const index of [0, 1, 2]) {
            const input = row();
            input[index] = " \n ";
            expect(() => normalizeCsv(csv(input))).toThrow(/Record 2/);
        }
        expect(() => normalizeCsv(csv(row("good"), [...row("bad").slice(0, 3), "broken"]))).toThrow(
            /Record 3/
        );
    });
    it("has content-based stable IDs independent of CSV row order and JSON formatting", () => {
        const a = row("One"),
            b = row("Two");
        const original = normalizeCsv(csv(a, b));
        b[3] = JSON.stringify(JSON.parse(b[3]!), null, 2);
        const reversed = normalizeCsv(csv(b, a));
        expect(original.cases.map(item => item.id)).toEqual(reversed.cases.map(item => item.id));
        const changed = normalizeCsv(
            csv(row("One", [{ filename: "note.md", text: "Changed fact." }]))
        );
        expect(changed.cases[0]!.id).not.toBe(
            original.cases.find(item => item.question === "One")!.id
        );
    });
    it("rejects duplicate IDs by default and explicitly merges identical rows with all locations", () => {
        expect(() => normalizeCsv(csv(row(), row()))).toThrow(/duplicate case ID/);
        const merged = normalizeCsv(csv(row(), row()), "merge-identical");
        expect(merged).toMatchObject({ sourceRows: 2, duplicateRows: 1 });
        expect(merged.cases).toHaveLength(1);
        expect(merged.cases[0]!.sourceRecords).toEqual([
            { recordNumber: 2, startLine: 2 },
            { recordNumber: 3, startLine: 3 },
        ]);
    });
    it("checks the pinned download hash before accepting data as official provenance", () => {
        expect(() => importPinnedCsv(new TextEncoder().encode(csv(row())))).toThrow(
            /SHA-256 mismatch/
        );
    });
});

describe("coverage-balanced selection on synthetic pools larger than the pick", () => {
    it("picks scarce labels over a large common group", () => {
        const cases = pool([
            ["Big Org", "Common", 30],
            ["Rare Org", "Common", 1],
            ["Big Org", "Rare category", 1],
        ]);
        expect(pairCounts(selectPilot(cases, 3))).toEqual({
            "Big Org/Common": 1,
            "Rare Org/Common": 1,
            "Big Org/Rare category": 1,
        });
    });
    it("prefers a case adding two unseen labels over one adding a single label", () => {
        const selected = selectPilot(
            pool([
                ["A", "X", 5],
                ["A", "Y", 5],
                ["B", "X", 5],
                ["B", "Y", 5],
            ]),
            2
        );
        expect(histogram(selected, "enterprise")).toEqual({ A: 1, B: 1 });
        expect(histogram(selected, "queryType")).toEqual({ X: 1, Y: 1 });
    });
    it("covers unseen categories even when that overloads one enterprise", () => {
        // Y, Z and W exist only under A. Covering all six labels in four picks forces A three
        // times; plain enterprise balancing would stop at A 2, B 2 and leave a category out.
        const selected = selectPilot(
            pool([
                ["A", "Y", 1],
                ["A", "Z", 1],
                ["A", "W", 1],
                ["B", "X", 10],
            ]),
            4
        );
        expect(pairCounts(selected)).toEqual({ "A/Y": 1, "A/Z": 1, "A/W": 1, "B/X": 1 });
    });
    it("balances enterprises before categories once every label is covered", () => {
        // B only has X. Category balancing alone would spread picks over X, Y and Z, which
        // gives A at least five picks. Enterprise balancing must win and land on 4 / 4.
        const selected = selectPilot(
            pool([
                ["A", "X", 10],
                ["A", "Y", 10],
                ["A", "Z", 10],
                ["B", "X", 10],
            ]),
            8
        );
        expect(histogram(selected, "enterprise")).toEqual({ A: 4, B: 4 });
    });
    it("balances categories when enterprise counts tie", () => {
        // X is shared by both enterprises. A 3 / 3 split exists where every category gets
        // exactly two picks, and only the category rule finds it (otherwise X gets three).
        const selected = selectPilot(
            pool([
                ["A", "X", 10],
                ["A", "Y", 10],
                ["B", "X", 10],
                ["B", "Z", 10],
            ]),
            6
        );
        expect(histogram(selected, "enterprise")).toEqual({ A: 3, B: 3 });
        expect(histogram(selected, "queryType")).toEqual({ X: 2, Y: 2, Z: 2 });
    });
    it("balances enterprises once covered and moves on when one runs out", () => {
        const selected = selectPilot(
            pool([
                ["A", "X", 20],
                ["B", "X", 20],
                ["C", "X", 2],
            ]),
            8
        );
        expect(histogram(selected, "enterprise")).toEqual({ A: 3, B: 3, C: 2 });
    });
    it("balances enterprise/category pairs when enterprise and category counts tie", () => {
        // After A/X and B/Y, all enterprise and category counts tie. Only the pair rule keeps
        // the two rare pairs from losing to the 50-copy pairs on case ID.
        const selected = selectPilot(
            pool([
                ["A", "X", 50],
                ["B", "Y", 50],
                ["A", "Y", 1],
                ["B", "X", 1],
            ]),
            4
        );
        expect(pairCounts(selected)).toEqual({ "A/X": 1, "A/Y": 1, "B/X": 1, "B/Y": 1 });
    });
    it("breaks full ties by smallest case ID", () => {
        const cases = pool([["A", "X", 6]]);
        const smallest = cases
            .map(item => item.id)
            .sort()
            .slice(0, 3);
        expect(selectPilot(cases, 3).map(item => item.id)).toEqual(smallest);
    });
    it("is independent of input order on a larger pool", () => {
        const cases = pool([
            ["A", "X", 7],
            ["A", "Y", 3],
            ["B", "X", 4],
            ["C", "Z", 2],
        ]);
        const ids = selectPilot(cases, 10).map(item => item.id);
        const interleaved = [...cases.filter((_, i) => i % 2), ...cases.filter((_, i) => !(i % 2))];
        expect(selectPilot([...cases].reverse(), 10).map(item => item.id)).toEqual(ids);
        expect(selectPilot(interleaved, 10).map(item => item.id)).toEqual(ids);
    });
});

describe("real upstream pilot fixtures (offline)", () => {
    it("validates all cases, real source coverage and the explicit missing-answer boundary", () => {
        const parsed = pilotSchema.parse(pilot);
        expect(parsed.cases).toHaveLength(20);
        expect(parsed.selection).toMatchObject({
            sourceRows: 1252,
            uniqueCases: 1075,
            duplicateRows: 177,
        });
        expect(new Set(parsed.cases.map(item => item.enterprise)).size).toBe(5);
        expect(new Set(parsed.cases.map(item => item.queryType)).size).toBe(11);
        for (const item of parsed.cases) {
            expect(item.groundTruth.referenceAnswer).toBeNull();
            expect(item.vantageAnnotations).toBeNull();
            expect(item.id).toBe(caseId(item));
        }
    });
    it("matches normalized questions, labels, filenames and every passage against the real CSV subset", () => {
        const imported = normalizeCsv(sample, "merge-identical");
        expect(imported.cases).toHaveLength(pilot.cases.length);
        for (const item of pilot.cases) {
            const raw = imported.cases.find(source => source.id === item.id)!;
            expect(raw).toBeDefined();
            expect({ ...raw, sourceRecords: item.sourceRecords }).toEqual(item);
            expect(raw.sourceRecords.length).toBe(item.sourceRecords.length);
        }
    });
    it("selects deterministically regardless of input order and does not mutate inputs", () => {
        const cases = normalizeCsv(sample, "merge-identical").cases;
        const before = structuredClone(cases);
        const ids = selectPilot(cases).map(item => item.id);
        expect(ids).toEqual(selectPilot([...cases].reverse()).map(item => item.id));
        expect(ids).toEqual(pilot.cases.map(item => item.id));
        expect(cases).toEqual(before);
    });
    it.each(upstreamOracle)(
        "matches independently decoded upstream record $recordNumber",
        ({ raw, id, expected, recordNumber }) => {
            const [item] = normalizeCsv(`${upstreamHeader}\r\n${raw}\r\n`).cases;
            const fields = (value: typeof item) => ({
                enterprise: value!.enterprise,
                queryType: value!.queryType,
                question: value!.question,
                supportingFacts: value!.groundTruth.supportingFacts,
            });
            expect(fields(item)).toEqual(expected);
            expect(item!.id).toBe(id);
            const checkedIn = pilotSchema.parse(pilot).cases.find(entry => entry.id === id);
            expect(checkedIn).toBeDefined();
            expect(fields(checkedIn)).toEqual(expected);
            expect(checkedIn!.sourceRecords).toContainEqual({
                recordNumber,
                startLine: recordNumber,
            });
        }
    );
    it.each([0, -1, 1.5, 21, NaN])("rejects invalid pilot size %s", count => {
        expect(() => selectPilot(pilotSchema.parse(pilot).cases, count)).toThrow(/Pilot count/);
    });
    it("rejects repeated IDs in selection input instead of silently choosing them", () => {
        const first = pilotSchema.parse(pilot).cases[0]!;
        expect(() => selectPilot([first, first], 1)).toThrow(/Duplicate case IDs/);
    });
    it("rejects forged answers, annotation mixing, modified evidence and duplicate normalized IDs", () => {
        const first = structuredClone(pilot.cases[0]!);
        expect(
            benchmarkCaseSchema.safeParse({ ...first, referenceAnswer: "invented" }).success
        ).toBe(false);
        expect(
            benchmarkCaseSchema.safeParse({
                ...first,
                vantageAnnotations: { roleIds: ["founder"] },
            }).success
        ).toBe(false);
        expect(
            benchmarkCaseSchema.safeParse({
                ...first,
                groundTruth: { ...first.groundTruth, referenceAnswer: "invented" },
            }).success
        ).toBe(false);
        const changed = structuredClone(pilot);
        changed.cases[0]!.groundTruth.supportingFacts[0]!.text += " changed";
        expect(pilotSchema.safeParse(changed).success).toBe(false);
        const duplicated = structuredClone(pilot);
        duplicated.cases[1] = structuredClone(duplicated.cases[0]!);
        expect(pilotSchema.safeParse(duplicated).success).toBe(false);
    });
    it("rejects mismatched provenance and summary counts", () => {
        const badRevision = structuredClone(pilot);
        badRevision.provenance.revision = "0".repeat(40);
        expect(pilotSchema.safeParse(badRevision).success).toBe(false);
        const badCounts = structuredClone(pilot);
        badCounts.selection.count++;
        expect(pilotSchema.safeParse(badCounts).success).toBe(false);
        const badHistogram = structuredClone(pilot);
        badHistogram.selection.selectedEnterprises["ZX Bank"]++;
        expect(pilotSchema.safeParse(badHistogram).success).toBe(false);
    });
    it("ships the exact pinned MIT license and serializes the pilot reproducibly", () => {
        const notice = readFileSync(
            new URL(
                "../../../fixtures/vantage-benchmarks/rag-multi-corpus/LICENSE.upstream.txt",
                import.meta.url
            )
        );
        expect(sha256(notice)).toBe(sourceLock.files.license.sha256);
        expect(notice.toString()).toContain(sourceLock.license.copyright);
        const checkedIn = readFileSync(
            new URL(
                "../../../fixtures/vantage-benchmarks/rag-multi-corpus/pilot.json",
                import.meta.url
            ),
            "utf8"
        );
        expect(serializePilot(pilotSchema.parse(pilot))).toBe(checkedIn);
    });
});
