/**
 * Deterministic assertion tests.
 *
 * Covers validation requirements 3 and 13: every assertion returns a valid
 * CriterionScore, and each behaves correctly on positive, negative, empty and
 * malformed input.
 */

import { CriterionScoreSchema, type GeneratedOutput, type Fixture } from "@schema";
import {
    ASSERTIONS,
    buildEvalContext,
    getAssertion,
    loadEvalFixtures,
    runFixture,
} from "~/lib/agents/evals/campaign";

const fixtures = loadEvalFixtures();

function fixtureById(id: string): Fixture {
    const f = fixtures.find(x => x.id === id);
    if (!f) throw new Error(`test setup: fixture ${id} not found`);
    return f;
}

function out(platform: GeneratedOutput["platform"], ...messages: string[]): GeneratedOutput {
    return {
        platform,
        variants: messages.map((m, i) => ({
            variantId: `v${i}`,
            message: m,
            mediaType: null,
            angle: null,
        })),
    };
}

/** A well-formed post for the Meridian LinkedIn fixture. */
const GOOD_MERIDIAN_LINKEDIN = [
    "Cedar Ridge Terminal Railway moved on-time interchange performance from 71% to 88% over nine months.",
    "",
    "The part their dispatchers care about: when Meridian Dispatch re-plans, manual dispatcher edits are treated as hard constraints. The solver works around them instead of discarding them.",
    "",
    "Those figures are Cedar Ridge's own, measured on a 180-mile network.",
    "",
    "Where does your plan break down first?",
].join("\n");

describe("assertion registry", () => {
    it("registers every assertion under a unique id", () => {
        const ids = ASSERTIONS.map(a => a.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.length).toBeGreaterThanOrEqual(20);
    });

    it("resolves each assertion by id", () => {
        for (const a of ASSERTIONS) expect(getAssertion(a.id)).toBe(a);
    });

    it("returns undefined for an unknown id", () => {
        expect(getAssertion("does-not-exist")).toBeUndefined();
    });
});

// Requirement 3 + 13 (empty / malformed safety)
describe("every assertion returns a valid CriterionScore", () => {
    const fixture = fixtureById("meridian-linkedin-interchange-proof");
    const context = buildEvalContext(fixture);

    const cases: Array<[string, GeneratedOutput]> = [
        ["populated output", out("linkedin", GOOD_MERIDIAN_LINKEDIN)],
        ["empty variant list", out("linkedin")],
        ["whitespace-only message", out("linkedin", "   \n\t  ")],
        ["empty-string message", out("linkedin", "")],
    ];

    it.each(cases)("on %s", (_label, output) => {
        for (const assertion of ASSERTIONS) {
            const score = assertion.run(output, context, {});
            expect(() => CriterionScoreSchema.parse(score)).not.toThrow();
            expect(score.assertion).toBe(assertion.id);
            expect(score.explanation.length).toBeGreaterThan(0);
            expect(score.score).toBeGreaterThanOrEqual(0);
            expect(score.score).toBeLessThanOrEqual(1);
        }
    });

    it("survives structurally malformed output without throwing", () => {
        const malformed = [
            { platform: "linkedin" },
            { platform: "linkedin", variants: null },
            { platform: "linkedin", variants: [{}] },
            { platform: "linkedin", variants: [{ variantId: "v0", message: null }] },
            { platform: "linkedin", variants: [{ variantId: "v0" }] },
            {},
            null,
        ];

        for (const bad of malformed) {
            for (const assertion of ASSERTIONS) {
                expect(() =>
                    assertion.run(bad as unknown as GeneratedOutput, context, {})
                ).not.toThrow();
                const score = assertion.run(bad as unknown as GeneratedOutput, context, {});
                expect(() => CriterionScoreSchema.parse(score)).not.toThrow();
            }
        }
    });
});

describe("regression: the exemplar good post passes the full default run", () => {
    const fixture = fixtureById("meridian-linkedin-interchange-proof");
    const context = buildEvalContext(fixture);

    it("GOOD_MERIDIAN_LINKEDIN passes every default assertion", () => {
        const result = runFixture(fixture, out("linkedin", GOOD_MERIDIAN_LINKEDIN), context);
        expect(result.errors).toEqual([]);
        expect(
            result.blocking.map(b => `${b.criterionId}: ${b.explanation}`)
        ).toEqual([]);
        expect(result.passed).toBe(true);
    });

    it("recognises customer names from proof points and documents", () => {
        const score = getAssertion("no-hallucinated-product-names")!.run(
            out("linkedin", "Cedar Ridge Terminal Railway runs Meridian Dispatch."),
            context,
            {}
        );
        expect(score.passed).toBe(true);
    });
});

