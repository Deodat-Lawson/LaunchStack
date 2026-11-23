/** Local-only assembly. Only genericPrompt's deliberately narrow DTO crosses the provider boundary. */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { BenchmarkMeterSnapshot } from "./vantage-benchmark-meter";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const anchorSchema = z
    .object({
        id,
        role: z.enum(["evidence", "distractor", "fixed"]),
        marker: z.string().regex(/^\[\[ANCHOR_[A-Za-z0-9_]+\]\]$/),
        positionFraction: z.number().min(0.3).max(0.8),
        text: z.string().min(20).max(3000),
    })
    .strict();
const documentSchema = z
    .object({
        id,
        kind: id,
        title: z.string().min(1).max(200),
        brief: z.string().min(1).max(1000),
        targetBytes: z.number().int().min(26000).max(34000),
        visibility: z.enum(["actor_readable", "denied"]),
        versions: z
            .array(
                z
                    .object({
                        id,
                        publishedAt: z.string().datetime({ offset: true }),
                        anchors: z.array(anchorSchema).max(12),
                    })
                    .strict()
            )
            .min(1)
            .max(5),
    })
    .strict();
// Cases remain local and are deliberately not part of the provider DTO.
export const specSchema = z
    .object({
        schemaVersion: z.enum(["long-decisions/spec-v1", "long-decisions/spec-v2"]),
        company: z
            .object({ id, name: z.string(), fictional: z.literal(true), domain: z.string() })
            .strict(),
        design: z.record(z.unknown()),
        weeks: z.array(z.object({ id, weekStart: z.string(), cutoff: z.string() }).strict()),
        actors: z.array(
            z
                .object({
                    id,
                    role: z.string(),
                    canRead: z.boolean(),
                    canMutate: z.boolean(),
                    readableDocumentIds: z.array(id),
                    deniedDocumentIds: z.array(id),
                })
                .strict()
        ),
        fixedSources: z.array(
            z
                .object({
                    anchorId: id,
                    documentId: id,
                    versionId: id,
                    purpose: z.string(),
                    required: z.boolean(),
                    scope: z.literal("anchor_text_only"),
                    sameAcrossArms: z.boolean(),
                })
                .strict()
        ),
        documents: z.array(documentSchema).min(1).max(200),
        cases: z.array(
            z
                .object({
                    id,
                    split: z.enum(["dev", "heldout"]),
                    question: z.string().min(1).max(400),
                })
                .passthrough()
        ),
        groups: z.array(
            z
                .object({
                    id,
                    split: z.enum(["dev", "heldout"]),
                    size: z.number().int().positive(),
                    weekId: id,
                    caseIds: z.array(id),
                })
                .strict()
        ),
    })
    .strict();
export type LongSpec = z.infer<typeof specSchema>;
export type LongDocument = LongSpec["documents"][number];
export type LongVersion = LongDocument["versions"][number];
export const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
export const SECTION_COUNT = 5;
export const MAX_ATTEMPTS = 2;
export const MAX_OUTPUT_TOKENS = 4000;
export const REPETITION_LIMIT = 0.08;
export function generationProfile(spec: Pick<LongSpec, "schemaVersion">) {
    return spec.schemaVersion === "long-decisions/spec-v2"
        ? {
              limitUsd: 5,
              maxOutputTokens: 2400,
              maxAttempts: 4,
              retryLimit: 350,
              concurrency: 5,
              dense: true,
          }
        : {
              limitUsd: 3,
              maxOutputTokens: MAX_OUTPUT_TOKENS,
              maxAttempts: MAX_ATTEMPTS,
              retryLimit: null,
              concurrency: 2,
              dense: false,
          };
}
const count = (text: string, needle: string) => text.split(needle).length - 1;
export type RecoveryAttempt = { file: string; promptSha256: string; expectedPromptSha256: string };
export function validateNoHttpRecovery(
    ledger: BenchmarkMeterSnapshot,
    attempts: RecoveryAttempt[],
    limitUsd = 3
) {
    const unknown = ledger.records.filter(
        row => row.status === "unknown" && !row.continuedAfterGenerationNoHttp
    );
    if (
        ledger.hold !== "usage_unresolved" ||
        !unknown.length ||
        unknown.length !== attempts.length ||
        new Set(attempts.map(a => a.file)).size !== attempts.length ||
        ledger.projectedTotalUsd > limitUsd ||
        ledger.limitUsd !== limitUsd ||
        ledger.records.some(row => row.status === "sent" || row.status === "reserved") ||
        attempts.some(
            a =>
                !(
                    limitUsd === 5
                        ? /^[A-Za-z0-9_-]+\.s[0-4]\.a[0-3]\.json\.started$/
                        : /^[A-Za-z0-9_-]+\.s[0-4]\.a[01]\.json\.started$/
                ).test(a.file) ||
                !/^[a-f0-9]{64}$/.test(a.promptSha256) ||
                a.promptSha256 !== a.expectedPromptSha256
        ) ||
        unknown.some(
            row =>
                row.route !== "digest" ||
                row.workId !== undefined ||
                row.httpStatus !== undefined ||
                row.failure !== "usage_unresolved" ||
                row.continuedAfterCaseDeadline === true ||
                row.continuedAfterTransportFailure === true ||
                row.continuedAfterGenerationNoHttp === true ||
                row.settledListRateUsd !== undefined ||
                row.inputTokens !== undefined ||
                row.outputTokens !== undefined ||
                !(row.projectedUsd > 0)
        )
    )
        throw Error("long_generation_recovery_denied");
    return {
        unknownRecordIds: unknown.map(row => row.id),
        attempts: attempts.map(({ file, promptSha256 }) => ({ file, promptSha256 })),
    };
}

