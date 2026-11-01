# Future Weekly Brief contract proposal - not implemented

The unified review currently derives presentation from existing saved summaries, complete fact/conflict statements and exact source refs. No Generation or persistence contract was amended.

A separately reviewed future output could supply:

- `headline`: approximately 15 words, no stronger event state than the cited source supports.
- `brief`: approximately two complete sentences, preserving attribution, missing-evidence limits and differing populations.
- `keyFigures`: optional structured values with labels, units, populations/sample scope, date and exact authorized source/version references.

These fields need explicit approval, schema/version compatibility, model-output validation, token-budget review and regeneration/review-state preservation tests. Numerical highlights must not imply comparability just because numbers share a unit. Missing approval documentation must not become rejection or absence of approval elsewhere.

Required tests before activation: heterogeneous/no-summary reports, uncertain/negated states, distinct samples, unreviewed profiles, superseded dates, source revocation/version drift, multilingual sentence boundaries and immutable saved human decisions. Keep the existing full report as the audit record. The present frontend extractor is deliberately conservative and cannot guarantee semantic entailment or select the globally highest-value issue.