describe("platform-matches-fixture", () => {
    const fixture = fixtureById("meridian-x-dwell-metric");
    const context = buildEvalContext(fixture);

    it("passes when output and fixture agree", () => {
        const score = getAssertion("platform-matches-fixture")!.run(
            out("x", "Anything."),
            context,
            {}
        );
        expect(score.passed).toBe(true);
    });

    it("fails when the output declares a different platform", () => {
        const score = getAssertion("platform-matches-fixture")!.run(
            out("linkedin", "Anything."),
            context,
            {}
        );
        expect(score.passed).toBe(false);
        expect(score.explanation).toContain("linkedin");
        expect(score.explanation).toContain("x");
    });
});

describe("length assertions", () => {
    const fixture = fixtureById("meridian-x-dwell-metric");
    const context = buildEvalContext(fixture);

    it("passes a post inside the X limit", () => {
        const score = getAssertion("platform-char-limit")!.run(
            out("x", "Cedar Ridge cut average yard dwell from 14.2 hours to 11.6 hours."),
            context,
            {}
        );
        expect(score.passed).toBe(true);
    });

    it("fails a post over the X limit", () => {
        const score = getAssertion("platform-char-limit")!.run(
            out("x", "a".repeat(281)),
            context,
            {}
        );
        expect(score.passed).toBe(false);
        expect(score.explanation).toContain("280");
    });

    it("honours an explicit maxChars param over fixture config", () => {
        const score = getAssertion("max-chars")!.run(out("x", "abcdef"), context, {
            maxChars: 3,
        });
        expect(score.passed).toBe(false);
    });

    it("uses the fixture platform's limit even when the output is mislabeled", () => {
        // 500 chars is fine for LinkedIn but not for the fixture's platform (x).
        const score = getAssertion("platform-char-limit")!.run(
            out("linkedin", "a".repeat(500)),
            context,
            {}
        );
        expect(score.passed).toBe(false);
        expect(score.explanation).toContain("280");
    });

    it("counts graphemes, not UTF-16 code units", () => {
        // 200 astral emoji = 400 UTF-16 units but 200 user-perceived chars.
        const bluesky = fixtureById("tilde-bluesky-sparse-degradation");
        const blueskyCtx = buildEvalContext(bluesky);
        const score = getAssertion("platform-char-limit")!.run(
            out("bluesky", "😀".repeat(200)),
            blueskyCtx,
            {}
        );
        expect(score.passed).toBe(true);
    });

    it("weights each URL as 23 chars on X", () => {
        const longUrl = `https://example.com/${"a".repeat(400)}`;
        const score = getAssertion("platform-char-limit")!.run(
            out("x", `Cedar Ridge results here: ${longUrl}`),
            context,
            {}
        );
        expect(score.passed).toBe(true);
    });

    it("enforces a minimum character count from the fixture", () => {
        // meridian-linkedin-interchange-proof declares minChars: 200.
        const li = fixtureById("meridian-linkedin-interchange-proof");
        const liCtx = buildEvalContext(li);
        const a = getAssertion("min-chars")!;
        expect(a.run(out("linkedin", "Too short."), liCtx, {}).passed).toBe(false);
        expect(a.run(out("linkedin", GOOD_MERIDIAN_LINKEDIN), liCtx, {}).passed).toBe(true);
        expect(a.run(out("linkedin", "abcdef"), liCtx, { minChars: 5 }).passed).toBe(true);
    });
});