/** Await all started work on failure; never dispatch another item after the first rejection. */
export async function runCanaryThenPool<T>(
    items: T[],
    run: (item: T) => Promise<void>,
    options: { canaryOnly?: boolean; concurrency: number; stop: () => void }
) {
    if (
        !items.length ||
        !Number.isInteger(options.concurrency) ||
        options.concurrency < 1 ||
        options.concurrency > 8
    )
        throw Error("long_generation_pool_invalid");
    await run(items[0]!);
    if (options.canaryOnly) return;
    let next = 1,
        failure: unknown,
        failed = false;
    await Promise.all(
        Array.from({ length: Math.min(options.concurrency, items.length - 1) }, async () => {
            while (!failed) {
                const index = next++;
                if (index >= items.length) return;
                try {
                    await run(items[index]!);
                } catch (error) {
                    if (!failed) {
                        failure = error;
                        failed = true;
                        options.stop();
                    }
                    return;
                }
            }
        })
    );
    if (failed) throw failure;
}

export function validateSpec(value: unknown): LongSpec {
    const spec = specSchema.parse(value);
    const identifiers = spec.documents.flatMap(d => [
        d.id,
        ...d.versions.flatMap(v => [v.id, ...v.anchors.map(a => a.id)]),
    ]);
    const anchors = spec.documents.flatMap(d => d.versions.flatMap(v => v.anchors));
    if (
        new Set(identifiers).size !== identifiers.length ||
        new Set(anchors.map(a => a.marker)).size !== anchors.length ||
        new Set(anchors.map(a => a.text)).size !== anchors.length
    )
        throw Error("long_generation_spec_identifiers_invalid");
    for (const document of spec.documents) {
        if (
            anchors.some(
                a =>
                    document.brief.includes(a.text) ||
                    exactSentences(a.text).some(
                        sentence =>
                            normalizedWording(document.title) === normalizedWording(sentence)
                    )
            ) ||
            spec.cases.some(
                c => normalizedWording(c.question) === normalizedWording(document.title)
            )
        )
            throw Error("long_generation_prompt_boundary_invalid");
    }
    for (const group of spec.groups) {
        if (
            group.caseIds.length !== group.size ||
            new Set(group.caseIds).size !== group.size ||
            !spec.weeks.some(w => w.id === group.weekId) ||
            group.caseIds.some(
                caseId => !spec.cases.some(c => c.id === caseId && c.split === group.split)
            )
        )
            throw Error("long_generation_group_invalid");
    }
    return spec;
}

