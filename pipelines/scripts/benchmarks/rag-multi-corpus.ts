import { createHash } from "node:crypto";
import { z } from "zod";
import sourceLock from "../../../fixtures/vantage-benchmarks/rag-multi-corpus/source-lock.json";
import { parseCsv } from "./csv";

export { sourceLock };
export const sha256 = (value: string | Uint8Array) =>
    createHash("sha256").update(value).digest("hex");
const nonempty = z.string().refine(value => value.trim().length > 0, "Must contain text");
const factSchema = z.object({ filename: nonempty, text: nonempty }).strict();
const factsSchema = z.array(factSchema).min(1);
const locationSchema = z
    .object({ recordNumber: z.number().int().min(2), startLine: z.number().int().min(2) })
    .strict();

export const benchmarkCaseSchema = z
    .object({
        id: z.string().regex(/^rag-multi-corpus:[a-f0-9]{64}$/),
        enterprise: nonempty,
        queryType: nonempty,
        question: nonempty,
        groundTruth: z
            .object({
                kind: z.literal("supporting-facts"),
                referenceAnswer: z.null(),
                supportingFacts: factsSchema,
            })
            .strict(),
        sourceRecords: z.array(locationSchema).min(1),
        vantageAnnotations: z.null(),
    })
    .strict();
export type BenchmarkCase = z.infer<typeof benchmarkCaseSchema>;

type Identity = Pick<BenchmarkCase, "enterprise" | "queryType" | "question" | "groundTruth">;
function identityText(item: Identity): string {
    return JSON.stringify([
        "rag-multi-corpus-case-v1",
        item.enterprise,
        item.queryType,
        item.question,
        item.groundTruth.supportingFacts.map(fact => [fact.filename, fact.text]),
    ]);
}
export const caseId = (item: Identity) => `rag-multi-corpus:${sha256(identityText(item))}`;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** No network or runtime dependencies. Invalid rows abort; duplicates require an explicit policy. */
export function normalizeCsv(
    text: string,
    duplicatePolicy: "reject" | "merge-identical" = "reject"
) {
    const records = parseCsv(text);
    const headers = ["Enterprise Name", "Query Type", "Query", "Supporting Facts"];
    const header = records.shift();
    if (
        !header ||
        header.cells.length !== headers.length ||
        new Set(header.cells).size !== headers.length ||
        headers.some(name => !header.cells.includes(name))
    )
        throw new Error(
            "CSV must contain exactly Enterprise Name, Query Type, Query, Supporting Facts headers."
        );
    if (!records.length) throw new Error("CSV contains no data records.");
    const columns = headers.map(name => header.cells.indexOf(name));
    const unique = new Map<string, BenchmarkCase>();
    let duplicateRows = 0;
    for (const record of records) {
        const prefix = `Record ${record.recordNumber} (line ${record.startLine})`;
        if (record.cells.length !== headers.length)
            throw new Error(`${prefix}: expected four fields.`);
        const values = columns.map(index => record.cells[index]!);
        let facts: unknown;
        try {
            facts = JSON.parse(values[3]!);
        } catch {
            throw new Error(`${prefix}: Supporting Facts is not valid JSON.`);
        }
        const parsedFacts = factsSchema.safeParse(facts);
        if (!parsedFacts.success)
            throw new Error(
                `${prefix}: Supporting Facts must be a nonempty array of exactly {filename, text} strings.`
            );
        const identity: Identity = {
            enterprise: values[0]!,
            queryType: values[1]!,
            question: values[2]!,
            groundTruth: {
                kind: "supporting-facts",
                referenceAnswer: null,
                supportingFacts: parsedFacts.data,
            },
        };
        const item = benchmarkCaseSchema.safeParse({
            id: caseId(identity),
            ...identity,
            sourceRecords: [{ recordNumber: record.recordNumber, startLine: record.startLine }],
            vantageAnnotations: null,
        });
        if (!item.success)
            throw new Error(`${prefix}: empty or invalid enterprise, query type, or question.`);
        const previous = unique.get(item.data.id);
        if (previous) {
            if (identityText(previous) !== identityText(item.data))
                throw new Error(`${prefix}: case ID collision.`);
            if (duplicatePolicy === "reject")
                throw new Error(
                    `${prefix}: duplicate case ID; first seen at record ${previous.sourceRecords[0]!.recordNumber}. Use merge-identical explicitly to retain both locations.`
                );
            previous.sourceRecords.push(...item.data.sourceRecords);
            duplicateRows++;
        } else unique.set(item.data.id, item.data);
    }
    return {
        cases: [...unique.values()].sort((a, b) => compare(a.id, b.id)),
        sourceRows: records.length,
        duplicateRows,
    };
}