describe("variant assertions", () => {
    const fixture = fixtureById("meridian-linkedin-interchange-proof");
    const context = buildEvalContext(fixture);

    it("flags exact duplicate variants", () => {
        const score = getAssertion("no-duplicate-variants")!.run(
            out("linkedin", "Identical text here.", "Identical text here."),
            context,
            {}
        );
        expect(score.passed).toBe(false);
    });

    it("accepts distinct variants", () => {
        const score = getAssertion("no-duplicate-variants")!.run(
            out("linkedin", "First distinct message.", "Entirely separate wording."),
            context,
            {}
        );
        expect(score.passed).toBe(true);
    });

    it("flags near-duplicate variants above the similarity ceiling", () => {
        const a = "Cedar Ridge improved interchange performance with Meridian Dispatch this year.";
        const b = "Cedar Ridge improved interchange performance using Meridian Dispatch this year.";
        const score = getAssertion("variant-similarity")!.run(out("linkedin", a, b), context, {
            maxVariantSimilarity: 0.5,
        });
        expect(score.passed).toBe(false);
    });

    it("flags a repeated opening hook", () => {
        const score = getAssertion("distinct-opening-hooks")!.run(
            out(
                "linkedin",
                "Dwell is the problem. Here is one angle.",
                "Dwell is the problem. Here is a different angle."
            ),
            context,
            {}
        );
        expect(score.passed).toBe(false);
    });

    it("enforces variant count bounds", () => {
        const a = getAssertion("variant-count")!;
        expect(a.run(out("linkedin", "one"), context, { minVariants: 2 }).passed).toBe(false);
        expect(
            a.run(out("linkedin", "one", "two", "three"), context, { maxVariants: 2 }).passed
        ).toBe(false);
        expect(
            a.run(out("linkedin", "one", "two"), context, { minVariants: 1, maxVariants: 3 }).passed
        ).toBe(true);
    });
});

describe("formatting assertions", () => {
    const fixture = fixtureById("fernwood-reddit-field-story");
    const context = buildEvalContext(fixture);

    it("counts hashtags and fails above the reddit ceiling of zero", () => {
        const score = getAssertion("hashtag-limit")!.run(
            out("reddit", "Some thoughts on fieldwork. #fieldrecording"),
            context,
            {}
        );
        expect(score.passed).toBe(false);
    });

    it("does not count a bare number as a hashtag", () => {
        const score = getAssertion("hashtag-limit")!.run(
            out("reddit", "Take #1 was the one that mattered."),
            context,
            {}
        );
        expect(score.passed).toBe(true);
    });

    it("fails a forbidden URL", () => {
        const score = getAssertion("url-policy")!.run(
            out("reddit", "Read more at https://fernwoodaudio.example/blog"),
            context,
            {}
        );
        expect(score.passed).toBe(false);
    });

    it("passes when no URL is present and URLs are forbidden", () => {
        const score = getAssertion("url-policy")!.run(
            out("reddit", "No links here, just notes from a wet hillside."),
            context,
            {}
        );
        expect(score.passed).toBe(true);
    });

    it("counts emoji", () => {
        const score = getAssertion("emoji-limit")!.run(
            out("reddit", "Nice day out 🎙️🌧️"),
            context,
            { maxEmojis: 1 }
        );
        expect(score.passed).toBe(false);
    });

    it("enforces a question ceiling", () => {
        const score = getAssertion("question-limit")!.run(
            out("reddit", "What do you use? How do you carry it? Why?"),
            context,
            { maxQuestions: 2 }
        );
        expect(score.passed).toBe(false);
    });

    it("uses the fixture platform's hashtag ceiling even when the output is mislabeled", () => {
        // Force the platform path (no explicit maxHashtags) on a reddit fixture:
        // reddit allows 0 hashtags, linkedin would allow 3.
        const noExplicit: Fixture = {
            ...fixture,
            expected: { ...fixture.expected, maxHashtags: null },
        };
        const ctx = buildEvalContext(noExplicit);
        const score = getAssertion("hashtag-limit")!.run(
            out("linkedin", "Notes from the field. #fieldrecording"),
            ctx,
            {}
        );
        expect(score.passed).toBe(false);
    });

    it("skips the empty-output check when forbidEmptyOutput is false", () => {
        const relaxed: Fixture = {
            ...fixture,
            expected: { ...fixture.expected, forbidEmptyOutput: false },
        };
        const ctx = buildEvalContext(relaxed);
        const score = getAssertion("non-empty-output")!.run(out("reddit"), ctx, {});
        expect(score.passed).toBe(true);
        expect(score.explanation).toContain("skipped");
    });
});

