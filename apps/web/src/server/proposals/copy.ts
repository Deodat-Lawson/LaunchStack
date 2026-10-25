/**
 * The sentences a proposals run and review store in English — step labels
 * and details, the run's headline and error, the review's deterministic
 * findings, the checklist rows the pipeline composes — read back as message
 * keys and values (`Copy`), so a screen can say them in the reader's
 * language. The stored English is never changed: API readers keep it, and
 * the DTO carries the copy beside it.
 *
 * Each sentence is recognised by the template that wrote it
 * (`@launchstack/pipelines/proposals` run.ts, review.ts, requirements.ts) and
 * kept only when its catalogue English reproduces the stored text exactly,
 * so a template that changes upstream falls back to the English instead of
 * showing something else. Model output, section questions and anything else
 * a person or a model wrote stays as it is.
 */
import { copy, type Copy, type CopyValues, type MessageKey } from "~/i18n/copy";
import { englishCopy } from "~/i18n/translate";

import type {
    FindingDto,
    RequirementDto,
    RunDto,
    RunStepDto,
} from "~/app/employer/tools/proposals/api";

const NS = "proposals.server";

type Rule = {
    key: MessageKey;
    pattern: RegExp;
    values?: (match: RegExpExecArray) => CopyValues;
};

const number = (raw: string | undefined): number => Number((raw ?? "").replace(/,/g, ""));

/** The rule whose catalogue English is exactly `english`, as a Copy. */
function matchRules(english: string | null | undefined, rules: readonly Rule[]): Copy | undefined {
    if (!english) return undefined;
    for (const rule of rules) {
        const match = rule.pattern.exec(english);
        if (!match) continue;
        const candidate = copy(rule.key, rule.values?.(match));
        try {
            if (englishCopy(candidate) === english) return candidate;
        } catch {
            // A value the message cannot format: not this template.
        }
    }
    return undefined;
}

const exactCache = new Map<string, Map<string, MessageKey>>();

/** The key among `keys` whose English is exactly `english`. */
function matchExact(
    english: string | null | undefined,
    keys: readonly MessageKey[]
): Copy | undefined {
    if (!english) return undefined;
    const id = keys.join("|");
    let index = exactCache.get(id);
    if (!index) {
        index = new Map(keys.map(key => [englishCopy(copy(key)), key] as const));
        exactCache.set(id, index);
    }
    const key = index.get(english);
    return key ? copy(key) : undefined;
}

const key = (path: string) => `${NS}.${path}` as MessageKey;

// ─── Runs ────────────────────────────────────────────────────────────────────

const STEP_LABELS = [
    "usingKeywords",
    "planningSearch",
    "searching",
    "scoring",
    "savingFunders",
    "readingRequest",
    "extracting",
    "buildingChecklist",
    "draftingSections",
    "rewriting",
    "checkingChecklist",
    "reviewingDrafts",
].map(name => key(`steps.${name}`));

const REWRITING_SECTION: Rule[] = [
    {
        key: key("steps.rewritingSection"),
        pattern: /^Rewriting: ([\s\S]+)$/,
        values: m => ({ section: m[1]! }),
    },
];

const RUN_ERRORS = [
    "runFailed",
    "noApplication",
    "applicationNotFound",
    "cannotFetch",
    "noRequestText",
    "requestTooShort",
    "noSection",
    "sectionNotFound",
    "noDraft",
    "profileOrKeywords",
].map(name => key(`runErrors.${name}`));

/** `{count}` as the English printed it (grouped or bare), so it reads the same in every language. */
const count = (path: string, pattern: RegExp): Rule => ({
    key: key(path),
    pattern,
    values: m => ({ count: m[1]! }),
});

