/**
 * Narrow, source-bound event-state contradictions. This is not an entailment checker.
 * Only explicit date-bound schedule events and versioned deployment predicates are
 * recognized. Ambiguous subjects/wording, quotations and nonassertive clauses abstain.
 */
import type { PackItem, VantageEvidenceRef } from "./types";

type Refs = readonly (string | VantageEvidenceRef)[];
export interface GroundingText {
    summary: string;
    topics: readonly {
        title: string;
        facts: readonly { text: string; refs: Refs }[];
        conflicts: readonly { text: string; refs: Refs }[];
        whyItMatters: string;
        rationale: string | null;
    }[];
    enhancements: readonly { text: string; refs: Refs; rationale: string }[];
}
export interface EventStateContradiction {
    code: "event-state-promotion";
    field: string;
    sourceRefs: string[];
}
interface Event {
    kind: "schedule" | "deployment";
    subject: string;
    target: string;
    level: number;
    positive: boolean;
    ref: string;
}
const months = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
];
const escape = (s: string) => s.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
const subject = (s: string) =>
    s
        .replace(/^(?:the|a|an)\s+/, "")
        .replace(/\s+date$/, "")
        .trim();
const date = "@\\d{4}-\\d{2}-\\d{2}";
const normalize = (text: string, year: string) =>
    text
        .toLowerCase()
        // Quoted claims cannot establish confirmation or an independent current assertion.
        .replace(/"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’/g, " ")
        .replace(/(?:^|\s)'[^'\n]+'(?=\s|[.,;:]|$)/g, " ")
        .replace(/\b(\d{4}-\d{2}-\d{2})\b/g, "@$1")
        .replace(
            /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:,?\s+(20\d{2}))?\b/g,
            (_, m: string, d: string, y: string | undefined) =>
                "@" +
                (y ?? year) +
                "-" +
                String(months.findIndex(x => x.startsWith(m.slice(0, 3))) + 1).padStart(2, "0") +
                "-" +
                d.padStart(2, "0")
        )
        .replace(/\s+/g, " ")
        .trim();
const clauses = (s: string) =>
    s
        .split(
            /(?<=[.!?])\s+|[;\n]+|,\s+(?:but|whereas|however)\s+|\s+but\s+|\s*[—–]\s*(?=(?:this|that|the|it|no)\b)/
        )
        .map(x => x.trim())
        .filter(x => x && !x.endsWith("?"))
        .map(x => x.replace(/[.!]$/, ""));
const uncertain = (prefix: string) =>
    /\b(?:if|whether|unless|would|could|might|may|should|unknown|unclear|unconfirmed|requested|proposed|planned)\b/.test(
        prefix
    ) ||
    /\b(?:previous|historical|earlier|old|prior|last week's)\s+(?:ai\s+)?(?:report|claim|interpretation)\b/.test(
        prefix
    );