describe("content assertions", () => {
    const fixture = fixtureById("meridian-linkedin-interchange-proof");
    const context = buildEvalContext(fixture);

    it("requires configured mentions", () => {
        const a = getAssertion("must-mention")!;
        expect(a.run(out("linkedin", "A post with no product named."), context, {}).passed).toBe(
            false
        );
        expect(a.run(out("linkedin", GOOD_MERIDIAN_LINKEDIN), context, {}).passed).toBe(true);
    });

    it("rejects forbidden terms", () => {
        const score = getAssertion("must-not-mention")!.run(
            out("linkedin", "Our revolutionary Meridian Dispatch platform for Cedar Ridge."),
            context,
            {}
        );
        expect(score.passed).toBe(false);
        expect(score.evidence.join(" ")).toContain("revolutionary");
    });

    it("rejects the regulatory boundary breach", () => {
        const score = getAssertion("must-not-mention")!.run(
            out("linkedin", "Meridian Dispatch issues movement authority for Cedar Ridge."),
            context,
            {}
        );
        expect(score.passed).toBe(false);
    });

    it("rejects a prohibited competitor mention", () => {
        const score = getAssertion("no-prohibited-competitors")!.run(
            out("linkedin", "Unlike RailCommand Pro, we keep manual edits."),
            context,
            {}
        );
        expect(score.passed).toBe(false);
    });

    it("requires a disclaimer where configured", () => {
        const nw = fixtureById("northwind-linkedin-audit-evidence");
        const nwCtx = buildEvalContext(nw);
        const a = getAssertion("require-disclaimer")!;

        expect(
            a.run(out("linkedin", "Northwind gives you HACCP audit evidence."), nwCtx, {}).passed
        ).toBe(false);

        expect(
            a.run(
                out(
                    "linkedin",
                    "Northwind supports your monitoring requirements; your HACCP plan remains yours."
                ),
                nwCtx,
                {}
            ).passed
        ).toBe(true);
    });
});

describe("grounding assertions", () => {
    const fixture = fixtureById("meridian-linkedin-interchange-proof");
    const context = buildEvalContext(fixture);

    it("detects an asserted contradictory fact", () => {
        const score = getAssertion("no-contradictory-facts")!.run(
            out(
                "linkedin",
                "Cedar Ridge reduced crew headcount by 20% after deploying Meridian Dispatch."
            ),
            context,
            {}
        );
        expect(score.passed).toBe(false);
    });

    it("passes copy that stays inside the source material", () => {
        const score = getAssertion("no-contradictory-facts")!.run(
            out("linkedin", GOOD_MERIDIAN_LINKEDIN),
            context,
            {}
        );
        expect(score.passed).toBe(true);
    });

    it("flags an unsupported numeric claim", () => {
        const score = getAssertion("no-unsupported-numerics")!.run(
            out("linkedin", "Meridian Dispatch cut dwell by 63.7% across 900 railroads."),
            context,
            {}
        );
        expect(score.passed).toBe(false);
        expect(score.evidence.length).toBeGreaterThan(0);
    });

    it("scores unsupported numerics over unique values, so repetition cannot raise the score", () => {
        const score = getAssertion("no-unsupported-numerics")!.run(
            out("linkedin", "900 railroads. Yes, 900 of them. Really: 900."),
            context,
            {}
        );
        expect(score.passed).toBe(false);
        expect(score.score).toBe(0);
    });

    it("fails facts listed in mustNotUseFactIds when they are asserted", () => {
        // msr-f-103 (crew headcount) is in this fixture's mustNotUseFactIds.
        const score = getAssertion("must-not-use-facts")!.run(
            out(
                "linkedin",
                "Cedar Ridge reduced crew headcount by 20% after deploying Meridian Dispatch."
            ),
            context,
            {}
        );
        expect(score.passed).toBe(false);
        expect(score.explanation).toContain("msr-f-103");
    });

    it("passes must-not-use-facts when no forbidden fact is asserted", () => {
        const score = getAssertion("must-not-use-facts")!.run(
            out("linkedin", GOOD_MERIDIAN_LINKEDIN),
            context,
            {}
        );
        expect(score.passed).toBe(true);
    });

    it("accepts numerics that appear in source documents", () => {
        const score = getAssertion("no-unsupported-numerics")!.run(
            out("linkedin", "On-time interchange moved from 71% to 88% at Cedar Ridge."),
            context,
            {}
        );
        expect(score.passed).toBe(true);
    });

    it("flags superlatives", () => {
        const score = getAssertion("no-unsupported-superlatives")!.run(
            out("linkedin", "The best scheduling engine in the industry, guaranteed."),
            context,
            {}
        );
        expect(score.passed).toBe(false);
    });

    it("flags a required supported fact that was not used", () => {
        const score = getAssertion("must-use-supported-facts")!.run(
            out("linkedin", "Meridian Dispatch is software for railroads. Cedar Ridge uses it."),
            context,
            {}
        );
        expect(score.passed).toBe(false);
    });

    it("detects long verbatim copying from a source document", () => {
        const copied =
            "Meridian Dispatch produces a conflict-checked movement plan across a rolling 72-hour horizon. The solver runs on every input change and typically returns a revised plan in under nine seconds for a 400-mile network.";
        const score = getAssertion("no-copied-source-runs")!.run(out("linkedin", copied), context, {
            maxCopiedSourceRunWords: 12,
        });
        expect(score.passed).toBe(false);
    });

    it("allows short incidental overlap with source documents", () => {
        const score = getAssertion("no-copied-source-runs")!.run(
            out("linkedin", "The movement plan holds up when reality intervenes."),
            context,
            { maxCopiedSourceRunWords: 12 }
        );
        expect(score.passed).toBe(true);
    });

    it("flags a hallucinated product name", () => {
        const score = getAssertion("no-hallucinated-product-names")!.run(
            out("linkedin", "Try Meridian Quantum Scheduler today."),
            context,
            {}
        );
        expect(score.passed).toBe(false);
    });

    it("accepts real product names", () => {
        const score = getAssertion("no-hallucinated-product-names")!.run(
            out("linkedin", "Meridian Dispatch and Meridian Yard share an account."),
            context,
            {}
        );
        expect(score.passed).toBe(true);
    });
});

