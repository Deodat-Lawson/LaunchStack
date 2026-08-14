/**
 * Deterministic assertions for Campaign Planner output.
 *
 * Scope boundary: everything here is checkable from strings, numbers, counts,
 * lengths, exact matches, regexes, source-fact lookup or similarity. Subjective
 * criteria — hook quality, brand voice, audience fit, campaign-goal alignment,
 * persuasiveness, platform-native tone, creativity — are owned by the LLM judge
 * and are deliberately NOT implemented here.
 *
 * Every assertion:
 *   - returns a valid CriterionScore and never throws
 *   - handles empty, whitespace-only and malformed output safely
 *   - is a pure function of (output, context, params)
 */

import {
    PLATFORM_CHAR_LIMITS,
    PLATFORM_HASHTAG_LIMITS,
    fail,
    partial,
    pass,
    type CriterionScore,
    type DeterministicAssertion,
    type EvalContext,
    type GeneratedOutput,
    type SourceFact,
} from "@schema";

import {
    collapseWhitespace,
    containsNormalized,
    countEmojis,
    countHashtags,
    countQuestions,
    countUrls,
    effectiveCharLength,
    extractNumerics,
    extractProductNameCandidates,
    findSuperlatives,
    jaccard,
    longestSharedWordRun,
    normalize,
    openingHook,
    tokenize,
} from "./text";

/* ──────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────── */

/** Non-empty variant messages. Tolerates malformed output. */
function messages(output: GeneratedOutput): string[] {
    if (!output || !Array.isArray(output.variants)) return [];
    return output.variants
        .map(v => (typeof v?.message === "string" ? v.message : ""))
        .filter(m => m.trim().length > 0);
}

/** All variant text joined. */
function joined(output: GeneratedOutput): string {
    return messages(output).join("\n\n");
}

