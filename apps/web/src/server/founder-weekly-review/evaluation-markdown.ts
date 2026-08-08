import type { GeneratedReviewEvaluation } from "@launchstack/features/founder-weekly-review/benchmarks";

export function renderFounderWeeklyReviewEvaluationMarkdown(
  evaluation: GeneratedReviewEvaluation
) {
  return `
# Founder Weekly Review Evaluation

## Deterministic Evaluation

${
  evaluation.deterministic
    ? `
Score: ${evaluation.deterministic.overallScore}

Failures:

${
  evaluation.deterministic.failures.length
    ? evaluation.deterministic.failures
        .map(
          (failure) =>
            `- ${failure.category}: ${failure.explanation}`
        )
        .join("\n")
    : "- None"
}
`
    : "Malformed payload"
}


## LLM Grader

${
  evaluation.llmGrader
    ? `
Overall Score: ${evaluation.llmGrader.overallScore}

## Dimensions

- Groundedness: ${evaluation.llmGrader.dimensions.groundedness}
- Materiality: ${evaluation.llmGrader.dimensions.materiality}
- Temporal Accuracy: ${evaluation.llmGrader.dimensions.temporalAccuracy}
- Synthesis Quality: ${evaluation.llmGrader.dimensions.synthesisQuality}
- Actionability: ${evaluation.llmGrader.dimensions.actionability}


## Findings

${evaluation.llmGrader.findings
  .map(
    (finding) =>
      `### ${finding.section}
${finding.severity}: ${finding.explanation}`
  )
  .join("\n\n")}


## Summary

${evaluation.llmGrader.summary}
`
    : "No LLM grader result"
}
`;
}