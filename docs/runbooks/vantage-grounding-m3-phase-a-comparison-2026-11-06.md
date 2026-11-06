# Vantage M3: Phase A comparison — 2026-11-06

This comparison uses the completed local Phase A repair in `C:/Users/junku/.codex/worktrees/9499/LaunchStack` at HEAD `b809e8248e4c65eb2e6e8c4aa05b52003e352aa9`, including its uncommitted repair files, against the clean M2 baseline in `C:/Users/junku/.codex/worktrees/d6a4/LaunchStack` at HEAD `8ad8c7fa185db7b54d5d406538be9a164e988c27`. It does not compare ongoing M3 edits. The Phase A checkout had modified and untracked files; its report identifies them as local, uncommitted work.

## Comparison and source stability

The SHA-256 values below were measured before and after read-only comparison and remained unchanged. Values are raw file hashes; line-ending differences explain differing hashes where the content comparison is otherwise identical. A `git diff --no-index --ignore-space-at-eol` comparison found no differences in the files marked identical. The two decision-generation files are divergent as described below.

| File | Phase A SHA-256 | M2 SHA-256 | Classification |
| --- | --- | --- | --- |
| `experiments/sophia-generation-v0.ts` | `0A5161637F52E6701AE3D7D554ADE1C1ED4041B13F539FCB04A83882B797A0F3` | `23CDB236B7F8F9162F9939DDE1A96402BAE7C0E89B02CF98756127FBFDCC0AC4` | Identical ignoring line endings |
| `experiments/sophia-generation-v0.test.ts` | `FC4A3F85B8B5316040E846E1709AE0F1844CBD3643E2DB6DF2E8E0A18C54F134` | `E9A2EAFE1A34C2415DF2E7CC46F191F4CE455A76570E6EB77CAD5F15FC0A391D` | Identical ignoring line endings |
| `experiments/source-usage-v0.ts` | `07C842F1D812DEBEB3281E6B4B6B7C8DE75AA3CB9095370258DF21307149FAF7` | `DE2888A09F74DA5E0D8AD6EF62CA60B88E470A0A5AAE70D78F5CE0631905A07A` | Identical ignoring line endings |
| `experiments/source-usage-v0.test.ts` | `A1A4354B52160928650C6EBEC21826E26F4B13F6EF92B58C6E4F1B02F4CC1883` | `7B282066786F75D3DB2C6A53AF86B39FAFB282870FDED856EBBF32C5988FB50E` | Identical ignoring line endings |
| `experiments/decision-generation-v2.ts` | `1CE06EF8B1C1E092D14B9BE57A4A37CEE0342C7B1E5E7ACCEA72F63790A48825` | `919F14D8E0F940B145569EB66CC2EB3024B11E73DF9770BC2EAE14424BAB4819` | M2 adds compact role-pair profile |
| `experiments/decision-generation-v2.test.ts` | `175DF0E7303444A6E279685162785CD57AB068FCB2562AA26AD249B0AC9529F6` | `4DD5BC3B7CF477AF01B0F53E6CC669DAF9912BF99DF273587B095333341A896C` | M2 adds profile tests |
| `validate-generation-v2.ts` | `596F1E50826D8C9CC46E9768D00DE15F32D37F311DF25BF830CB976220FDEEDA` | `257622D6F24814D5421CC067344AFED1B75CC473802B603683490A21BE99DD27` | Identical ignoring line endings |
| `validate-generation-v2.test.ts` | `A33F4692AD3467F7AE77F6CB957FF4EDA0D7A6915AB2C332FB915A129922C14F` | `E9EA2A8026156582757E3A9A226C256C8AEABA261A7310896734B8D1B6149EB2` | Identical ignoring line endings |
| `validation/judge.ts` | `F48776491F2422D51A40D74E317FDC126BA3E86DF0BC98AA896084C3ADDECD25` | `A4279C3B0658CF39EE439A7C331CA65A2635F77985A0B43EE01C95B81744943D` | Identical ignoring line endings |
| `validation/judge-evidence.ts` | `881FDEB3B372920877C227DD0069C449C0E3DC6047D571E977480B3CE18322B6` | `40786C064768575C6369E5B080138377DA9B8F97C80BD0D2F2F5C1825688A5EF` | Identical ignoring line endings |
| `validation/judge-evidence.test.ts` | `FA6DE11E7DF9FA5F93D8E38BAEC49EA8C568CB759C9626118DA788FA28A92A65` | `1BFC0B1113D09A001850C8C1D1A05559B5ACD0B72C4BC8AF8A894B0DA5C7A796` | Identical ignoring line endings |
| `evaluation-live/pilot-context.ts` | `B57E4952E7657C1A5A7308421EFC4ECE4BC2ECA4F4C4E7E289EF693E64D3C20C` | `EE3F43F62E075231DDC2E7F02B9C8592AB6D40DCA3C4F52954063F1DFF247942` | Identical ignoring line endings |
| `evaluation-live/evaluation-completeness.ts` | `E4F8A9E429DEC2B7B74CC993DC9D1250A38C89376619A228225F870B43D554DD` | `AA84060C651182E6425448BB4FED3C0EB31506000E4E18A233F5187F0C3FA1E1` | Identical ignoring line endings |
| `evaluation-live/evaluation-completeness.test.ts` | `126F1BBBE534F1FAEF4AA540112C7E10104BB27AFFDAA92527E21D4F5DB75BC8` | `3BF8230C2CDF690C69917EA85328A3A9FCC4429E72940D81652520801198B392` | Identical ignoring line endings |
| `pipelines/scripts/vantage-phase-a-offline-audit.mjs` | `EF8935F7B264A8CE87BF77E0574B4B93CA471A54FC3B694E6AA8C31081BA0EDD` | `E8830DC59437A04A7EBBE4E6CE26F0646B525BFF861AAAEDBCB78A85D253088F` | Identical ignoring line endings |
| `docs/runbooks/vantage-phase-a-offline-repair-2026-11-02.md` | `692D32199E5A07D72F95D6A88DCAD04E035EDF8E9961B5490AEE9EEC8FDE967D` | `6D5CE35EDF06418B6826721EB12EE00908864C82F55327F315FCB15BE684520F` | Identical ignoring line endings |