function num(params: Record<string, unknown> | undefined, key: string): number | null {
    const v = params?.[key];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function facts(context: EvalContext, kind: SourceFact["kind"]): SourceFact[] {
    return (context.company?.sourceFacts ?? []).filter(f => f.kind === kind);
}

/**
 * Does the output appear to assert `fact`? Deliberately conservative: requires
 * meaningful lexical overlap with the fact statement rather than a single word.
 */
function factAsserted(text: string, fact: SourceFact, threshold = 0.5): boolean {
    const statementTokens = tokenize(fact.statement).filter(t => t.length > 3);
    if (statementTokens.length === 0) return false;
    const textTokens = new Set(tokenize(text));
    let hits = 0;
    for (const t of new Set(statementTokens)) if (textTokens.has(t)) hits++;
    const coverage = hits / new Set(statementTokens).size;
    return coverage >= threshold;
}

/** Numerics that appear anywhere in the company's supported facts or documents. */
function supportedNumerics(context: EvalContext): Set<string> {
    const out = new Set<string>();
    for (const f of context.company?.sourceFacts ?? []) {
        if (f.kind !== "supported") continue;
        for (const n of extractNumerics(f.statement)) out.add(n);
    }
    for (const doc of Object.values(context.documents ?? {})) {
        for (const n of extractNumerics(doc)) out.add(n);
    }
    // Structured fields also count as support.
    const c = context.company;
    for (const p of c?.products ?? []) {
        for (const s of [...p.capabilities, ...p.limitations, p.description]) {
            for (const n of extractNumerics(s)) out.add(n);
        }
    }
    for (const s of c?.proofPoints ?? []) for (const n of extractNumerics(s)) out.add(n);
    return out;
}

/* ──────────────────────────────────────────────────────────────
 * Structure
 * ────────────────────────────────────────────────────────────── */

export const nonEmptyOutput: DeterministicAssertion = {
    id: "non-empty-output",
    description: "Output contains at least one variant with non-whitespace content.",
    category: "structure",
    run(output, context, _params): CriterionScore {
        if (context.fixture?.expected?.forbidEmptyOutput === false) {
            return pass(this, this.id, "Empty-output check disabled; skipped.");
        }
        const m = messages(output);
        if (m.length === 0) {
            return fail(this, this.id, "Output contained no non-empty variant messages.");
        }
        return pass(this, this.id, `${m.length} non-empty variant(s).`);
    },
};

export const platformMatchesFixture: DeterministicAssertion = {
    id: "platform-matches-fixture",
    description: "The output's declared platform matches the fixture's platform.",
    category: "structure",
    run(output, context, _params): CriterionScore {
        const fixturePlatform = context.fixture?.platform;
        const outputPlatform = output?.platform;
        if (!fixturePlatform) return pass(this, this.id, "Fixture declares no platform; skipped.");
        if (!outputPlatform) {
            return pass(this, this.id, "Output declares no platform; nothing to compare.");
        }
        if (outputPlatform !== fixturePlatform) {
            return fail(
                this,
                this.id,
                `Output platform "${outputPlatform}" differs from fixture platform "${fixturePlatform}".`,
                { evidence: [`output=${outputPlatform}`, `fixture=${fixturePlatform}`] }
            );
        }
        return pass(this, this.id, `Output platform matches fixture ("${fixturePlatform}").`);
    },
};

/* ──────────────────────────────────────────────────────────────
 * Length
 * ────────────────────────────────────────────────────────────── */

export const maxChars: DeterministicAssertion = {
    id: "max-chars",
    description: "Every variant is at or below a maximum character count.",
    category: "length",
    run(output, context, params): CriterionScore {
        const limit = num(params, "maxChars") ?? context.fixture?.expected?.maxChars ?? null;
        if (limit === null) return pass(this, this.id, "No maxChars configured; skipped.");
        const platform = context.fixture?.platform ?? output?.platform;
        const m = messages(output);
        if (m.length === 0) return fail(this, this.id, "No output to measure.");
        const over = m
            .map((t, i) => ({ i, len: effectiveCharLength(t, platform) }))
            .filter(x => x.len > limit);
        if (over.length === 0) {
            return pass(this, this.id, `All ${m.length} variant(s) within ${limit} chars.`);
        }
        return partial(
            this,
            this.id,
            m.length - over.length,
            m.length,
            `${over.length}/${m.length} variant(s) exceeded ${limit} chars: ${over
                .map(o => `#${o.i}=${o.len}`)
                .join(", ")}.`,
            { evidence: over.map(o => `variant ${o.i}: ${o.len} chars`) }
        );
    },
};

export const minChars: DeterministicAssertion = {
    id: "min-chars",
    description: "Every variant is at or above a minimum character count.",
    category: "length",
    run(output, context, params): CriterionScore {
        const limit = num(params, "minChars") ?? context.fixture?.expected?.minChars ?? null;
        if (limit === null) return pass(this, this.id, "No minChars configured; skipped.");
        const platform = context.fixture?.platform ?? output?.platform;
        const m = messages(output);
        if (m.length === 0) return fail(this, this.id, "No output to measure.");
        const under = m
            .map((t, i) => ({ i, len: effectiveCharLength(t, platform) }))
            .filter(x => x.len < limit);
        if (under.length === 0) {
            return pass(this, this.id, `All ${m.length} variant(s) at or above ${limit} chars.`);
        }
        return partial(
            this,
            this.id,
            m.length - under.length,
            m.length,
            `${under.length}/${m.length} variant(s) shorter than ${limit} chars: ${under
                .map(o => `#${o.i}=${o.len}`)
                .join(", ")}.`,
            { evidence: under.map(o => `variant ${o.i}: ${o.len} chars`) }
        );
    },
};

export const platformCharLimit: DeterministicAssertion = {
    id: "platform-char-limit",
    description: "Every variant respects the documented character limit for its platform.",
    category: "length",
    run(output, context, _params): CriterionScore {
        if (context.fixture?.expected?.enforcePlatformCharLimit === false) {
            return pass(this, this.id, "Platform char-limit enforcement disabled; skipped.");
        }
        // Fixture-first: a mislabeled output must not switch the limit.
        const platform = context.fixture?.platform ?? output?.platform;
        const limit = platform ? PLATFORM_CHAR_LIMITS[platform] : undefined;
        if (!limit) return pass(this, this.id, "Unknown platform; skipped.");
        const m = messages(output);
        if (m.length === 0) return fail(this, this.id, "No output to measure.");
        const over = m
            .map((t, i) => ({ i, len: effectiveCharLength(t, platform) }))
            .filter(x => x.len > limit);
        if (over.length === 0) {
            return pass(this, this.id, `All variant(s) within the ${platform} limit of ${limit}.`);
        }
        return partial(
            this,
            this.id,
            m.length - over.length,
            m.length,
            `${over.length}/${m.length} variant(s) exceeded the ${platform} limit of ${limit}: ${over
                .map(o => `#${o.i}=${o.len}`)
                .join(", ")}.`,
            { evidence: over.map(o => `variant ${o.i}: ${o.len} chars`) }
        );
    },
};

export const maxWords: DeterministicAssertion = {
    id: "max-words",
    description: "Every variant is at or below a maximum word count.",
    category: "length",
    run(output, context, params): CriterionScore {
        const limit = num(params, "maxWords") ?? context.fixture?.expected?.maxWords ?? null;
        if (limit === null) return pass(this, this.id, "No maxWords configured; skipped.");
        const m = messages(output);
        if (m.length === 0) return fail(this, this.id, "No output to measure.");
        const over = m.map((t, i) => ({ i, n: tokenize(t).length })).filter(x => x.n > limit);
        if (over.length === 0) return pass(this, this.id, `All variant(s) within ${limit} words.`);
        return partial(
            this,
            this.id,
            m.length - over.length,
            m.length,
            `${over.length}/${m.length} variant(s) exceeded ${limit} words.`,
            { evidence: over.map(o => `variant ${o.i}: ${o.n} words`) }
        );
    },
};

/* ──────────────────────────────────────────────────────────────
 * Variants
 * ────────────────────────────────────────────────────────────── */

export const variantCount: DeterministicAssertion = {
    id: "variant-count",
    description: "Variant count falls within the configured minimum and maximum.",
    category: "variants",
    run(output, context, params): CriterionScore {
        const min = num(params, "minVariants") ?? context.fixture?.expected?.minVariants ?? null;
        const max = num(params, "maxVariants") ?? context.fixture?.expected?.maxVariants ?? null;
        if (min === null && max === null) {
            return pass(this, this.id, "No variant bounds configured; skipped.");
        }
        const n = messages(output).length;
        if (min !== null && n < min) {
            return fail(this, this.id, `Expected at least ${min} variant(s), got ${n}.`);
        }
        if (max !== null && n > max) {
            return fail(this, this.id, `Expected at most ${max} variant(s), got ${n}.`);
        }
        return pass(this, this.id, `${n} variant(s) within bounds.`);
    },
};

export const noDuplicateVariants: DeterministicAssertion = {
    id: "no-duplicate-variants",
    description: "No two variants are textually identical after normalisation.",
    category: "variants",
    run(output, context, _params): CriterionScore {
        if (context.fixture?.expected?.forbidDuplicateVariants === false) {
            return pass(this, this.id, "Duplicate check disabled; skipped.");
        }
        const m = messages(output);
        if (m.length < 2)
            return pass(this, this.id, "Fewer than two variants; nothing to compare.");
        const seen = new Map<string, number>();
        const dupes: string[] = [];
        m.forEach((t, i) => {
            const key = normalize(t);
            const first = seen.get(key);
            if (first !== undefined) dupes.push(`variant ${i} duplicates variant ${first}`);
            else seen.set(key, i);
        });
        if (dupes.length === 0) return pass(this, this.id, "All variants distinct.");
        return fail(this, this.id, `${dupes.length} duplicate variant pair(s).`, {
            evidence: dupes,
        });
    },
};

export const variantSimilarity: DeterministicAssertion = {
    id: "variant-similarity",
    description: "No pair of variants exceeds the configured similarity ceiling.",
    category: "variants",
    run(output, context, params): CriterionScore {
        const limit =
            num(params, "maxVariantSimilarity") ??
            context.fixture?.expected?.maxVariantSimilarity ??
            null;
        if (limit === null)
            return pass(this, this.id, "No similarity ceiling configured; skipped.");
        const m = messages(output);
        if (m.length < 2)
            return pass(this, this.id, "Fewer than two variants; nothing to compare.");
        const offenders: string[] = [];
        let comparisons = 0;
        for (let i = 0; i < m.length; i++) {
            for (let j = i + 1; j < m.length; j++) {
                comparisons++;
                const sim = jaccard(m[i] ?? "", m[j] ?? "");
                if (sim > limit) {
                    offenders.push(`variants ${i}/${j} similarity ${sim.toFixed(2)} > ${limit}`);
                }
            }
        }
        if (offenders.length === 0) {
            return pass(this, this.id, `All ${comparisons} variant pair(s) below ${limit}.`);
        }
        return partial(
            this,
            this.id,
            comparisons - offenders.length,
            comparisons,
            `${offenders.length}/${comparisons} variant pair(s) too similar.`,
            { evidence: offenders }
        );
    },
};

export const distinctOpeningHooks: DeterministicAssertion = {
    id: "distinct-opening-hooks",
    description: "No two variants share the same opening sentence.",
    category: "variants",
    run(output, context, _params): CriterionScore {
        if (context.fixture?.expected?.forbidRepeatedOpeningHooks === false) {
            return pass(this, this.id, "Opening-hook check disabled; skipped.");
        }
        const m = messages(output);
        if (m.length < 2)
            return pass(this, this.id, "Fewer than two variants; nothing to compare.");
        const seen = new Map<string, number>();
        const repeats: string[] = [];
        m.forEach((t, i) => {
            const hook = openingHook(t);
            if (!hook) return;
            const first = seen.get(hook);
            if (first !== undefined)
                repeats.push(`variant ${i} repeats the hook of variant ${first}`);
            else seen.set(hook, i);
        });
        if (repeats.length === 0) return pass(this, this.id, "All opening hooks distinct.");
        return fail(this, this.id, `${repeats.length} repeated opening hook(s).`, {
            evidence: repeats,
        });
    },
};

/* ──────────────────────────────────────────────────────────────
 * Formatting
 * ────────────────────────────────────────────────────────────── */

export const hashtagLimit: DeterministicAssertion = {
    id: "hashtag-limit",
    description: "Hashtag count per variant is within the configured or platform ceiling.",
    category: "formatting",
    run(output, context, params): CriterionScore {
        const explicit =
            num(params, "maxHashtags") ?? context.fixture?.expected?.maxHashtags ?? null;
        // Fixture-first: a mislabeled output must not switch the limit.
        const platform = context.fixture?.platform ?? output?.platform;
        const usePlatform =
            explicit === null && context.fixture?.expected?.enforcePlatformHashtagLimit === true;
        const limit =
            explicit ?? (usePlatform && platform ? PLATFORM_HASHTAG_LIMITS[platform] : null);
        if (limit === null) return pass(this, this.id, "No hashtag ceiling configured; skipped.");
        const m = messages(output);
        if (m.length === 0) return fail(this, this.id, "No output to measure.");
        const over = m.map((t, i) => ({ i, n: countHashtags(t) })).filter(x => x.n > limit);
        if (over.length === 0)
            return pass(this, this.id, `All variant(s) within ${limit} hashtag(s).`);
        return partial(
            this,
            this.id,
            m.length - over.length,
            m.length,
            `${over.length}/${m.length} variant(s) exceeded ${limit} hashtag(s).`,
            { evidence: over.map(o => `variant ${o.i}: ${o.n} hashtags`) }
        );
    },
};

export const emojiLimit: DeterministicAssertion = {
    id: "emoji-limit",
    description: "Emoji count per variant is within the configured ceiling.",
    category: "formatting",
    run(output, context, params): CriterionScore {
        const limit = num(params, "maxEmojis") ?? context.fixture?.expected?.maxEmojis ?? null;
        if (limit === null) return pass(this, this.id, "No emoji ceiling configured; skipped.");
        const m = messages(output);
        if (m.length === 0) return fail(this, this.id, "No output to measure.");
        const over = m.map((t, i) => ({ i, n: countEmojis(t) })).filter(x => x.n > limit);
        if (over.length === 0) return pass(this, this.id, `All variant(s) within ${limit} emoji.`);
        return partial(
            this,
            this.id,
            m.length - over.length,
            m.length,
            `${over.length}/${m.length} variant(s) exceeded ${limit} emoji.`,
            { evidence: over.map(o => `variant ${o.i}: ${o.n} emoji`) }
        );
    },
};

export const urlPolicy: DeterministicAssertion = {
    id: "url-policy",
    description: "Variants contain a URL when required, and none when forbidden.",
    category: "formatting",
    run(output, context, _params): CriterionScore {
        const req = context.fixture?.expected?.requireUrl === true;
        const forbid = context.fixture?.expected?.forbidUrl === true;
        if (!req && !forbid) return pass(this, this.id, "No URL policy configured; skipped.");
        const m = messages(output);
        if (m.length === 0) return fail(this, this.id, "No output to measure.");
        const counts = m.map((t, i) => ({ i, n: countUrls(t) }));
        if (req) {
            const missing = counts.filter(c => c.n === 0);
            if (missing.length > 0) {
                return partial(
                    this,
                    this.id,
                    m.length - missing.length,
                    m.length,
                    `${missing.length}/${m.length} variant(s) missing a required URL.`,
                    { evidence: missing.map(c => `variant ${c.i}`) }
                );
            }
        }
        if (forbid) {
            const present = counts.filter(c => c.n > 0);
            if (present.length > 0) {
                return partial(
                    this,
                    this.id,
                    m.length - present.length,
                    m.length,
                    `${present.length}/${m.length} variant(s) contain a forbidden URL.`,
                    { evidence: present.map(c => `variant ${c.i}: ${c.n} url(s)`) }
                );
            }
        }
        return pass(this, this.id, "URL policy satisfied.");
    },
};

export const questionLimit: DeterministicAssertion = {
    id: "question-limit",
    description: "Question-mark count per variant is within the configured ceiling.",
    category: "formatting",
    run(output, context, params): CriterionScore {
        const limit =
            num(params, "maxQuestions") ?? context.fixture?.expected?.maxQuestions ?? null;
        if (limit === null) return pass(this, this.id, "No question ceiling configured; skipped.");
        const m = messages(output);
        if (m.length === 0) return fail(this, this.id, "No output to measure.");
        const over = m.map((t, i) => ({ i, n: countQuestions(t) })).filter(x => x.n > limit);
        if (over.length === 0)
            return pass(this, this.id, `All variant(s) within ${limit} question(s).`);
        return partial(
            this,
            this.id,
            m.length - over.length,
            m.length,
            `${over.length}/${m.length} variant(s) exceeded ${limit} question(s).`,
            { evidence: over.map(o => `variant ${o.i}: ${o.n} questions`) }
        );
    },
};

/* ──────────────────────────────────────────────────────────────
 * Content
 * ────────────────────────────────────────────────────────────── */

export const mustMention: DeterministicAssertion = {
    id: "must-mention",
    description: "Every required term appears somewhere in the output.",
    category: "content",
    run(output, context, _params): CriterionScore {
        const required = context.fixture?.expected?.mustMention ?? [];
        if (required.length === 0) return pass(this, this.id, "No required mentions; skipped.");
        const text = joined(output);
        if (!text) return fail(this, this.id, "No output; required mentions absent.");
        const missing = required.filter(r => !containsNormalized(text, r));
        if (missing.length === 0) {
            return pass(this, this.id, `All ${required.length} required mention(s) present.`);
        }
        return partial(
            this,
            this.id,
            required.length - missing.length,
            required.length,
            `Missing required mention(s): ${missing.join(", ")}.`,
            { evidence: missing }
        );
    },
};

export const mustNotMention: DeterministicAssertion = {
    id: "must-not-mention",
    description: "No forbidden term appears in the output.",
    category: "content",
    run(output, context, _params): CriterionScore {
        const banned = [
            ...(context.fixture?.expected?.mustNotMention ?? []),
            ...(context.fixture?.expected?.forbiddenTerms ?? []),
        ];
        if (banned.length === 0) return pass(this, this.id, "No forbidden terms; skipped.");
        const text = joined(output);
        if (!text) return pass(this, this.id, "No output; nothing forbidden present.");
        const found = banned.filter(b => containsNormalized(text, b));
        if (found.length === 0)
            return pass(this, this.id, `None of ${banned.length} forbidden term(s) present.`);
        return fail(this, this.id, `Forbidden term(s) present: ${found.join(", ")}.`, {
            evidence: found,
        });
    },
};

export const requiredPhrases: DeterministicAssertion = {
    id: "required-phrases",
    description: "Every exact required phrase appears in the output.",
    category: "content",
    run(output, context, _params): CriterionScore {
        const required = context.fixture?.expected?.requiredPhrases ?? [];
        if (required.length === 0) return pass(this, this.id, "No required phrases; skipped.");
        const text = joined(output);
        if (!text) return fail(this, this.id, "No output; required phrases absent.");
        const missing = required.filter(p => !containsNormalized(text, p));
        if (missing.length === 0)
            return pass(this, this.id, `All ${required.length} phrase(s) present.`);
        return partial(
            this,
            this.id,
            required.length - missing.length,
            required.length,
            `Missing required phrase(s): ${missing.join(" | ")}.`,
            { evidence: missing }
        );
    },
};

export const requireDisclaimer: DeterministicAssertion = {
    id: "require-disclaimer",
    description: "At least one approved disclaimer variant appears in every message.",
    category: "content",
    run(output, context, _params): CriterionScore {
        const options = context.fixture?.expected?.requireDisclaimer ?? [];
        if (options.length === 0) return pass(this, this.id, "No disclaimer required; skipped.");
        const m = messages(output);
        if (m.length === 0) return fail(this, this.id, "No output; disclaimer absent.");
        const missing = m
            .map((t, i) => ({ i, ok: options.some(o => containsNormalized(t, o)) }))
            .filter(x => !x.ok);
        if (missing.length === 0)
            return pass(this, this.id, "Disclaimer present in all variant(s).");
        return partial(
            this,
            this.id,
            m.length - missing.length,
            m.length,
            `${missing.length}/${m.length} variant(s) missing a required disclaimer.`,
            { evidence: missing.map(x => `variant ${x.i}`) }
        );
    },
};

export const noProhibitedCompetitors: DeterministicAssertion = {
    id: "no-prohibited-competitors",
    description: "No prohibited competitor name appears in the output.",
    category: "content",
    run(output, context, _params): CriterionScore {
        if (context.fixture?.expected?.forbidProhibitedCompetitors === false) {
            return pass(this, this.id, "Competitor check disabled; skipped.");
        }
        const banned = context.company?.prohibitedCompetitors ?? [];
        if (banned.length === 0)
            return pass(this, this.id, "No prohibited competitors listed; skipped.");
        const text = joined(output);
        if (!text) return pass(this, this.id, "No output; nothing to check.");
        const found = banned.filter(b => containsNormalized(text, b));
        if (found.length === 0) return pass(this, this.id, "No prohibited competitor mentioned.");
        return fail(this, this.id, `Prohibited competitor(s) mentioned: ${found.join(", ")}.`, {
            evidence: found,
        });
    },
};

/* ──────────────────────────────────────────────────────────────
 * Grounding
 * ────────────────────────────────────────────────────────────── */

export const mustUseSupportedFacts: DeterministicAssertion = {
    id: "must-use-supported-facts",
    description: "Every required supported fact is actually used in the output.",
    category: "grounding",
    run(output, context, _params): CriterionScore {
        const ids = context.fixture?.expected?.mustUseFactIds ?? [];
        if (ids.length === 0) return pass(this, this.id, "No required facts; skipped.");
        const text = joined(output);
        if (!text) return fail(this, this.id, "No output; required facts unused.");
        const missing: string[] = [];
        for (const id of ids) {
            const f = context.factsById?.[id];
            if (!f) {
                missing.push(`${id} (unknown fact id)`);
                continue;
            }
            if (!factAsserted(text, f)) missing.push(id);
        }
        if (missing.length === 0)
            return pass(this, this.id, `All ${ids.length} required fact(s) used.`);
        return partial(
            this,
            this.id,
            ids.length - missing.length,
            ids.length,
            `Required fact(s) not used: ${missing.join(", ")}.`,
            { evidence: missing }
        );
    },
};

export const mustNotUseFacts: DeterministicAssertion = {
    id: "must-not-use-facts",
    description: "No fact listed in mustNotUseFactIds is asserted in the output.",
    category: "grounding",
    run(output, context, _params): CriterionScore {
        const ids = context.fixture?.expected?.mustNotUseFactIds ?? [];
        if (ids.length === 0) return pass(this, this.id, "No forbidden fact ids; skipped.");
        const text = joined(output);
        if (!text) return pass(this, this.id, "No output; no forbidden facts asserted.");
        const asserted: SourceFact[] = [];
        for (const id of ids) {
            const f = context.factsById?.[id];
            if (!f) continue; // unknown id cannot be asserted
            if (factAsserted(text, f, 0.6)) asserted.push(f);
        }
        if (asserted.length === 0) {
            return pass(this, this.id, `None of ${ids.length} forbidden fact(s) asserted.`);
        }
        return fail(
            this,
            this.id,
            `Forbidden fact(s) asserted: ${asserted.map(f => f.id).join(", ")}.`,
            { evidence: asserted.map(f => `${f.id}: ${f.statement}`) }
        );
    },
};

export const noContradictoryFacts: DeterministicAssertion = {
    id: "no-contradictory-facts",
    description: "Output asserts no fact that conflicts with the fixture documents.",
    category: "grounding",
    run(output, context, _params): CriterionScore {
        if (context.fixture?.expected?.forbidContradictoryFacts === false) {
            return pass(this, this.id, "Contradiction check disabled; skipped.");
        }
        const bad = facts(context, "contradictory");
        if (bad.length === 0)
            return pass(this, this.id, "No contradictory facts defined; skipped.");
        const text = joined(output);
        if (!text) return pass(this, this.id, "No output; nothing contradictory asserted.");
        const hits = bad.filter(f => factAsserted(text, f, 0.6));
        if (hits.length === 0)
            return pass(this, this.id, `None of ${bad.length} contradictory fact(s) asserted.`);
        return fail(
            this,
            this.id,
            `Contradictory fact(s) asserted: ${hits.map(h => h.id).join(", ")}.`,
            { evidence: hits.map(h => `${h.id}: ${h.statement}`) }
        );
    },
};

export const noDistractorFacts: DeterministicAssertion = {
    id: "no-distractor-facts",
    description: "Output does not lean on facts that are true but irrelevant to this campaign.",
    category: "grounding",
    run(output, context, _params): CriterionScore {
        if (context.fixture?.expected?.forbidDistractorFacts !== true) {
            return pass(this, this.id, "Distractor check not enabled; skipped.");
        }
        const distractors = facts(context, "distractor").filter(
            f => !(f.relevantTo ?? []).includes(context.fixture?.id ?? "")
        );
        if (distractors.length === 0)
            return pass(this, this.id, "No distractor facts defined; skipped.");
        const text = joined(output);
        if (!text) return pass(this, this.id, "No output; no distractors used.");
        const hits = distractors.filter(f => factAsserted(text, f, 0.6));
        if (hits.length === 0)
            return pass(this, this.id, `None of ${distractors.length} distractor(s) used.`);
        return fail(this, this.id, `Distractor fact(s) used: ${hits.map(h => h.id).join(", ")}.`, {
            evidence: hits.map(h => `${h.id}: ${h.statement}`),
        });
    },
};

export const noUnsupportedNumerics: DeterministicAssertion = {
    id: "no-unsupported-numerics",
    description:
        "Every number in the output traces to a supported fact, document or product field.",
    category: "grounding",
    run(output, context, _params): CriterionScore {
        if (context.fixture?.expected?.forbidUnsupportedNumerics === false) {
            return pass(this, this.id, "Numeric check disabled; skipped.");
        }
        const text = joined(output);
        if (!text) return pass(this, this.id, "No output; no numeric claims.");
        // Score over UNIQUE numerics: repeating an unsupported number must not
        // raise the score.
        const used = [...new Set(extractNumerics(text))];
        if (used.length === 0) return pass(this, this.id, "No numeric claims present.");
        const allowed = supportedNumerics(context);
        const unsupported = used.filter(n => !allowed.has(n));
        if (unsupported.length === 0) {
            return pass(
                this,
                this.id,
                `All ${used.length} distinct numeric claim(s) traceable to source.`
            );
        }
        return partial(
            this,
            this.id,
            used.length - unsupported.length,
            used.length,
            `Unsupported numeric claim(s): ${unsupported.join(", ")}.`,
            { evidence: unsupported }
        );
    },
};

export const noUnsupportedSuperlatives: DeterministicAssertion = {
    id: "no-unsupported-superlatives",
    description: "Output contains no superlative or absolute claim.",
    category: "grounding",
    run(output, context, _params): CriterionScore {
        if (context.fixture?.expected?.forbidUnsupportedSuperlatives === false) {
            return pass(this, this.id, "Superlative check disabled; skipped.");
        }
        const text = joined(output);
        if (!text) return pass(this, this.id, "No output; no superlatives.");
        const hits = findSuperlatives(text);
        if (hits.length === 0) return pass(this, this.id, "No superlative or absolute claims.");
        return fail(this, this.id, `Superlative/absolute claim(s): ${hits.join(", ")}.`, {
            evidence: hits,
        });
    },
};

export const noHallucinatedProductNames: DeterministicAssertion = {
    id: "no-hallucinated-product-names",
    description: "Product-name-like spans in the output belong to the company.",
    category: "grounding",
    run(output, context, _params): CriterionScore {
        if (context.fixture?.expected?.forbidHallucinatedProductNames === false) {
            return pass(this, this.id, "Product-name check disabled; skipped.");
        }
        const text = joined(output);
        if (!text) return pass(this, this.id, "No output; nothing to check.");

        const allowed = new Set(
            [
                ...(context.company?.allowedProductNames ?? []),
                ...(context.company?.products ?? []).map(p => p.name),
                context.company?.name ?? "",
                ...(context.company?.products ?? []).flatMap(p => p.integrations),
                ...(context.company?.people ?? []).map(p => p.name),
                ...(context.company?.certifications ?? []),
            ]
                .filter(Boolean)
                .map(s => normalize(s))
        );

        // Names the fixture itself uses are recognised too: customer names in
        // proof points ("Cedar Ridge Terminal Railway"), audiences, markets and
        // anything appearing verbatim in the fixture documents.
        const recognisedTexts = [
            ...(context.company?.proofPoints ?? []),
            ...(context.company?.audiences ?? []).flatMap(a => [a.label, a.role ?? ""]),
            ...(context.company?.markets?.primary ?? []),
            ...(context.company?.markets?.verticals ?? []),
            ...(context.company?.markets?.geographies ?? []),
            ...(context.company?.differentiators ?? []),
            ...Object.values(context.documents ?? {}),
        ]
            .filter(Boolean)
            .map(s => normalize(s));

        const candidates = extractProductNameCandidates(text);
        const suspicious = candidates.filter(c => {
            const n = normalize(c);
            for (const a of allowed) {
                if (a.includes(n) || n.includes(a)) return false;
            }
            // Verbatim (case-insensitive) appearance in fixture text counts as
            // recognised — it cannot be a hallucination if the source uses it.
            for (const t of recognisedTexts) {
                if (t.includes(n)) return false;
            }
            return true;
        });

        if (suspicious.length === 0) {
            return pass(this, this.id, `All ${candidates.length} name-like span(s) recognised.`);
        }
        return partial(
            this,
            this.id,
            candidates.length - suspicious.length,
            Math.max(candidates.length, 1),
            `Unrecognised product-name-like span(s): ${suspicious.join(", ")}.`,
            { evidence: suspicious }
        );
    },
};

export const noCopiedSourceRuns: DeterministicAssertion = {
    id: "no-copied-source-runs",
    description: "Output does not copy a long verbatim run from a fixture document.",
    category: "grounding",
    run(output, context, params): CriterionScore {
        const limit =
            num(params, "maxCopiedSourceRunWords") ??
            context.fixture?.expected?.maxCopiedSourceRunWords ??
            null;
        if (limit === null) return pass(this, this.id, "No copy ceiling configured; skipped.");
        const text = joined(output);
        if (!text) return pass(this, this.id, "No output; nothing copied.");
        const sources = Object.values(context.documents ?? {});
        if (sources.length === 0) return pass(this, this.id, "No source documents; skipped.");
        const { length, excerpt } = longestSharedWordRun(text, sources);
        if (length <= limit) {
            return pass(this, this.id, `Longest shared run ${length} word(s), within ${limit}.`);
        }
        return fail(
            this,
            this.id,
            `Copied ${length} consecutive words from source (limit ${limit}).`,
            { evidence: [collapseWhitespace(excerpt).slice(0, 160)] }
        );
    },
};

/* ──────────────────────────────────────────────────────────────
 * Registry
 * ────────────────────────────────────────────────────────────── */

export const ASSERTIONS: readonly DeterministicAssertion[] = [
    nonEmptyOutput,
    platformMatchesFixture,
    minChars,
    maxChars,
    platformCharLimit,
    maxWords,
    variantCount,
    noDuplicateVariants,
    variantSimilarity,
    distinctOpeningHooks,
    hashtagLimit,
    emojiLimit,
    urlPolicy,
    questionLimit,
    mustMention,
    mustNotMention,
    requiredPhrases,
    requireDisclaimer,
    noProhibitedCompetitors,
    mustUseSupportedFacts,
    mustNotUseFacts,
    noContradictoryFacts,
    noDistractorFacts,
    noUnsupportedNumerics,
    noUnsupportedSuperlatives,
    noHallucinatedProductNames,
    noCopiedSourceRuns,
];

export const ASSERTION_REGISTRY: Readonly<Record<string, DeterministicAssertion>> =
    Object.fromEntries(ASSERTIONS.map(a => [a.id, a]));

export function getAssertion(id: string): DeterministicAssertion | undefined {
    return ASSERTION_REGISTRY[id];
}
