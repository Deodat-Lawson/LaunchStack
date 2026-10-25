import { describe, expect, it } from "vitest";
import { eventStateContradictions, type GroundingText } from "./event-state-grounding-v1";
import type { PackItem } from "./types";

const request =
    "The customer requested moving the synthetic pilot start from November 20 to November 27.";
const moved = "The customer moved the synthetic pilot start from November 20 to November 27.";
const confirmation = "The synthetic pilot start was confirmed for November 27.";
const productionPlan = "Deployment of release v17 to production was planned.";
const productionDeployment = "Deployment of release v17 to production was completed.";
const source = (text: string, ref = "ev:request"): PackItem => ({
    ref,
    kind: "evidence",
    label: "Synthetic event-state account",
    date: "2026-11-13",
    text,
});
const report = (summary = ""): GroundingText => ({ summary, topics: [], enhancements: [] });
const topic = () => ({
    title: "A synthetic weekly discussion",
    facts: [],
    conflicts: [],
    whyItMatters: "",
    rationale: "",
});
const check = (output: GroundingText, sources = [source(request)]) =>
    eventStateContradictions(output, sources, "2026");

describe("narrow event-state grounding guards explicit source-bound promotions", () => {
    it.each([
        "summary",
        "topics.0.title",
        "topics.0.whyItMatters",
        "topics.0.rationale",
        "topics.0.facts.0",
        "topics.0.conflicts.0",
        "enhancements.0.text",
        "enhancements.0.rationale",
    ])("checks asserted event state in %s", field => {
        const output = report();
        if (field === "summary") output.summary = moved;
        else if (field.startsWith("enhancements"))
            output.enhancements = [
                {
                    text: field.endsWith("text") ? moved : "A separate suggestion.",
                    rationale: field.endsWith("rationale") ? moved : "A separate suggestion.",
                    refs: ["ev:request"],
                },
            ];
        else {
            const value: GroundingText["topics"][number] = topic();
            if (field.endsWith("title")) value.title = moved;
            else if (field.endsWith("whyItMatters")) value.whyItMatters = moved;
            else if (field.endsWith("rationale")) value.rationale = moved;
            else if (field.includes("conflicts"))
                value.conflicts = [{ text: moved, refs: ["ev:request"] }];
            else value.facts = [{ text: moved, refs: ["ev:request"] }];
            output.topics = [value];
        }
        const before = JSON.stringify(output);
        expect(check(output)).toContainEqual({
            code: "event-state-promotion",
            field,
            sourceRefs: ["ev:request"],
        });
        expect(JSON.stringify(output)).toBe(before);
    });

    it("retains requested language without treating the planned event as confirmed", () => {
        expect(check(report(request))).toEqual([]);
    });

    it("allows a later explicit confirmation from a separate selected source", () => {
        expect(
            check(report(confirmation), [source(request), source(confirmation, "ev:confirmed")])
        ).toEqual([]);
    });

    it("allows request and later confirmation in the same source body", () => {
        const body =
            "On November 10, the customer requested moving the synthetic pilot start from November 20 to November 27. On November 13, the customer confirmed November 27 as the synthetic pilot start.";
        expect(check(report(confirmation), [source(body)])).toEqual([]);
    });

    it("a fact cannot borrow confirmation from a source outside that fact's citations", () => {
        const output = report();
        output.topics = [{ ...topic(), facts: [{ text: confirmation, refs: ["ev:request"] }] }];
        expect(check(output, [source(request), source(confirmation, "ev:confirmed")])).toEqual([
            {
                code: "event-state-promotion",
                field: "topics.0.facts.0",
                sourceRefs: ["ev:request"],
            },
        ]);
        output.topics = [
            {
                ...topic(),
                facts: [
                    {
                        text: confirmation,
                        refs: [
                            { ref: "ev:confirmed", label: "Confirmed date", date: "2026-11-13" },
                        ],
                    },
                ],
            },
        ];
        expect(check(output, [source(request), source(confirmation, "ev:confirmed")])).toEqual([]);
    });

    it("confirmation for another date does not confirm the requested date", () => {
        expect(
            check(report(confirmation), [
                source(request),
                source("The synthetic pilot start was confirmed for November 28.", "ev:other-date"),
            ])
        ).toContainEqual({
            code: "event-state-promotion",
            field: "summary",
            sourceRefs: ["ev:request"],
        });
    });

    it("normalizes ISO source dates and abbreviated claim dates consistently", () => {
        const result = check(
            report("The customer moved the synthetic pilot start from Nov. 20 to Nov. 27."),
            [
                source(
                    "The customer requested moving the synthetic pilot start from 2026-11-20 to 2026-11-27."
                ),
            ]
        );
        expect(result).toHaveLength(1);
    });

    it("does not promote a production plan using an actual staging deployment", () => {
        const sources = [
            source(productionPlan, "ev:production-plan"),
            source("Deployment of release v17 to staging was completed.", "ev:staging-deployed"),
        ];
        expect(check(report(productionDeployment), sources)).toEqual([
            { code: "event-state-promotion", field: "summary", sourceRefs: ["ev:production-plan"] },
        ]);
        expect(
            check(report("Deployment of release v17 to staging was completed."), sources)
        ).toEqual([]);
    });

    it("allows actual production deployment when the same version and environment are explicitly supported", () => {
        expect(
            check(report(productionDeployment), [
                source(productionPlan),
                source(productionDeployment, "ev:deployed"),
            ])
        ).toEqual([]);
    });

    it("deployment evidence for another version cannot confirm the planned release", () => {
        expect(
            check(report(productionDeployment), [
                source(productionPlan),
                source(
                    "Deployment of release v18 to production was completed.",
                    "ev:other-release"
                ),
            ])
        ).toContainEqual({
            code: "event-state-promotion",
            field: "summary",
            sourceRefs: ["ev:request"],
        });
    });

    it("does not upgrade an actual deployment to independent verification without that event state", () => {
        expect(
            check(report("Deployment of release v17 to production was verified."), [
                source(productionDeployment),
            ])
        ).toContainEqual({
            code: "event-state-promotion",
            field: "summary",
            sourceRefs: ["ev:request"],
        });
    });

    it("preserves explicit non-approval rather than dropping its negation", () => {
        const denial = "Deployment of release v18 to production was not approved.";
        expect(
            check(report("Deployment of release v18 to production was approved."), [source(denial)])
        ).toContainEqual({
            code: "event-state-promotion",
            field: "summary",
            sourceRefs: ["ev:request"],
        });
        expect(check(report(denial), [source(denial)])).toEqual([]);
    });

    it("quoted historical confirmation cannot establish an independent current confirmation", () => {
        const body =
            'An older AI report said "The synthetic pilot start was confirmed for November 27." ' +
            request;
        expect(check(report(confirmation), [source(body)])).toHaveLength(1);
    });

    it.each([
        'The earlier AI report said "The synthetic pilot start was confirmed for November 27."',
        "The historical AI interpretation says the synthetic pilot start was confirmed for November 27.",
        "If the customer moved the synthetic pilot start to November 27, a separate review would be useful.",
        "Whether the customer moved the synthetic pilot start to November 27 is unknown.",
        "Was the synthetic pilot start confirmed for November 27?",
    ])("abstains on nonassertive or explicitly historical language: %s", text => {
        expect(check(report(text))).toEqual([]);
    });

    it("abstains rather than inventing a relationship to another named pilot", () => {
        expect(
            check(report(moved), [
                source(
                    "The customer requested moving the supplier pilot start from November 20 to November 27."
                ),
            ])
        ).toEqual([]);
    });

    it("does not collapse different subjects that both contain 'for the customer'", () => {
        const sources = [
            source(
                "The operator requested moving the pilot for the customer from November 20 to November 27."
            ),
        ];
        const output = report(
            "The operator moved the workshop for the customer from November 20 to November 27."
        );
        expect(check(output, sources)).toEqual([]);
    });

    it("does not treat a suffix condition as an asserted scheduling confirmation", () => {
        expect(
            check(
                report(
                    "The synthetic pilot start was scheduled for November 27 if funding was approved."
                )
            )
        ).toEqual([]);
    });

    it("a conditional source cannot confirm an unconditional scheduling claim", () => {
        const sources = [
            source(request),
            source(
                "The synthetic pilot start was scheduled for November 27 if funding was approved.",
                "ev:conditional-plan"
            ),
        ];
        expect(check(report(confirmation), sources)).toContainEqual({
            code: "event-state-promotion",
            field: "summary",
            sourceRefs: ["ev:request"],
        });
    });

    it("verification of a production dashboard cannot confirm a deployment event", () => {
        const sources = [
            source(productionPlan),
            source(
                "Release v17 was verified after reviewing the production dashboard.",
                "ev:dashboard-review"
            ),
        ];
        expect(check(report(productionDeployment), sources)).toContainEqual({
            code: "event-state-promotion",
            field: "summary",
            sourceRefs: ["ev:request"],
        });
    });

    it("completion of a release backup in production cannot confirm deployment", () => {
        const sources = [
            source(productionPlan),
            source(
                "The operator completed release v17 backup in production.",
                "ev:backup-completed"
            ),
        ];
        expect(check(report(productionDeployment), sources)).toContainEqual({
            code: "event-state-promotion",
            field: "summary",
            sourceRefs: ["ev:request"],
        });
    });

    it("abstains when production describes a metrics review rather than deployment's environment", () => {
        const metrics = source(
            "The operator approved release v17 after production metrics review.",
            "ev:metrics-review"
        );
        const approved = report("Deployment of release v17 to production was approved.");
        expect(check(approved, [metrics])).toEqual([]);
        // If an actual lower-state production plan is also supplied, unrelated metrics
        // approval cannot authorize promoting that plan to a deployment approval.
        expect(check(approved, [source(productionPlan), metrics])).toContainEqual({
            code: "event-state-promotion",
            field: "summary",
            sourceRefs: ["ev:request"],
        });
    });

    it.each([
        "No evidence establishes that the synthetic pilot start was confirmed for November 27.",
        "It is not established that the synthetic pilot start was confirmed for November 27.",
        "No one reports that the synthetic pilot start was confirmed for November 27.",
        "Nobody says that the synthetic pilot start was confirmed for November 27.",
        "We cannot establish that the synthetic pilot start was confirmed for November 27.",
        "The account does not show that the synthetic pilot start was confirmed for November 27.",
    ])("an epistemic denial neither asserts nor authorizes confirmation: %s", denial => {
        expect(check(report(denial))).toEqual([]);
        expect(
            check(report(confirmation), [source(request), source(denial, "ev:epistemic-denial")])
        ).toContainEqual({
            code: "event-state-promotion",
            field: "summary",
            sourceRefs: ["ev:request"],
        });
    });

    it.each([
        "According to the historical AI report, the synthetic pilot start was confirmed for November 27.",
        "The synthetic pilot start was confirmed for November 27, according to the historical AI report.",
    ])("historical attribution at either end is not a current assertion: %s", historical => {
        expect(check(report(historical))).toEqual([]);
        expect(
            check(report(confirmation), [
                source(request),
                source(historical, "ev:historical-attribution"),
            ])
        ).toContainEqual({
            code: "event-state-promotion",
            field: "summary",
            sourceRefs: ["ev:request"],
        });
    });

    it.each(["verified", "completed", "executed"])(
        "an artifact %s for production is not a production deployment event",
        state => {
            const artifact = source(
                "Release v17 was " + state + " for production.",
                "ev:artifact-state"
            );
            expect(
                check(report(productionDeployment), [source(productionPlan), artifact])
            ).toContainEqual({
                code: "event-state-promotion",
                field: "summary",
                sourceRefs: ["ev:request"],
            });
        }
    );

    it.each(["build", "version"])(
        "completion of %s 9 does not establish deployment of release 9",
        namespace => {
            const sources = [
                source("Deployment of release 9 to production was planned."),
                source(
                    "Deployment of " + namespace + " 9 to production was completed.",
                    "ev:other-namespace"
                ),
            ];
            expect(check(report("Release 9 was deployed to production."), sources)).toContainEqual({
                code: "event-state-promotion",
                field: "summary",
                sourceRefs: ["ev:request"],
            });
        }
    );

    it("rejects a moved assertion even when a new em-dash clause expresses uncertainty about a different review", () => {
        const output = report(
            moved +
                "—this does not establish whether a technical acceptance review happened elsewhere."
        );
        expect(check(output)).toContainEqual({
            code: "event-state-promotion",
            field: "summary",
            sourceRefs: ["ev:request"],
        });
    });

    it("keeps an em-dash funding condition attached instead of promoting a hypothetical move to an assertion", () => {
        expect(check(report(moved + "— if funding was approved."))).toEqual([]);
    });

    it("does not call absence of a recognized source event semantic validation", () => {
        expect(
            check(report("The customer approved all business plans."), [
                source("One reviewer supplied an unrelated note."),
            ])
        ).toEqual([]);
        // No detected contradiction is deliberately not a claim of semantic support.
    });
});
