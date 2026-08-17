/**
 * Shared fixture corpus and scenarios for the live meeting harnesses.
 *
 * One corpus, used by both `run-live-meeting.ts` and
 * `compare-meeting-vs-single.ts`, so a comparison between a meeting and a
 * single agent is a comparison of the *method* and not of what each was
 * allowed to read.
 *
 * The passages carry real, distinct figures on purpose. Distinctness is what
 * makes attribution possible after the fact: a number that appears in exactly
 * one passage is evidence that passage was actually drawn on, which is how
 * breadth-of-evidence is measured without a human reading the output.
 */

export interface CorpusPassage {
  label: string;
  text: string;
}

export const CORPUS: CorpusPassage[] = [
  {
    label: "Q2 retention review · p.2",
    text: "Logo churn was 4.1% in Q2 across 1,240 active accounts, up from 3.2% in Q1. The increase is concentrated in accounts under $500 MRR, which churned at 6.8%. Accounts above $2,000 MRR churned at 0.9%.",
  },
  {
    label: "Q2 retention review · p.5",
    text: "Exit survey responses (n=88) cite 'could not tell whether the product was working' as the leading reason for cancellation at 41%, ahead of price at 22% and missing integrations at 18%.",
  },
  {
    label: "Engineering capacity plan · p.1",
    text: "The platform team has 3 engineers and 6 sprint-weeks of uncommitted capacity this quarter. The billing migration is already committed and consumes 4 of those weeks. Any new surface requires a schema change to the events table, which has no backfill tooling.",
  },
  {
    label: "Instrumentation audit · p.3",
    text: "Product usage events are captured for 61% of active workspaces. Coverage gaps are concentrated in self-serve accounts created before March, where the analytics SDK was never installed. There is no server-side event stream.",
  },
  {
    label: "Pipeline snapshot · p.1",
    text: "Four enterprise prospects totalling $310k ARR have named 'usage reporting for our admins' as a requirement in the current cycle. Two are in security review and expect delivery within the quarter.",
  },
  {
    label: "Pricing experiment memo · p.2",
    text: "The Growth tier at $99/month accounts for 58% of new self-serve revenue. An admin-reporting feature was tested as a Growth-tier upsell in March and 12 of 140 trials converted, a 8.6% attach rate.",
  },
];

export interface Scenario {
  id: string;
  title: string;
  objective: string;
  agenda: string[];
  /**
   * What this scenario is testing. Stated so a result that contradicts it is
   * legible as a finding rather than quietly reinterpreted afterwards.
   */
  hypothesis: string;
  /** Whether a room is expected to beat one agent here. */
  expectMeetingWins: boolean;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "contested-tradeoff",
    title: "Retention dashboard — build or defer",
    objective:
      "Decide whether to build the customer-facing retention dashboard this quarter, and name who owns the next step",
    agenda: [
      "Is churn actually the problem the data describes?",
      "What would v1 have to include, and what is explicitly cut?",
      "What does it cost in engineering weeks, and what does it displace?",
      "Does it unblock revenue this quarter?",
    ],
    hypothesis:
      "The evidence genuinely conflicts — revenue pressure pulls one way, capacity and data quality pull the other. A single voice resolves that tension privately and reports the settled version.",
    expectMeetingWins: true,
  },
  {
    id: "multi-constraint-commit",
    title: "Enterprise commitment without breaking the migration",
    objective:
      "Decide what we can commit to the four enterprise prospects this quarter without displacing the billing migration, and name who owns it",
    agenda: [
      "What did the prospects actually ask for?",
      "What can be delivered inside the uncommitted capacity?",
      "Is the underlying data good enough to promise a report on?",
      "What do we tell them, and who tells them?",
    ],
    hypothesis:
      "Three hard constraints from three different sources must all hold simultaneously. Missing any one produces a confident answer that is wrong.",
    expectMeetingWins: true,
  },
  {
    id: "single-fact-lookup",
    title: "Q2 churn summary",
    objective:
      "Summarise Q2 churn: the rate, the direction versus Q1, and which segment drove it",
    agenda: ["What was the rate?", "Which segment drove it?"],
    // The null case. A comparison that only contains questions the tool is
    // good at is marketing, not evidence.
    hypothesis:
      "One passage answers this completely. A room should show no advantage and should cost far more — if it 'wins' here, the metric is measuring verbosity.",
    expectMeetingWins: false,
  },
];

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

const FIGURE_PATTERN = /\b\d+(?:[.,]\d+)?%?\b/g;

/** Every numeric claim in a piece of text, deduplicated. */
export function figuresIn(text: string): Set<string> {
  return new Set([...text.matchAll(FIGURE_PATTERN)].map((m) => m[0]));
}

/**
 * Figures that appear in exactly one passage.
 *
 * Only these can attribute an output to a source: "3" appears in several
 * passages and proves nothing, whereas "6.8" appears only in the retention
 * review and so is evidence that passage was read.
 */
export function distinctiveFigures(corpus: CorpusPassage[]): Map<string, string> {
  const owners = new Map<string, Set<string>>();
  for (const passage of corpus) {
    for (const figure of figuresIn(passage.text)) {
      const set = owners.get(figure) ?? new Set<string>();
      set.add(passage.label);
      owners.set(figure, set);
    }
  }

  const unique = new Map<string, string>();
  for (const [figure, labels] of owners) {
    if (labels.size === 1) unique.set(figure, [...labels][0]!);
  }
  return unique;
}

export interface EvidenceReport {
  /** Numeric claims made in the output. */
  figuresUsed: number;
  /** Claims that appear somewhere in the corpus. */
  traceable: number;
  /** Claims that appear nowhere in the corpus — invented, or arithmetic. */
  untraceable: string[];
  /** Distinct source passages the output demonstrably drew on. */
  passagesUsed: string[];
}

/** How much of the evidence an output actually engaged with, and how honestly. */
export function reportEvidence(text: string, corpus: CorpusPassage[]): EvidenceReport {
  const haystack = corpus.map((p) => p.text).join(" ").toLowerCase();
  const unique = distinctiveFigures(corpus);
  const figures = figuresIn(text);

  const untraceable: string[] = [];
  const passages = new Set<string>();
  let traceable = 0;

  for (const figure of figures) {
    if (haystack.includes(figure.toLowerCase())) {
      traceable++;
      const owner = unique.get(figure);
      if (owner) passages.add(owner);
    } else {
      untraceable.push(figure);
    }
  }

  return {
    figuresUsed: figures.size,
    traceable,
    untraceable,
    passagesUsed: [...passages],
  };
}