/** No spec/version/anchor/case object is accepted: these are the ONLY provider-visible fields. */
export function genericPrompt(input: {
    opaqueId: string;
    kind: string;
    title: string;
    brief: string;
    section: number;
    targetBytes: number;
    attempt: number;
    dense?: boolean;
    recordDate?: string;
}) {
    const facets = [
        "operating workflow, responsibilities and coordination practices",
        "implementation details, interfaces and operational tradeoffs",
        "review observations, qualitative risks and mitigation process",
        "cross-team handoffs, exceptions and follow-up work",
        "validation practices, unresolved procedural questions and maintenance",
    ];
    return {
        system: input.dense
            ? "Write substantive internal administrative records for a fictional freight company. Return only a JSON array of exactly 15 coherent, independent entries. Each entry is a 9-string tuple [eventDate, fullName, decisionVerb, decisionClause, numericQuantity, unit, quantityObservation, followupDate, followupObservation]. Dates must be real YYYY-MM-DD calendar dates on or before recordDate; vary dates across the available period. Use at least 3 distinct dates and 2 fictional full names. decisionVerb must be approved, rejected, retained, deferred, authorized, adopted, cancelled, accepted or denied. numericQuantity must use decimal digits and unit must be a concrete count or measurement, never an identifier. Each clause or observation must be original fluent prose of approximately 100 to 125 characters without sentence-ending punctuation. decisionClause is a direct object phrase after the decision verb. quantityObservation and followupObservation are full independent clauses. Each entry must describe one coherent supporting administrative event, its actual quantity and a meaningful follow-up. Invent all facts independently. Vary syntax, nouns, amounts and dates. Use support, maintenance, purchasing, training, recordkeeping and scheduling work around the named subject; do not decide the main project's outcome or determining metric. Do not mention benchmarks, labels, questions, anchors, retrieval or generation. No tools, headings or commentary."
            : "Write original, plausible internal prose for a fictional business workspace. Generate substantive varied English paragraphs, not filler, repeated templates, lorem ipsum, summaries or a list of headings. Do not mention benchmarks, retrieval, questions, evidence, anchors or generation. No external tools. No numeric business results, measurements, dates, approval decisions or named customer claims; use qualitative process detail. Do not invent a final decision. Every paragraph must contribute a different concrete operational detail. Return only Markdown prose.",
        user: JSON.stringify({
            layoutId: input.opaqueId,
            kind: input.kind,
            title: input.title,
            genericBrief: input.brief,
            ...(input.dense ? { recordDate: input.recordDate } : {}),
            section: input.section + 1,
            focus: facets[input.section],
            targetUtf8Bytes: input.targetBytes,
            instruction: input.dense
                ? `Return exactly 15 JSON tuples and no other text. The three prose clauses in each tuple should average approximately ${Math.round((input.targetBytes / 15 - 100) / 3)} characters each so the rendered section is near ${input.targetBytes} UTF-8 bytes. Put quantitative facts only in numericQuantity and dates only in the date fields. Follow-up observations must be substantive verbal context without numbers. ${input.attempt ? "A prior mechanical length, schema or density check failed; obey all tuple and length constraints using varied new prose." : ""}`
                : `Write approximately ${Math.round(input.targetBytes / 6)} words, with ${Math.round(input.targetBytes / 600)} substantial paragraphs. This is an independent section; avoid a global introduction or conclusion. ${input.attempt ? "Prior section failed mechanical length or variation checks; obey the requested length and use new varied prose." : ""}`,
        }),
    };
}
const administrationEntry = z.tuple([
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    z.string().regex(/^[A-Z][a-z]+(?: [A-Z][a-z]+){1,2}$/),
    z.enum([
        "approved",
        "rejected",
        "retained",
        "deferred",
        "authorized",
        "adopted",
        "cancelled",
        "accepted",
        "denied",
    ]),
    z.string().trim().min(35).max(240),
    z.string().regex(/^\d{1,5}(?:\.\d{1,2})?$/),
    z.string().trim().min(2).max(40),
    z.string().trim().min(35).max(240),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    z.string().trim().min(35).max(240),
]);
/** Render only provider-created facts; sentence placement never invents a date or quantity. */
export function renderAdministrativeEntries(
    raw: string,
    recordDate: string,
    options: { allowScheduledFollowups?: boolean } = {}
) {
    const json = raw.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1");
    const entries = z.array(administrationEntry).length(15).parse(JSON.parse(json));
    const validDate = (date: string) =>
        !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
    return entries
        .map(
            (
                [
                    date,
                    name,
                    decision,
                    rawDetail,
                    quantity,
                    unit,
                    rawObservation,
                    followupDate,
                    rawFollowup,
                ],
                index
            ) => {
                const trimPunctuation = (clause: string) => clause.trim().replace(/[.!?]+$/, "");
                const detail = trimPunctuation(rawDetail),
                    observation = trimPunctuation(rawObservation),
                    followup = trimPunctuation(rawFollowup);
                if (
                    !validDate(date) ||
                    date > recordDate.slice(0, 10) ||
                    !validDate(followupDate) ||
                    (!options.allowScheduledFollowups && followupDate > recordDate.slice(0, 10)) ||
                    followupDate < date ||
                    [detail, observation, followup].some(clause => /[.!?;]/.test(clause)) ||
                    /[.!?;\d]/.test(unit) ||
                    /\d/.test(followup)
                )
                    throw Error("long_generation_administration_invalid");
                const lower = (value: string) => value[0]!.toLowerCase() + value.slice(1);
                const upper = (value: string) => value[0]!.toUpperCase() + value.slice(1);
                const first =
                    index % 3 === 0
                        ? `On ${date}, ${name} ${decision} ${detail}.`
                        : index % 3 === 1
                          ? `${name} ${decision} ${detail} on ${date}.`
                          : `As recorded on ${date}, ${name} ${decision} ${detail}.`;
                const second =
                    index % 3 === 0
                        ? `${upper(observation)}, covering ${quantity} ${unit}.`
                        : index % 3 === 1
                          ? `${quantity} ${unit} formed the recorded allocation, while ${lower(observation)}.`
                          : `For the ${quantity} ${unit}, ${lower(observation)}.`;
                const third =
                    followupDate > recordDate.slice(0, 10)
                        ? `A review scheduled for ${followupDate} will check whether ${lower(followup)}.`
                        : index % 3 === 2
                          ? `${upper(followup)}.`
                          : index % 2 === 0
                            ? `At the follow-up dated ${followupDate}, ${lower(followup)}.`
                            : `${upper(followup)} at the review on ${followupDate}.`;
                return [first, second, third].join(" ");
            }
        )
        .join("\n\n");
}
export function administrativeRenderOptions(
    policy:
        | {
              strictVersions: readonly { versionId: string }[];
              strictPrefixes?: readonly { versionId: string; beforeSection: number }[];
          }
        | undefined,
    versionId: string,
    section: number
) {
    if (!Number.isSafeInteger(section) || section < 0 || section >= SECTION_COUNT)
        throw Error("long_generation_render_policy_invalid");
    const beforeSection =
        policy?.strictPrefixes?.find(prefix => prefix.versionId === versionId)?.beforeSection ?? 0;
    return {
        allowScheduledFollowups:
            policy !== undefined &&
            !policy.strictVersions.some(version => version.versionId === versionId) &&
            section >= beforeSection,
    };
}
export function sectionTarget(
    document: LongDocument,
    version: LongVersion,
    completed: string[] = []
) {
    const anchorBytes = version.anchors.reduce((n, a) => n + Buffer.byteLength(a.text) + 4, 0);
    const available = 30000 - anchorBytes - Buffer.byteLength(document.title) - 30;
    return completed.length === SECTION_COUNT - 1
        ? available -
              completed.reduce((n, text) => n + Buffer.byteLength(text), 0) -
              2 * completed.length
        : Math.floor(available / SECTION_COUNT);
}
export function generationBody(
    prompt: ReturnType<typeof genericPrompt>,
    model: string,
    maxOutputTokens = MAX_OUTPUT_TOKENS
) {
    return JSON.stringify({
        model,
        reasoning_effort: "none",
        max_completion_tokens: maxOutputTokens,
        store: false,
        messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
        ],
    });
}
export function generationProjection(
    spec: LongSpec,
    model: string,
    ratesPerMillion: { input: number; output: number }
) {
    const profile = generationProfile(spec);
    let requests = 0,
        inputTokenCeiling = 0,
        largestRetryInput = 0;
    for (const document of spec.documents)
        for (const version of document.versions)
            for (let section = 0; section < SECTION_COUNT; section++)
                for (let attempt = 0; attempt < (profile.dense ? 1 : MAX_ATTEMPTS); attempt++) {
                    const prompt = genericPrompt({
                        opaqueId: sha256(version.id).slice(0, 16),
                        kind: document.kind,
                        title: document.title,
                        brief: document.brief,
                        section,
                        targetBytes: sectionTarget(document, version),
                        attempt,
                        dense: profile.dense,
                        recordDate: version.publishedAt,
                    });
                    const ceiling =
                        Buffer.byteLength(generationBody(prompt, model, profile.maxOutputTokens)) +
                        1024 +
                        256 * 2 +
                        256;
                    inputTokenCeiling += ceiling;
                    largestRetryInput = Math.max(largestRetryInput, ceiling + 256);
                    requests++;
                }
    if (profile.retryLimit !== null) {
        inputTokenCeiling += profile.retryLimit * largestRetryInput;
        requests += profile.retryLimit;
    }
    const outputTokenCeiling = requests * profile.maxOutputTokens;
    return {
        maximumRequests: requests,
        inputTokenCeiling,
        outputTokenCeiling,
        worstCaseUsd:
            Math.ceil(
                (inputTokenCeiling * ratesPerMillion.input +
                    outputTokenCeiling * ratesPerMillion.output) *
                    1000
            ) / 1e9,
        basis: profile.dense
            ? "One request per section plus 350 globally bounded retries; request UTF-8 bytes plus protocol framing bound input tokens; all responses use the full 2400-token output allowance; upper Azure list rates without cache discounts"
            : "Every section uses both attempts; serialized UTF-8 request bytes plus protocol framing upper-bound input tokens; every response uses 4000 output tokens; upper Azure list rates, no cache discount",
    };
}

