# Founder Weekly Review Evaluator Baseline

## Purpose

This benchmark evaluates the Founder Weekly Review generation pipeline against predefined evidence scenarios.

It measures:
- citation correctness
- evidence coverage
- unsupported claims
- source type correctness
- handling of empty or conflicting evidence

## Running the Benchmark

```bash
pnpm eval:founder-weekly-review
```

This regenerates the benchmark output at:

packages/features/src/founder-weekly-review/benchmarks/baseline-output.json

## Coverage

The benchmark currently includes:
- valid evidence-backed reports
- missing/invalid citations
- unsupported shipped claims
- source type misuse
- conflicting evidence
- empty evidence states
- malformed payload handling

## Summary

- Benchmark cases: 19
- Passing cases: 19
- Failing cases: 0
- Overall score: 0.482
- Hard failures: 9

## Metrics

| Metric | Score |
|---|---:|
| Citation validity | 0.88 |
| Citation coverage | 1.0 |
| Unsupported claim rate | 0.059 |
| Source type violation rate | 0.118 |
| Evidence coverage | 0.716 |
| Empty section correctness | 1.0 |

## Weakest Cases

1. invalid_citation_report
   - Failure: invalid_citation

2. invalid_missing_source_citation
   - Failure: invalid_citation

3. founder_context_as_customer_feedback
   - Failure: invalid_source_type

## Common Failure Categories

- invalid_source_type: 3
- invalid_citation: 2
- malformed_payload: 2
- unsupported_shipped_claim: 2

## Recommended Improvements

### Prompt improvements
- Encourage explicit evidence references for factual claims.
- Avoid converting founder context into customer feedback.

### Evidence improvements
- Include stronger shipped signals from GitHub/document sources.
- Preserve source type metadata.

### Validator improvements
- Improve semantic matching for evidence coverage.
- Add stricter detection of unsupported generalizations.

## Notes

Passing cases indicate that expected evaluator behavior matched the benchmark expectations.

Hard failures represent intentionally invalid scenarios (for example malformed payloads or invalid citations) that the evaluator correctly detected.