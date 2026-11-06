/** Necessary lexical/arithmetic checks only; passing is not semantic evidence support. */
import { GenerationCompoundSchemaV2 } from "./generation-v2-schema";
import { assertRegisteredCitations } from "./context-v0/adapters";
import { contextSourceKeyV0 } from "./proposals/context-v0";
import type { ContextGenerationEnvelopeV0 } from "./context-v0/ports";
import { eventStateContradictions } from "./event-state-grounding-v1";
import type { PackItem } from "./types";
export class GenerationV2ValidationError extends Error {
    constructor(readonly issues: string[]) {
        super(issues.join("; "));
        this.name = "GenerationV2ValidationError";
    }
}
const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** Dates are atomic: digits inside dates and identifiers cannot ground quantities. */
export function numericClaimsV2(text: string, year: string): string[] {
    const claims: string[] = [];
    let value = text.toLowerCase().replace(/\b(20\d{2})-(\d{2})-(\d{2})\b/g, (_, y, m, d) => {
        claims.push(`date:${y}-${m}-${d}`);
        return " ";
    });
    value = value.replace(
        /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:,?\s+(20\d{2}))?\b/g,
        (_, m: string, d: string, y: string) => {
            claims.push(
                `date:${y || year}-${String(months.indexOf(m.slice(0, 3)) + 1).padStart(2, "0")}-${d.padStart(2, "0")}`
            );
            return " ";
        }
    );
    // Preserve source/run/version identifiers atomically, rather than laundering their digits.
    value = value.replace(
        /\b[a-z][a-z\d]*(?:[-/:][a-z\d]+)*\d[a-z\d]*(?:[-/:][a-z\d]+)*(?:@[a-z\d.-]+)?\b/g,
        " "
    );
    const words: Record<string, number> = {
        zero: 0,
        one: 1,
        two: 2,
        three: 3,
        four: 4,
        five: 5,
        six: 6,
        seven: 7,
        eight: 8,
        nine: 9,
        ten: 10,
        eleven: 11,
        twelve: 12,
    };
    value = value.replace(
        /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g,
        w => String(words[w])
    );
    for (const match of value.matchAll(
        /(?<![\w])[-+]?\d+(?:,\d{3})*(?:\.\d+)?(?:\s*%|\s+percent)?(?![\w])/g
    )) {
        const raw = match[0].replace(/,/g, "");
        const percent = /%|percent/.test(raw);
        claims.push(`number:${Number(raw.replace(/%|percent/g, "").trim())}${percent ? "%" : ""}`);
    }
    return claims;
}
/**
 * Metadata can establish the date attached to a source, never the date of the
 * event it describes, its publication, or whether an old policy still applies.
 * Keep this deliberately narrow: unsupported wording remains unverified.
 */
function sourceDateAttributions(text: string, year: string): Set<string> {
    const date =
        "(?:20\\d{2}-\\d{2}-\\d{2}|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?\\s+\\d{1,2}(?:,?\\s+20\\d{2})?)";
    const source =
        "(?:(?:release\\s+)?update|source|document|report|policy|record|note|audit|memo|intake)";
    const patterns = [
        new RegExp(`\\b${source}\\s+(?:is\\s+)?dated\\s+(${date})\\b`, "gi"),
        new RegExp(
            `\\b(${date})\\s+${source}\\s+(?:says|reports|states|records|describes|notes|contains|indicates)\\b`,
            "gi"
        ),
    ];
    const attributed = new Set<string>();
    let remaining = text;
    for (const pattern of patterns) {
        remaining = remaining.replace(pattern, (_match, value: string) => {
            for (const claim of numericClaimsV2(value, year)) attributed.add(claim);
            return " ";
        });
    }
    // A repeated, unattributed date must not borrow support from a nearby
    // source-date attribution ("the Oct 18 update reports deployment on Oct 18").
    for (const claim of numericClaimsV2(remaining, year)) attributed.delete(claim);
    return attributed;
}

function sourceDateClaim(value: string, cutoffs: readonly string[]): string | undefined {
    const match =
        /^(20\d{2})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(
            value
        );
    if (!match) return;
    const calendar = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (calendar.toISOString().slice(0, 10) !== value.slice(0, 10)) return;
    const timestamp = Date.parse(value);
    if (
        !Number.isFinite(timestamp) ||
        cutoffs.some(c => !Number.isFinite(Date.parse(c)) || timestamp > Date.parse(c))
    )
        return;
    return `date:${value.slice(0, 10)}`;
}