export function repetition(text: string) {
    const sentences = exactSentences(text)
        .map(s =>
            s
                .toLowerCase()
                .replace(/[^\p{L}\p{N}]+/gu, " ")
                .trim()
        )
        .filter(s => s.length >= 30);
    const repeated = sentences.length - new Set(sentences).size;
    return {
        sentences: sentences.length,
        repeatedSentences: repeated,
        repeatedSentenceRate: sentences.length ? repeated / sentences.length : 0,
    };
}
export function exactSentences(text: string) {
    return [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(text)]
        .map(item => item.segment.trim())
        .filter(Boolean);
}
/** Numeric/date density is a declared lexical proxy, independent of answer labels. */
export function renderedQuantityCount(text: string) {
    const amount = String.raw`\d+(?:[.,]\d+)*`;
    const unit = String.raw`[\p{L}][\p{L}\p{M} '\-/()]{1,39}`;
    const frames = [
        new RegExp(String.raw`, covering ${amount} ${unit}\.(?=\s|$)`, "gu"),
        new RegExp(
            String.raw`(?:^|[.!?]\s+)${amount} ${unit} formed the recorded allocation, while `,
            "gu"
        ),
        new RegExp(String.raw`\bFor the ${amount} ${unit}, `, "gu"),
    ];
    return frames.reduce((count, frame) => count + [...text.matchAll(frame)].length, 0);
}
export function proseSpecificity(text: string) {
    const body = text
        .split(/\r?\n/)
        .filter(line => !/^\s*#|\[\[ANCHOR_/.test(line))
        .join("\n");
    const dates = (value: string) =>
        [...value.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)]
            .map(match => match[0])
            .filter(
                value =>
                    !Number.isNaN(Date.parse(value)) &&
                    new Date(value).toISOString().slice(0, 10) === value
            );
    const quantities = (value: string) =>
        value
            .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
            .match(/(?<![\p{L}\p{N}_-])\d+(?:[.,]\d+)*(?![\p{L}\p{N}_])/gu) ?? [];
    const sentences = exactSentences(body);
    const numericSentences = sentences.filter(sentence => quantities(sentence).length > 0).length;
    const dateSentences = sentences.filter(sentence => dates(sentence).length > 0).length;
    const numericOrDateSentences = sentences.filter(
        sentence => quantities(sentence).length || dates(sentence).length
    ).length;
    const unitQuantities =
        body
            .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
            .match(
                /(?<![\p{L}\p{N}_-])\d+(?:[.,]\d+)*(?:\s+|-)(?:[A-Za-z-]+\s+){0,2}(?:percent|dollars?|pounds?|euros?|hours?|days?|minutes?|seconds?|months?|years?|consignments?|pairs?|loads?|records?|facilities|units?|crates?|vehicles?|batches?|kilograms?|operators?|movements?|legs?|accounts?|depots?|appointments?|requests?|cycles?|positions?|identities|reviews?|windows?|riders?|checks?|timetables?|agreements?|notices?|drafts?|machines?|events?|cases?|journeys|proposals?|clauses?|schedules?|shifts?|carriers?|sites?|people|members|sensors?|certificates?|transfers?|invoices?|periods?|approvals?|teams?|jobs?|chairs?|trays?|cabinets?|desks?|devices?|sessions?|items?|boxes?|labels?|forms?|metres?|meters?|kilometres?|kilometers?|litres?|liters?|pages?|panels?|batteries|kits?|seats?|folders?|sheets?|deliveries|courses?|participants?)\b/giu
            ) ?? [];
    return {
        sentences: sentences.length,
        numericSentences,
        dateSentences,
        numericOrDateSentences,
        share: sentences.length ? numericOrDateSentences / sentences.length : 0,
        distinctDates: new Set(dates(body)).size,
        quantities: quantities(body).length,
        quantitiesWithUnits: unitQuantities.length,
        renderedQuantities: renderedQuantityCount(body),
        namedPeople: new Set(body.match(/\b[A-Z][a-z]{1,}\s+[A-Z][a-z]{1,}\b/g) ?? []).size,
        decisionSentences: sentences.filter(sentence =>
            /\b(?:approved|rejected|retained|deferred|authorized|decided|declined|adopted|cancelled|accepted|denied|confirmed)\b/i.test(
                sentence
            )
        ).length,
    };
}
export function validateDenseSection(
    text: string,
    options: { explicitStructuredQuantities?: boolean } = {}
) {
    const density = proseSpecificity(text);
    const quantityCount = options.explicitStructuredQuantities
        ? density.renderedQuantities
        : density.quantitiesWithUnits;
    if (
        density.share < 0.85 ||
        density.distinctDates < 3 ||
        quantityCount < 4 ||
        density.namedPeople < 2 ||
        density.decisionSentences < 2
    )
        throw Error("long_generation_section_density_invalid");
    return {
        ...density,
        validatedQuantityCount: quantityCount,
        quantityCounter: options.explicitStructuredQuantities
            ? "rendered-quantity-clauses/1"
            : "lexical-units/1",
    };
}
export const normalizedWording = (text: string) =>
    text
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
/** Private spec validation only; no source wording appears in the returned numeric summary. */
export function validateVersionLabels(spec: LongSpec, versionId: string, text: string) {
    const normalizedText = " " + normalizedWording(text) + " ";
    const occurrences = (needle: string) =>
        count(normalizedText, " " + normalizedWording(needle) + " ");
    const ownership = new Map<string, Set<string>>();
    const blocks = spec.documents.flatMap(d =>
        d.versions.flatMap(v => v.anchors.map(a => ({ versionId: v.id, text: a.text })))
    );
    for (const block of blocks)
        for (const sentence of exactSentences(block.text)) {
            const owners = ownership.get(sentence) ?? new Set<string>();
            owners.add(block.versionId);
            ownership.set(sentence, owners);
        }
    for (const [sentence, owners] of ownership) {
        const expected = owners.has(versionId) ? 1 : 0;
        if (count(text, sentence) !== expected || occurrences(sentence) !== expected)
            throw Error("long_generation_sentence_label_leak");
    }
    for (const block of blocks)
        if (occurrences(block.text) !== (block.versionId === versionId ? 1 : 0))
            throw Error("long_generation_normalized_answer_leak");
    for (const item of spec.cases)
        if (count(text, item.question) || occurrences(item.question))
            throw Error("long_generation_question_leak");
    return {
        checkedSentences: ownership.size,
        checkedBlocks: blocks.length,
        checkedQuestions: spec.cases.length,
        exactSentenceFailures: 0,
        normalizedWordingFailures: 0,
    };
}
export function corpusValidationSummary(spec: LongSpec, versions: Map<string, Assembled>) {
    const values = spec.documents.flatMap(d =>
        d.versions.map(v => ({ version: v, assembled: versions.get(v.id) }))
    );
    if (values.some(v => !v.assembled)) throw Error("long_generation_version_missing");
    for (const value of values)
        validateVersionLabels(spec, value.version.id, value.assembled!.text);
    const global = repetition(values.map(v => v.assembled!.text).join("\n\n"));
    if (global.repeatedSentenceRate > REPETITION_LIMIT)
        throw Error("long_generation_global_repetition_invalid");
    let specificity: ReturnType<typeof corpusSpecificity> | undefined;
    if (generationProfile(spec).dense) specificity = corpusSpecificity(spec, versions);
    return {
        schemaVersion: generationProfile(spec).dense
            ? "long-decisions-validation/2"
            : "long-decisions-validation/1",
        documents: spec.documents.length,
        versions: values.length,
        anchorPositionUnit: "UTF-8 bytes",
        scopeOffsetUnit: "UTF-16 half-open",
        minBytes: Math.min(...values.map(v => v.assembled!.bytes)),
        maxBytes: Math.max(...values.map(v => v.assembled!.bytes)),
        anchors: values.reduce((n, v) => n + v.version.anchors.length, 0),
        labelLeakFailures: 0,
        global,
        maxVersionRepeatedSentenceRate: Math.max(
            ...values.map(v => v.assembled!.repeatedSentenceRate)
        ),
        repetitionLimit: REPETITION_LIMIT,
        ...(specificity ? { specificity } : {}),
    };
}
function corpusSpecificity(spec: LongSpec, versions: Map<string, Assembled>) {
    const anchors = spec.documents.flatMap(document =>
        document.versions.flatMap(version =>
            version.anchors.map(anchor => ({
                ...anchor,
                kind: document.kind,
                versionId: version.id,
            }))
        )
    );
    const aggregate = (texts: string[]) => proseSpecificity(texts.join("\n\n"));
    const evidence = aggregate(
        anchors.filter(anchor => anchor.role === "evidence").map(anchor => anchor.text)
    );
    const distractors = aggregate(
        anchors.filter(anchor => anchor.role === "distractor").map(anchor => anchor.text)
    );
    const fillerTexts = [...versions.values()].map(version => version.fillerText);
    const filler = aggregate(fillerTexts);
    const maxGap = Number(
        (spec.design.filler as { maxAbsoluteLabelFillerNumericDateShareGap?: number } | undefined)
            ?.maxAbsoluteLabelFillerNumericDateShareGap ?? 0.15
    );
    if ([evidence, distractors].some(role => Math.abs(role.share - filler.share) > maxGap + 1e-12))
        throw Error("long_generation_corpus_density_gap_invalid");
    const byKind = [...new Set(spec.documents.map(document => document.kind))].map(kind => ({
        kind,
        filler: aggregate(
            spec.documents
                .filter(document => document.kind === kind)
                .flatMap(document =>
                    document.versions.map(version => versions.get(version.id)!.fillerText)
                )
        ),
        evidence: aggregate(
            anchors
                .filter(anchor => anchor.kind === kind && anchor.role === "evidence")
                .map(anchor => anchor.text)
        ),
        distractors: aggregate(
            anchors
                .filter(anchor => anchor.kind === kind && anchor.role === "distractor")
                .map(anchor => anchor.text)
        ),
    }));
    return {
        evidence,
        distractors,
        filler,
        maxAbsoluteGap: maxGap,
        byKind,
        proxyLimit:
            "Sentence presence of numbers and dates measures one lexical cue; names and decisions use mechanical proxies requiring representative human review.",
    };
}
export function validateSection(text: string, targetBytes: number) {
    const bytes = Buffer.byteLength(text);
    if (
        bytes < targetBytes * 0.85 ||
        bytes > targetBytes * 1.15 ||
        /\[\[ANCHOR_|lorem ipsum/i.test(text) ||
        repetition(text).repeatedSentenceRate > REPETITION_LIMIT ||
        repetition(text).sentences < 12
    )
        throw Error("long_generation_section_invalid");
}
/** Preserve the generated checkpoint verbatim. Select only its longest complete-paragraph prefix. */
export function fitSectionParagraphs(original: string, targetBytes: number): string {
    const maximum = targetBytes * 1.15;
    let fitted = original;
    if (Buffer.byteLength(original) > maximum) {
        const boundaries = [...original.matchAll(/\r?\n[\t ]*\r?\n/g)].map(match => match.index);
        fitted = "";
        for (const boundary of boundaries) {
            const candidate = original.slice(0, boundary).trimEnd();
            if (Buffer.byteLength(candidate) > maximum) break;
            // A heading or unfinished paragraph must not become the end of a fitted section.
            if (/[.!?]["'”’\])]*$/.test(candidate)) fitted = candidate;
        }
    }
    validateSection(fitted, targetBytes);
    return fitted;
}
export type Assembled = ReturnType<typeof assembleVersion>;
export function assembleVersion(
    document: LongDocument,
    version: LongVersion,
    sections: string[],
    allAnchors: { id: string; marker: string; text: string }[]
) {
    if (sections.length !== SECTION_COUNT) throw Error("long_generation_sections_missing");
    const body = `# ${document.title}\n\n${sections.join("\n\n").trim()}\n`;
    if (
        allAnchors.some(a => body.includes(a.text) || body.includes(a.marker)) ||
        body.includes("[[ANCHOR_")
    )
        throw Error("long_generation_prose_anchor_leak");
    const placements = version.anchors
        .map(anchor => {
            const bodyBytes = Buffer.byteLength(body),
                target = Math.floor(bodyBytes * anchor.positionFraction);
            const boundaries = [...body.matchAll(/\n\n/g)].map(match => ({
                offset: match.index,
                bytes: Buffer.byteLength(body.slice(0, match.index)),
            }));
            boundaries.sort(
                (a, b) =>
                    Math.abs(a.bytes - target) - Math.abs(b.bytes - target) || a.offset - b.offset
            );
            const best = boundaries[0],
                offset = best?.offset ?? -1;
            if (!best || Math.abs(best.bytes - target) > bodyBytes * 0.04)
                throw Error("long_generation_layout_invalid");
            return { anchor, offset };
        })
        .sort((a, b) => a.offset - b.offset || a.anchor.id.localeCompare(b.anchor.id));
    let marked = body;
    for (const placement of [...placements].reverse())
        marked =
            marked.slice(0, placement.offset) +
            `\n\n${placement.anchor.marker}\n\n` +
            marked.slice(placement.offset);
    let text = marked;
    for (const { anchor } of placements) {
        if (count(text, anchor.marker) !== 1) throw Error("long_generation_marker_invalid");
        text = text.replace(anchor.marker, anchor.text);
    }
    const bytes = Buffer.byteLength(text);
    const metrics = repetition(text);
    if (bytes < 25000 || bytes > 35000 || metrics.repeatedSentenceRate > REPETITION_LIMIT)
        throw Error("long_generation_document_invalid");
    for (const anchor of allAnchors) {
        if (
            count(text, anchor.text) !== (version.anchors.some(a => a.id === anchor.id) ? 1 : 0) ||
            text.includes(anchor.marker)
        )
            throw Error("long_generation_cross_version_leak");
    }
    const anchors = placements.map(({ anchor }) => {
        const start = text.indexOf(anchor.text),
            end = start + anchor.text.length;
        const byteStart = Buffer.byteLength(text.slice(0, start)),
            byteEnd = Buffer.byteLength(text.slice(0, end));
        if (byteStart / bytes < 0.3 || byteEnd / bytes > 0.8)
            throw Error("long_generation_anchor_position_invalid");
        return {
            id: anchor.id,
            start,
            end,
            byteStart,
            byteEnd,
            fraction: byteStart / bytes,
            sha256: sha256(anchor.text),
        };
    });
    return {
        text,
        bytes,
        sha256: sha256(text),
        anchors,
        fillerText: sections.join("\n\n"),
        ...metrics,
    };
}

export function publicManifest(
    spec: LongSpec,
    specSha256: string,
    versions: Map<string, Assembled>
) {
    return {
        schemaVersion: generationProfile(spec).dense
            ? "vantage-long-decisions-input/2"
            : "vantage-long-decisions-input/1",
        specSha256,
        company: spec.company,
        weeks: spec.weeks,
        actors: spec.actors,
        fixedSources: spec.fixedSources.map(fixed => {
            const version = versions.get(fixed.versionId),
                anchor = version?.anchors.find(a => a.id === fixed.anchorId);
            if (!version || !anchor) throw Error("long_generation_fixed_source_missing");
            const length = Math.max(200, anchor.end - anchor.start);
            const textStart = Math.max(
                0,
                Math.min(
                    anchor.start - Math.floor((length - (anchor.end - anchor.start)) / 2),
                    version.text.length - length
                )
            );
            const textEnd = textStart + length;
            const publicFixed = {
                documentId: fixed.documentId,
                versionId: fixed.versionId,
                purpose: fixed.purpose,
                required: fixed.required,
                scope: fixed.scope,
                sameAcrossArms: fixed.sameAcrossArms,
            };
            if (length > 6000) throw Error("long_generation_fixed_source_invalid");
            return {
                ...publicFixed,
                scopeId:
                    "fixed-" +
                    sha256(`${fixed.documentId}/${fixed.versionId}/${fixed.purpose}`).slice(0, 16),
                textStart,
                textEnd,
                textSha256: sha256(version.text.slice(textStart, textEnd)),
                canonicalTextSha256: version.sha256,
            };
        }),
        documents: spec.documents.map(document => ({
            id: document.id,
            kind: document.kind,
            title: document.title,
            visibility: document.visibility,
            versions: document.versions.map(version => {
                const assembled = versions.get(version.id);
                if (!assembled) throw Error("long_generation_version_missing");
                return {
                    id: version.id,
                    publishedAt: version.publishedAt,
                    file: `${version.id}.md`,
                    sha256: assembled.sha256,
                    bytes: assembled.bytes,
                };
            }),
        })),
        groups: spec.groups.map(group => ({
            id: group.id,
            split: group.split,
            size: group.size,
            weekId: group.weekId,
            topics: group.caseIds.map(caseId => ({
                caseId,
                question: spec.cases.find(c => c.id === caseId)!.question,
            })),
        })),
    };
}