describe("sparse-company degradation", () => {
    const fixture = fixtureById("tilde-bluesky-sparse-degradation");
    const context = buildEvalContext(fixture);

    it("rejects invented scale", () => {
        const result = runFixture(
            fixture,
            out("bluesky", "Tilde CLI is trusted by over 4,000 engineering teams worldwide."),
            context
        );
        expect(result.passed).toBe(false);
        expect(result.blocking.length).toBeGreaterThan(0);
    });

    it("rejects invented pricing", () => {
        const result = runFixture(
            fixture,
            out("bluesky", "Tilde CLI starts at $29 per seat per month."),
            context
        );
        expect(result.passed).toBe(false);
    });

    it("accepts honest, generic copy", () => {
        const result = runFixture(
            fixture,
            out(
                "bluesky",
                "Tilde CLI is a command-line tool for keeping things in sync. Early days, and we are still figuring out where it fits. Try it and tell us what breaks."
            ),
            context
        );
        expect(result.errors).toEqual([]);
        expect(result.passed).toBe(true);
    });
});

describe("runner", () => {
    it("reports an unknown assertion id as an error rather than throwing", () => {
        const fixture: Fixture = {
            ...fixtureById("meridian-bluesky-manual-edits"),
            criteria: [
                {
                    assertion: "not-a-real-assertion",
                    id: null,
                    enabled: true,
                    severity: "error",
                    params: {},
                },
            ],
        };
        const context = buildEvalContext(fixture);
        const result = runFixture(fixture, out("bluesky", "anything"), context);
        expect(result.errors.some(e => e.includes("not-a-real-assertion"))).toBe(true);
        expect(result.passed).toBe(false);
    });

    it("treats warning-severity failures as non-blocking", () => {
        const fixture: Fixture = {
            ...fixtureById("meridian-bluesky-manual-edits"),
            criteria: [
                {
                    assertion: "max-chars",
                    id: "soft-length",
                    enabled: true,
                    severity: "warning",
                    params: { maxChars: 1 },
                },
            ],
        };
        const context = buildEvalContext(fixture);
        const result = runFixture(fixture, out("bluesky", "far too long for one char"), context);
        expect(result.scores[0]?.passed).toBe(false);
        expect(result.blocking).toHaveLength(0);
        expect(result.passed).toBe(true);
    });

    it("skips disabled criteria", () => {
        const fixture: Fixture = {
            ...fixtureById("meridian-bluesky-manual-edits"),
            criteria: [
                {
                    assertion: "max-chars",
                    id: "off",
                    enabled: false,
                    severity: "error",
                    params: { maxChars: 1 },
                },
            ],
        };
        const context = buildEvalContext(fixture);
        const result = runFixture(fixture, out("bluesky", "long enough to fail"), context);
        expect(result.scores).toHaveLength(0);
        expect(result.passed).toBe(true);
    });

    it("produces an overall score between 0 and 1 for every fixture", () => {
        for (const f of fixtures) {
            const ctx = buildEvalContext(f);
            const result = runFixture(f, out(f.platform, "placeholder copy for scoring"), ctx);
            expect(result.overallScore).toBeGreaterThanOrEqual(0);
            expect(result.overallScore).toBeLessThanOrEqual(1);
        }
    });
});