Paths in the first fourteen rows are relative to `pipelines/src/vantage/`. The completed Phase A preservation manifest had SHA-256 `61D9628192E01024ACBB9BCFFD7A2BBBAF8DFD3264397515B74B0AF9B9E81C26` before and after reading. This check does not rehash the historical pilot artifacts.

## Applicable repair and profile choice

M2 already includes full-context guidance and review-only source-use diagnostics, schema-derived field-limit and citation-namespace guidance in the default V2 prompt, bounded delivery diagnostics, narrow attributed-source-date validation, input-bound Judge source/output ID schemas, verbatim quote validation, and fail-closed completeness assessment with an optional trusted finite-source inventory. Their associated inspected tests are present. No overwrite from the dirty Phase A checkout is needed.

M2 additionally introduces `role-pair-m2` transport compaction and role-binding logic in `decision-generation-v2.ts`, with additional tests. Its compact prompt omits several explicit Phase A instructions retained by the default V2 prompt, including field-limit reminders and evidence-seeking detail. Finance M3 should use the **default V2 Finance profile**, not the M2 compact role-pair profile. Preserve M2 role-pair behavior and tests; do not copy the older file over it. The relevant real-model transport seams are `createDecisionExperimentV2` and the shared `invokeStructuredAttempt`; Judge evidence schema and downstream exact-quote checks remain distinct. Source-use diagnostics are review signals, not semantic entailment; completeness proof is trusted host input, not a model or browser assertion.

## Historical evidence and boundaries

The completed Phase A report records 14 original attempts, 13 HTTP responses and one timeout, with no Phase B dispatch. It reports offline replay continuing to reject the malformed JSON, wrong citation namespace, overlong field, fabricated quote and wrong Judge IDs. The Finance output remains structurally valid but semantically incomplete; the missing experiment-window request remains a historical coverage gap. The policy-date response normalized offline under the narrow date rule without changing its original rejection or scores. The report's 761 passed tests and 54 PostgreSQL skips are historical results, not tests executed for this comparison. Offline repairs do not establish improved live model coverage or Judge calibration.

This comparison did not modify either baseline, read original capture files, regrade results, call a provider, fetch remote data, or run tests. No live Pilot is authorized by this comparison.