/** What a finished step's detail says, by step id. */
const STEP_DETAILS: Record<string, Rule[]> = {
    search: [
        {
            key: key("stepDetails.sources"),
            pattern: /^Grants\.gov: (\S+) · Web: (\S+)$/,
            values: m => ({ grants: m[1]!, web: m[2]! }),
        },
    ],
    score: [
        count("stepDetails.scored", /^(\d+) scored$/),
        { key: key("stepDetails.notScored"), pattern: /^not scored$/ },
    ],
    save: [count("stepDetails.funders", /^(\d+) funders$/)],
    read: [count("stepDetails.characters", /^([\d,]+) characters$/)],
    extract: [count("stepDetails.sections", /^(\d+) sections$/)],
    checklist: [count("stepDetails.items", /^(\d+) items$/)],
    draft: [
        {
            key: key("stepDetails.citations"),
            pattern: /^(\d+) citations?(?: · (\d+) gaps?)?$/,
            values: m => ({ cites: number(m[1]), gaps: number(m[2] ?? "0") }),
        },
    ],
    rewrite: [
        {
            key: key("stepDetails.words"),
            pattern: /^(\d+) → (\d+) words$/,
            values: m => ({ before: m[1]!, after: m[2]! }),
        },
    ],
    check: [
        {
            key: key("stepDetails.checklistDone"),
            pattern: /^(\d+) of (\d+) done$/,
            values: m => ({ done: m[1]!, total: m[2]! }),
        },
    ],
    review: [count("stepDetails.findings", /^(\d+) findings$/)],
};

const HEADLINES: Rule[] = [
    {
        key: key("headlines.funders"),
        pattern: /^(\d+) funders found, (\d+) strong fits$/,
        values: m => ({ found: m[1]!, strong: m[2]! }),
    },
    {
        key: key("headlines.extract"),
        pattern: /^(\d+) sections, (\d+) checklist items$/,
        values: m => ({ sections: m[1]!, requirements: m[2]! }),
    },
    {
        key: key("headlines.drafted"),
        pattern: /^(\d+) sections? drafted$/,
        values: m => ({ count: number(m[1]) }),
    },
    { key: key("headlines.nothingToDraft"), pattern: /^Nothing to draft$/ },
    {
        key: key("headlines.rewritten"),
        pattern: /^Rewritten: (\d+) → (\d+) words$/,
        values: m => ({ before: m[1]!, after: m[2]! }),
    },
    {
        key: key("headlines.review"),
        pattern: /^Readiness (\d+)\/100 · (\d+) findings(?: · (\d+) blockers?)?$/,
        values: m => ({ readiness: m[1]!, findings: m[2]!, blockers: number(m[3] ?? "0") }),
    },
];

/** A step's words: draft steps are named after their section's question, which stays as written. */
export function stepCopy(
    step: Pick<RunStepDto, "id" | "label" | "status" | "detail">
): Pick<RunStepDto, "labelCopy" | "detailCopy"> {
    const labelCopy = step.id.startsWith("draft:")
        ? undefined
        : (matchExact(step.label, STEP_LABELS) ?? matchRules(step.label, REWRITING_SECTION));
    let detailCopy: Copy | undefined;
    if (step.status === "failed") detailCopy = matchExact(step.detail, RUN_ERRORS);
    else if (step.status === "done") {
        detailCopy = matchRules(step.detail, STEP_DETAILS[step.id.split(":")[0]!] ?? []);
    }
    return { labelCopy, detailCopy };
}

export function runCopy(
    run: Pick<RunDto, "headline" | "error">
): Pick<RunDto, "headlineCopy" | "errorCopy"> {
    return {
        headlineCopy: matchRules(run.headline, HEADLINES),
        errorCopy: matchExact(run.error, RUN_ERRORS),
    };
}

// ─── Review ──────────────────────────────────────────────────────────────────