/** Coverage first, then balance enterprises, categories, and pairs; full SHA IDs break ties. */
export function selectPilot(cases: readonly BenchmarkCase[], count = 20): BenchmarkCase[] {
    if (!Number.isSafeInteger(count) || count < 1 || count > cases.length)
        throw new Error(`Pilot count must be an integer from 1 to ${cases.length}.`);
    const remaining = [...cases];
    if (new Set(remaining.map(item => item.id)).size !== remaining.length)
        throw new Error("Duplicate case IDs in selection input.");
    const enterprises = new Map<string, number>();
    const categories = new Map<string, number>();
    const pairs = new Map<string, number>();
    const selected: BenchmarkCase[] = [];
    const pair = (item: BenchmarkCase) => JSON.stringify([item.enterprise, item.queryType]);
    const score = (item: BenchmarkCase) => {
        const enterprise = enterprises.get(item.enterprise) ?? 0;
        const category = categories.get(item.queryType) ?? 0;
        return [
            Number(enterprise === 0) + Number(category === 0),
            -enterprise,
            -category,
            -(pairs.get(pair(item)) ?? 0),
        ];
    };
    while (selected.length < count) {
        remaining.sort((a, b) => {
            const left = score(a),
                right = score(b);
            for (let i = 0; i < left.length; i++)
                if (left[i] !== right[i]) return right[i]! - left[i]!;
            return compare(a.id, b.id);
        });
        const item = remaining.shift()!;
        selected.push(item);
        enterprises.set(item.enterprise, (enterprises.get(item.enterprise) ?? 0) + 1);
        categories.set(item.queryType, (categories.get(item.queryType) ?? 0) + 1);
        pairs.set(pair(item), (pairs.get(pair(item)) ?? 0) + 1);
    }
    return selected;
}

const countsSchema = z.record(z.number().int().nonnegative());
export const pilotSchema = z
    .object({
        schemaVersion: z.literal("vantage-external-benchmark-v1"),
        provenance: z
            .object({
                datasetId: z.literal("rag-multi-corpus"),
                repository: z.literal(sourceLock.repository),
                revision: z.literal(sourceLock.revision),
                sourcePath: z.literal(sourceLock.files.queries.path),
                sourceSha256: z.literal(sourceLock.files.queries.sha256),
                license: z
                    .object({
                        spdxId: z.literal("MIT"),
                        url: z.literal(sourceLock.files.license.url),
                        sha256: z.literal(sourceLock.files.license.sha256),
                        noticeFile: z.literal(sourceLock.license.noticeFile),
                    })
                    .strict(),
                citation: z.literal(sourceLock.citation),
            })
            .strict(),
        selection: z
            .object({
                algorithm: z.literal("coverage-balanced-sha256-v1"),
                duplicatePolicy: z.enum(["reject", "merge-identical"]),
                sourceRows: z.number().int().positive(),
                uniqueCases: z.number().int().positive(),
                duplicateRows: z.number().int().nonnegative(),
                count: z.number().int().positive(),
                availableEnterprises: countsSchema,
                availableQueryTypes: countsSchema,
                selectedEnterprises: countsSchema,
                selectedQueryTypes: countsSchema,
            })
            .strict(),
        cases: z.array(benchmarkCaseSchema).min(1),
    })
    .strict()
    .superRefine((bundle, ctx) => {
        if (
            bundle.selection.count !== bundle.cases.length ||
            bundle.selection.sourceRows !==
                bundle.selection.uniqueCases + bundle.selection.duplicateRows ||
            bundle.selection.uniqueCases < bundle.cases.length
        )
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Inconsistent selection counts" });
        if (new Set(bundle.cases.map(item => item.id)).size !== bundle.cases.length)
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate case IDs" });
        for (const item of bundle.cases)
            if (caseId(item) !== item.id)
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "Case ID does not match preserved content",
                });
        for (const [field, counts] of [
            ["enterprise", bundle.selection.selectedEnterprises],
            ["queryType", bundle.selection.selectedQueryTypes],
        ] as const)
            if (
                JSON.stringify(histogram(bundle.cases, field)) !==
                JSON.stringify(
                    Object.fromEntries(Object.entries(counts).sort(([a], [b]) => compare(a, b)))
                )
            )
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `Incorrect selected ${field} counts`,
                });
    });

export function histogram(cases: readonly BenchmarkCase[], field: "enterprise" | "queryType") {
    const counts = new Map<string, number>();
    for (const item of cases) counts.set(item[field], (counts.get(item[field]) ?? 0) + 1);
    return Object.fromEntries([...counts].sort(([a], [b]) => compare(a, b)));
}

export function importPinnedCsv(
    bytes: Uint8Array,
    count = 20,
    duplicatePolicy: "reject" | "merge-identical" = "reject"
) {
    if (sha256(bytes) !== sourceLock.files.queries.sha256)
        throw new Error(
            "Source SHA-256 mismatch. Download the pinned CSV; do not relabel modified data as upstream ground truth."
        );
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const imported = normalizeCsv(text, duplicatePolicy);
    const selected = selectPilot(imported.cases, count);
    return pilotSchema.parse({
        schemaVersion: "vantage-external-benchmark-v1",
        provenance: {
            datasetId: sourceLock.datasetId,
            repository: sourceLock.repository,
            revision: sourceLock.revision,
            sourcePath: sourceLock.files.queries.path,
            sourceSha256: sourceLock.files.queries.sha256,
            license: {
                spdxId: sourceLock.license.spdxId,
                url: sourceLock.files.license.url,
                sha256: sourceLock.files.license.sha256,
                noticeFile: sourceLock.license.noticeFile,
            },
            citation: sourceLock.citation,
        },
        selection: {
            algorithm: "coverage-balanced-sha256-v1",
            duplicatePolicy,
            sourceRows: imported.sourceRows,
            uniqueCases: imported.cases.length,
            duplicateRows: imported.duplicateRows,
            count,
            availableEnterprises: histogram(imported.cases, "enterprise"),
            availableQueryTypes: histogram(imported.cases, "queryType"),
            selectedEnterprises: histogram(selected, "enterprise"),
            selectedQueryTypes: histogram(selected, "queryType"),
        },
        cases: selected,
    });
}

export const serializePilot = (pilot: z.infer<typeof pilotSchema>) =>
    JSON.stringify(pilotSchema.parse(pilot), null, 2) + "\n";
