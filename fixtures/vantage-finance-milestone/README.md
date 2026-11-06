# Finance milestone fixtures

Synthetic source content only. The host materializes both documents in the isolated database and supplies their actual exact-version refs to the replay factory. No source identifiers or authenticated authority are fabricated here.

`corrected` is deliberately authored deterministic output. `omission` is a new synthetic semantic negative control, not a historical capture. `malformed` is a schema negative control. Variants are test harness configuration and must never be selected by public request input.

The replay uses the repaired V2 runner, normalizer, and context guards. The manual checklist verifies exact cited source statements and null assignment fields only; it is not a model Judge, broad semantic entailment proof, or evidence of improved model quality. Output bounds use the existing js-tiktoken/o200k_base proxy tokenizer; no actual provider mapping is asserted.