export function normalizeGenerationV2(raw: unknown, envelope: ContextGenerationEnvelopeV0) {
    const pair = GenerationCompoundSchemaV2.parse(raw);
    const output = pair.experimental;
    const issues: string[] = [];
    if (
        pair.native.topics.length > 1 ||
        pair.native.enhancements.length ||
        output.enhancements.length
    )
        issues.push("compound topic/enhancement limits");
    const canonical = (refs: string[]) =>
        assertRegisteredCitations(envelope, refs).map(r => ({
            kind: r.kind,
            id: r.id,
            version: r.version,
        }));
    const year = envelope.v1Input.reportPeriod.weekStart.slice(0, 4);
    const sources: PackItem[] = envelope.evidenceSnapshot.entries.map(e => ({
        ref: contextSourceKeyV0(e.source),
        kind: "evidence",
        label: e.source.id,
        date: null,
        text: e.excerpt,
    }));
    const byRef = new Map(sources.map(s => [s.ref, s.text]));
    const sourceDates = new Map<string, string>();
    for (const snapshot of envelope.evidenceSnapshot.entries) {
        const ref = contextSourceKeyV0(snapshot.source);
        const entries = envelope.manifest.sourceRegistry.filter(
            e => contextSourceKeyV0(e.source) === ref
        );
        const entry = entries.length === 1 ? entries[0] : undefined;
        const frozen = envelope.freeze.sources.find(s => contextSourceKeyV0(s.ref) === ref);
        // The caller still owns full envelope/ACL validation. This augments
        // support only from the same supplied and frozen source version/content.
        if (
            !entry ||
            entry.access !== "allowed" ||
            ("contentHash" in entry && entry.contentHash !== snapshot.contentHash) ||
            entry.excerpt !== snapshot.excerpt ||
            !frozen ||
            frozen.contentHash !== snapshot.contentHash ||
            frozen.aclDigest !== entry.aclDigest
        )
            continue;
        const date = sourceDateClaim(entry.sourceDate, [
            envelope.evidenceSnapshot.asOf,
            envelope.manifest.reportWindow.asOf,
            envelope.v1Input.reportPeriod.asOf,
        ]);
        if (date) sourceDates.set(ref, date);
    }

    const all = new Set(
        output.topics.flatMap(t => [...t.facts, ...t.conflicts].flatMap(f => f.refs))
    );
    const subset = (refs: string[], allowed: Set<string>, path: string) => {
        canonical(refs);
        if (refs.some(r => !allowed.has(r)))
            issues.push(`${path}: refs outside cited facts/conflicts`);
    };
    const claims = (s: string) => numericClaimsV2(s, year);
    const support = (refs: string[]) => new Set(refs.flatMap(r => claims(byRef.get(r) ?? "")));
    const metadataSupport = (facts: (typeof output.topics)[number]["facts"]) => {
        const supported = new Set<string>();
        for (const fact of facts) {
            const attributed = sourceDateAttributions(fact.text, year);
            for (const ref of fact.refs) {
                const date = sourceDates.get(ref);
                if (date && attributed.has(date)) supported.add(date);
            }
        }
        return supported;
    };
    const check = (
        text: string,
        allowed: Set<string>,
        path: string,
        derived: string[] = [],
        metadataDates: Set<string> = new Set()
    ) => {
        const ok = new Set([...allowed, ...derived]);
        const attributed = sourceDateAttributions(text, year);
        for (const value of claims(text))
            if (!ok.has(value) && !(metadataDates.has(value) && attributed.has(value)))
                issues.push(`${path}: ungrounded ${value}`);
    };
    const factSupport = (facts: (typeof output.topics)[number]["facts"]) => {
        const supported = new Set<string>();
        for (const fact of facts) {
            const original = support(fact.refs);
            for (const claim of claims(fact.text)) if (original.has(claim)) supported.add(claim);
        }
        return supported;
    };
    const reportSupport = factSupport(output.topics.flatMap(t => [...t.facts, ...t.conflicts]));
    const derivedReport: string[] = [];
    output.keyFigures.forEach((figure, i) => {
        const path = `keyFigures.${i}`;
        subset(figure.refs, all, path);
        const derived: string[] = [];
        if (figure.derivation) {
            const { op, inputs } = figure.derivation;
            inputs.forEach(input => {
                if (
                    !figure.refs.includes(input.ref) ||
                    !support([input.ref]).has(`number:${input.value}`)
                )
                    issues.push(`${path}: ungrounded derivation input`);
            });
            let result = NaN;
            if (op === "difference" && inputs.length === 2)
                result = inputs[0]!.value - inputs[1]!.value;
            if (op === "ratio" && inputs.length === 2 && inputs[1]!.value !== 0)
                result = inputs[0]!.value / inputs[1]!.value;
            if (op === "sum") result = inputs.reduce((sum, x) => sum + x.value, 0);
            if (
                op === "count" &&
                new Set(inputs.map(x => `${x.ref}:${x.value}`)).size === inputs.length
            )
                result = inputs.length;
            if (!Number.isFinite(result)) issues.push(`${path}: invalid derivation arithmetic`);
            else {
                const normalized = Number(result.toPrecision(12));
                derived.push(`number:${normalized}`);
                if (op === "ratio")
                    derived.push(`number:${Number((normalized * 100).toPrecision(12))}%`);
            }
            if (!claims(figure.value).some(v => derived.includes(v)))
                issues.push(`${path}: declared result absent or arithmetic mismatch`);
        }
        check(
            figure.value,
            factSupport(
                output.topics
                    .flatMap(t => [...t.facts, ...t.conflicts])
                    .map(f => ({ ...f, refs: f.refs.filter(r => figure.refs.includes(r)) }))
            ),
            path,
            derived
        );
        derivedReport.push(...derived);
    });
    const reportDateSupport = metadataSupport(
        output.topics.flatMap(t => [...t.facts, ...t.conflicts])
    );
    check(output.headline, reportSupport, "headline", derivedReport, reportDateSupport);
    check(output.brief, reportSupport, "brief", derivedReport, reportDateSupport);
    const topics = output.topics.map((topic, i) => {
        const refs = new Set([...topic.facts, ...topic.conflicts].flatMap(f => f.refs));
        if (
            topic.proposedOwner !== null ||
            topic.proposedDueInDays !== null ||
            topic.helpRequested !== null
        )
            issues.push(`topics.${i}: owner/due/help must be null`);
        if (!topic.recommendation && !topic.unknowns.length)
            issues.push(`topics.${i}: null recommendation needs an explanation in unknowns`);
        if (topic.recommendation) {
            subset(topic.recommendation.refs, refs, `topics.${i}.recommendation`);
            check(
                topic.recommendation.call,
                factSupport(
                    [...topic.facts, ...topic.conflicts].map(f => ({
                        ...f,
                        refs: f.refs.filter(r => topic.recommendation!.refs.includes(r)),
                    }))
                ),
                `topics.${i}.recommendation.call`,
                output.keyFigures
                    .filter(
                        f =>
                            f.derivation &&
                            f.refs.every(r => topic.recommendation!.refs.includes(r))
                    )
                    .flatMap(f => claims(f.value)),
                metadataSupport(
                    [...topic.facts, ...topic.conflicts].map(f => ({
                        ...f,
                        refs: f.refs.filter(r => topic.recommendation!.refs.includes(r)),
                    }))
                )
            );
        }
        const { proposedDueInDays: _due, ...rest } = topic;
        void _due;
        return {
            ...rest,
            proposedOwner: null,
            proposedDue: null,
            helpRequested: null,
            facts: topic.facts.map(f => ({ ...f, refs: canonical(f.refs) })),
            conflicts: topic.conflicts.map(f => ({ ...f, refs: canonical(f.refs) })),
            recommendation: topic.recommendation
                ? { ...topic.recommendation, refs: canonical(topic.recommendation.refs) }
                : null,
        };
    });
    const projection = {
        ...output,
        enhancements: [
            ...output.topics.flatMap(t =>
                [
                    t.whyNow,
                    t.decisionQuestion,
                    t.proposedNextStep,
                    t.recommendation?.call,
                    t.recommendation?.because,
                    t.recommendation?.wouldChangeIf,
                ]
                    .filter((s): s is string => Boolean(s))
                    .map(text => ({
                        text,
                        refs: [...new Set([...t.facts, ...t.conflicts].flatMap(f => f.refs))],
                        rationale: "",
                    }))
            ),
            ...[output.headline, output.brief, ...output.keyFigures.map(f => f.value)].map(
                text => ({ text, refs: [...all], rationale: "" })
            ),
        ],
    };
    const eventIssues = eventStateContradictions(projection, sources, year);
    issues.push(...eventIssues.map(i => `${i.field}: ${i.code}`));
    if (!all.size) issues.push("experimental requires nonempty citations");
    if (issues.length) throw new GenerationV2ValidationError(issues);
    return {
        native: pair.native,
        report: {
            summary: output.summary,
            headline: output.headline,
            brief: output.brief,
            keyFigures: output.keyFigures.map(({ derivation, ...f }) => ({
                ...f,
                refs: canonical(f.refs),
                ...(derivation
                    ? {
                          derivation: {
                              ...derivation,
                              inputs: derivation.inputs.map(x => ({
                                  ...x,
                                  ref: canonical([x.ref])[0]!,
                              })),
                          },
                      }
                    : {}),
            })),
            topics,
            origin: "ai" as const,
            enhancements: [] as [],
        },
        refs: canonical([...all]),
        diagnostics: {
            questions: output.topics.map(t => ({
                length: t.decisionQuestion.length,
                namesDecision: /decid|should|which|can|what must/i.test(t.decisionQuestion),
            })),
        },
    };
}