const negated = (prefix: string) => /\b(?:not|never)(?:\s+yet)?\s*$/.test(prefix);
function events(text: string, ref: string, year: string): Event[] {
    const found: Event[] = [];
    const add = (
        kind: Event["kind"],
        name: string,
        target: string,
        level: number,
        positive: boolean
    ) => {
        const nameKey = subject(name);
        if (nameKey && nameKey.length <= 100)
            found.push({ kind, subject: nameKey, target, level, positive, ref });
    };
    for (const clause of clauses(normalize(text, year))) {
        // Conditions may follow the predicate too: "scheduled ... if approved".
        if (
            /\b(?:if|whether|unless|would|could|might|may|should|no evidence|not established|not known|no one|nobody|does not establish|does not show|cannot confirm|cannot establish)\b/.test(
                clause
            ) ||
            /\b(?:previous|historical|earlier|old|prior|last week's)\s+(?:ai\s+)?(?:report|claim|interpretation)\b/.test(
                clause
            )
        )
            continue;
        // Direct request grammar; the exact named subject and destination date bind the event.
        const weak = new RegExp(
            "\\b(?:requested|proposed|planned)\\s+(?:(?:to\\s+)?(?:move|reschedule|change)|moving|rescheduling|changing)\\s+(?:the\\s+)?([a-z0-9 _-]{2,100}?)\\s+(?:from\\s+" +
                date +
                "\\s+)?to\\s+(" +
                date +
                ")",
            "g"
        );
        for (const m of clause.matchAll(weak)) {
            if (!uncertain(clause.slice(0, m.index)) && !negated(clause.slice(0, m.index)))
                add("schedule", m[1]!, m[2]!, 0, true);
        }
        const active = new RegExp(
            "\\b(moved|rescheduled|changed)\\s+(?:the\\s+)?([a-z0-9 _-]{2,100}?)\\s+(?:from\\s+" +
                date +
                "\\s+)?to\\s+(" +
                date +
                ")",
            "g"
        );
        for (const m of clause.matchAll(active)) {
            const prefix = clause.slice(0, m.index);
            if (!uncertain(prefix) && !/\b(?:requested|proposed|planned)\b/.test(prefix))
                add("schedule", m[2]!, m[3]!, 1, !negated(prefix));
        }
        const passive = new RegExp(
            "\\b([a-z0-9_-]+(?:\\s+[a-z0-9_-]+){0,7})\\s+(?:is|was|has been|had been)\\s+(?:(not|never)(?:\\s+yet)?\\s+)?(?:(?:now|explicitly|officially)\\s+)?(?:moved|rescheduled|changed|scheduled|confirmed|approved)\\s+(?:from\\s+" +
                date +
                "\\s+)?(?:to|for|on)\\s+(" +
                date +
                ")",
            "g"
        );
        for (const m of clause.matchAll(passive)) {
            if (!uncertain(clause.slice(0, m.index) + " " + m[1]))
                add("schedule", m[1]!, m[3]!, 1, !m[2]);
        }
        const confirm = new RegExp(
            "\\b(?:confirmed|approved)\\s+(" +
                date +
                ")\\s+as\\s+(?:the\\s+)?([a-z0-9 _-]{2,100}?)(?:,|$)",
            "g"
        );
        for (const m of clause.matchAll(confirm)) {
            const prefix = clause.slice(0, m.index);
            if (!uncertain(prefix)) add("schedule", m[2]!, m[1]!, 1, !negated(prefix));
        }
        // Deployment checks require an explicit version/release identifier AND environment.
        // "Deployed to staging" can never confirm the separately keyed production event.
        const release = /\b(release|build|version)\s+([a-z0-9._-]*\d[a-z0-9._-]*)\b/g;
        for (const identity of clause.matchAll(release)) {
            const namespace = identity[1]!,
                id = identity[2]!;
            const token = namespace + "\\s+" + escape(id);
            const environment =
                "(?:the\\s+)?(?:synthetic\\s+)?(production|staging)(?:\\s+environment)?";
            const status =
                "(?:(not|never)(?:\\s+yet)?\\s+)?(?:(?:now|officially|independently)\\s+)?(planned|proposed|requested|approved|scheduled|deployed|executed|completed|verified)";
            const patterns = [
                new RegExp(
                    "\\b(?:deployment\\s+of\\s+)?" +
                        token +
                        "\\s+to\\s+" +
                        environment +
                        "\\s+(?:is|was|has been|had been)\\s+" +
                        status +
                        "\\b"
                ),
                new RegExp(
                    "\\b(?:deployment\\s+of\\s+)?" +
                        token +
                        "\\s+(?:is|was|has been|had been)\\s+" +
                        status +
                        "\\s+(?:to|for)\\s+" +
                        environment +
                        "(?:\\s+deployment)?\\b"
                ),
                new RegExp(
                    "\\b(approved|deployed|executed|completed|verified)\\s+(?:the\\s+)?(?:deployment\\s+of\\s+)?" +
                        token +
                        "\\s+to\\s+" +
                        environment +
                        "\\b"
                ),
            ];
            for (let i = 0; i < patterns.length; i++) {
                const m = patterns[i]!.exec(clause);
                if (!m || uncertain(clause.slice(0, m.index))) continue;
                const state = i === 0 ? m[3]! : i === 1 ? m[2]! : m[1]!;
                const env = i === 0 ? m[1]! : i === 1 ? m[3]! : m[2]!;
                // Completing/verifying an artifact for production is not deploying it.
                if (/executed|completed|verified/.test(state) && !/\bdeployment\s+of\b/.test(m[0]))
                    continue;
                const level = /planned|proposed|requested/.test(state)
                    ? 0
                    : /approved|scheduled/.test(state)
                      ? 1
                      : state === "verified"
                        ? 3
                        : 2;
                const positive =
                    i === 0 ? !m[2] : i === 1 ? !m[1] : !negated(clause.slice(0, m.index));
                add("deployment", namespace + ":" + id, env, level, positive);
            }
        }
    }
    return found;
}
const same = (a: Event, b: Event) =>
    a.kind === b.kind && a.subject === b.subject && a.target === b.target;
// A shortened subject can describe the same event, but cannot establish it. Abstain.
const ambiguous = (a: Event, b: Event) =>
    a.kind === b.kind &&
    a.target === b.target &&
    a.subject !== b.subject &&
    (a.subject.endsWith(" " + b.subject) || b.subject.endsWith(" " + a.subject));

/** Only selected current sources may confirm an event; history is deliberately absent. */
export function eventStateContradictions(
    report: GroundingText,
    sources: readonly PackItem[],
    reportingYear: string
): EventStateContradiction[] {
    const sourceEvents = sources.flatMap(item => events(item.text, item.ref, reportingYear));
    const violations: EventStateContradiction[] = [];
    const check = (text: string | null, field: string, refs?: Refs) => {
        if (!text) return;
        const ids = refs && new Set(refs.map(ref => (typeof ref === "string" ? ref : ref.ref)));
        const available = ids ? sourceEvents.filter(e => ids.has(e.ref)) : sourceEvents;
        for (const claim of events(text, "", reportingYear)) {
            if (!claim.positive || claim.level === 0) continue;
            const related = available.filter(e => same(e, claim));
            if (
                !related.length ||
                available.some(e => e.positive && e.level >= claim.level && ambiguous(e, claim))
            )
                continue;
            if (related.some(e => e.positive && e.level >= claim.level)) continue;
            // At least one explicit lower state or denial of this exact state is required.
            if (
                !related.some(
                    e =>
                        (e.positive && e.level < claim.level) ||
                        (!e.positive && e.level <= claim.level)
                )
            )
                continue;
            violations.push({
                code: "event-state-promotion",
                field,
                sourceRefs: [...new Set(related.map(e => e.ref))].sort(),
            });
            break;
        }
    };
    check(report.summary, "summary");
    report.topics.forEach((topic, i) => {
        check(topic.title, "topics." + i + ".title");
        check(topic.whyItMatters, "topics." + i + ".whyItMatters");
        check(topic.rationale, "topics." + i + ".rationale");
        topic.facts.forEach((fact, j) =>
            check(fact.text, "topics." + i + ".facts." + j, fact.refs)
        );
        topic.conflicts.forEach((fact, j) =>
            check(fact.text, "topics." + i + ".conflicts." + j, fact.refs)
        );
    });
    report.enhancements.forEach((enhancement, i) => {
        check(enhancement.text, "enhancements." + i + ".text", enhancement.refs);
        check(enhancement.rationale, "enhancements." + i + ".rationale", enhancement.refs);
    });
    return violations;
}