const FINDING_MESSAGES: Record<string, Rule[]> = {
    missing: [
        {
            key: key("findings.missing"),
            pattern: /^"([\s\S]*)" has no answer yet\.$/,
            values: m => ({ question: m[1]! }),
        },
    ],
    over_limit: [
        {
            key: key("findings.overLimit"),
            pattern: /^(\d+) words against a limit of (\d+)\.$/,
            values: m => ({ words: m[1]!, limit: m[2]! }),
        },
    ],
    unsupported: [{ key: key("findings.unsupported"), pattern: /^This answer cites none/ }],
    eligibility: [
        {
            key: key("findings.eligibility"),
            pattern: /^Eligibility not confirmed: ([\s\S]*)$/,
            values: m => ({ rule: m[1]! }),
        },
    ],
    attachment: [
        {
            key: key("findings.attachment"),
            pattern: /^Attachment still to gather: ([\s\S]*)$/,
            values: m => ({ item: m[1]! }),
        },
    ],
    deadline: [
        {
            key: key("findings.deadlinePassed"),
            pattern: /^The deadline passed (\d+) days? ago\.$/,
            values: m => ({ days: number(m[1]) }),
        },
        { key: key("findings.deadlineToday"), pattern: /^The deadline is today\.$/ },
        {
            key: key("findings.deadlineSoon"),
            pattern: /^(\d+) days? to the deadline\.$/,
            values: m => ({ days: number(m[1]) }),
        },
    ],
};

const FINDING_SUGGESTIONS = [
    "missingSuggestion",
    "overLimitSuggestion",
    "unsupportedSuggestion",
    "eligibilitySuggestion",
    "deadlinePassedSuggestion",
].map(name => key(`findings.${name}`));

/**
 * A finding's words, for the checks the review makes without a model. The
 * model's own findings (`model:…` ids) are its words and stay as written.
 */
export function findingCopy(
    finding: Pick<FindingDto, "id" | "message" | "suggestion">
): Pick<FindingDto, "messageCopy" | "suggestionCopy"> {
    if (finding.id.startsWith("model:")) return {};
    const kind = finding.id.split(":")[0]!;
    return {
        messageCopy: matchRules(finding.message, FINDING_MESSAGES[kind] ?? []),
        suggestionCopy: matchExact(finding.suggestion, FINDING_SUGGESTIONS),
    };
}

export function reviewSummaryCopy(summary: string): Copy | undefined {
    return matchExact(summary, [key("reviewSummary.nothingWritten")]);
}

// ─── Checklist ───────────────────────────────────────────────────────────────

const SECTION_ROW: Rule[] = [
    {
        key: key("requirements.answerLimit"),
        pattern: /^Answer: ([\s\S]+) \((\d+) words\)$/,
        values: m => ({ question: m[1]!, limit: m[2]! }),
    },
    {
        key: key("requirements.answer"),
        pattern: /^Answer: ([\s\S]+)$/,
        values: m => ({ question: m[1]! }),
    },
    {
        key: key("requirements.optionalLimit"),
        pattern: /^Optional: ([\s\S]+) \((\d+) words\)$/,
        values: m => ({ question: m[1]!, limit: m[2]! }),
    },
    {
        key: key("requirements.optional"),
        pattern: /^Optional: ([\s\S]+)$/,
        values: m => ({ question: m[1]! }),
    },
];

const DEADLINE_ROW: Rule[] = [
    {
        key: key("requirements.submitBy"),
        pattern: /^Submit by (\S+)$/,
        values: m => ({ date: m[1]! }),
    },
];

const BUDGET_ROW: Rule[] = [
    {
        key: key("requirements.budgetBetween"),
        pattern: /^Request between \$(\S+) and \$(\S+)$/,
        values: m => ({ min: m[1]!, max: m[2]! }),
    },
    {
        key: key("requirements.budgetMax"),
        pattern: /^Request at most \$(\S+)$/,
        values: m => ({ max: m[1]! }),
    },
    {
        key: key("requirements.budgetMin"),
        pattern: /^Request at least \$(\S+)$/,
        values: m => ({ min: m[1]! }),
    },
];

/**
 * A checklist row's words, for the rows composed from the request (the
 * deadline, the budget, one per section). Eligibility, attachment and format
 * rows are the funder's own words as read and stay as they are.
 */
export function requirementCopy(
    requirement: Pick<RequirementDto, "id" | "kind" | "text">
): Copy | undefined {
    if (requirement.kind === "section") return matchRules(requirement.text, SECTION_ROW);
    if (requirement.id === "deadline") return matchRules(requirement.text, DEADLINE_ROW);
    if (requirement.id === "budget") return matchRules(requirement.text, BUDGET_ROW);
    return undefined;
}
