# RAG-Multi-Corpus → Vantage evaluation inputs

This is an **offline benchmark-data integration**, not a live retrieval/generation
evaluation or an application feature. It adds no production routes, database tables,
company accounts, migrations, or model calls, and it modifies no existing files. It
does not import or depend on any Vantage application code.

**Implemented here:** a pinned, hash-verified download of three upstream files; an
offline CSV importer with strict validation; a deterministic 20-case pilot with its
source rows; an evaluation input schema; and tests.

**Not implemented (future work):** corpus ingestion, retrieval or generation runs,
scoring, Vantage-specific annotations, and any connection to production Vantage
inputs. See [How Vantage could evaluate these inputs later](#how-vantage-could-evaluate-these-inputs-later)
and [Limitations](#limitations-and-extension-points).

## Source and license

- Upstream: <https://github.com/udayallu/RAG-Multi-Corpus>
- Pinned commit: `39071af3f4dd25e59f5c59a6f9b6e8e99cd643b3`.
- Query file: `datasets/Dataset categories - queries_01122025.csv`.
- Original CSV SHA-256: `48c319a45a911cc3973e3f4e8ed34eeb39fa2eb49331a04f1433552d541c5457`.
- Upstream citation: `@Allu2025RAGMultiCorpus`.
- Authors credited by the README: Uday Allu, Sonu Kedia, Tanmay Odapally.
- Upstream repository license: MIT, copyright (c) 2025 UDAY ALLU. The exact
  pinned license is included in [LICENSE.upstream.txt](./LICENSE.upstream.txt).
  Keep that notice with redistributed samples. These external fixture contents
  retain the upstream license; LaunchStack's own license does not replace it.
- The upstream README describes synthetic organizations. Its label/count summary is
  not identical to the CSV. This importer uses the actual pinned CSV and retains its
  original labels, including rare labels.

> **Licensing note for maintainer review before merging.** The upstream repository
> ships an MIT `LICENSE`, which permits redistribution with its copyright and
> permission notice; that notice is preserved verbatim in `LICENSE.upstream.txt`.
> Separately, the upstream README's "License" section says only: "This dataset is
> provided for research and experimentation. All content is synthetic and does not
> represent real organizations or confidential information." That sentence contains
> no explicit restriction, and the README's citation section refers to "research or
> product evaluation", but it is not a formal license and its intent is not stated.
> This contribution commits only a 20-case evaluation sample (about 31 KB) for test
> and evaluation use, not the full dataset or corpus. No separate permission has been
> sought from or granted by the upstream authors, and no legal review has been done.
> LaunchStack maintainers should confirm this is acceptable before merging.

[source-lock.json](./source-lock.json) records immutable download URLs and SHA-256
digests for the CSV, README, and license. Downloading verifies all three; importing
verifies the original CSV bytes before assigning this provenance. A changed CSV is
rejected, even if only its newline encoding changed. Review and update the pin and
associated fixtures deliberately when adopting a different upstream revision.

## What is actually supplied

The CSV has exactly these columns:

| Upstream column  | Normalized field              | Meaning                                                              |
| ---------------- | ----------------------------- | -------------------------------------------------------------------- |
| Enterprise Name  | `enterprise`                  | Original synthetic organization label; not a LaunchStack company ID  |
| Query Type       | `queryType`                   | Original category, without remapping or inferred labels              |
| Query            | `question`                    | Original question, without rewriting                                 |
| Supporting Facts | `groundTruth.supportingFacts` | JSON array of `{filename, text}` source labels and evidence passages |

There is **no separate official reference answer**. `groundTruth.referenceAnswer`
is explicitly `null`. Supporting passages are benchmark-provided labels, not
automatically verified truth. No user role, permission, priority, company-specific
label, reporting period, or expected weekly agenda is inferred from them.

The upstream CSV contains 1,252 records and 1,577 supporting-fact occurrences.
There are 177 exact duplicate records, leaving **1,075 unique cases**. All records
are structurally valid under this adapter. Duplicate merging is opt-in and retains
all original row locations. Without `--duplicates merge-identical`, import fails
at the first duplicate instead of silently dropping it.

The checked-in pilot contains **20 unique cases**, covering all five enterprises
and all eleven observed categories:

| Enterprise           | Pilot cases |
| -------------------- | ----------- |
| Aventro Motors       | 4           |
| Cendara University   | 4           |
| Cloudway 24          | 5           |
| Velvera Technologies | 3           |
| ZX Bank              | 4           |

Categories: Analytical, Boolean, Comparative, Descriptive, Eligibility, Eligibility
Inquiry, Open-Ended, Procedural, Safety, Supporting, and Temporal. The four rare
labels are retained even though they do not appear in the README's category table.
Counts of available categories/enterprises in `pilot.json` are **after deduplication**.

## Obtain only the required source files

From the repository root with the existing workspace dependencies installed, obtain
approval for network access when your environment requires it, then run:

```sh
RAG_BENCHMARK_DIR="$(mktemp -d /tmp/launchstack-rag-multi-corpus.XXXXXX)"
pnpm exec tsx pipelines/scripts/benchmarks/import-rag-multi-corpus.ts --download "$RAG_BENCHMARK_DIR"
```

The download directory must already exist **outside the repository**. The command
fetches only `queries.csv`, `LICENSE`, and `README.md` (about 613 KB total), never the
full multi-format corpus. It refuses to overwrite existing files and resolves the
directory's real path to reject symlinks into the repository. A failed partial
download can be retried in a new empty directory.

You can also obtain these three files using the exact URLs in `source-lock.json`
through an approved download mechanism. Retain their original bytes. Keep this
cache locally for later offline regeneration; `/tmp` storage may be cleaned up by
the operating system. No credentials or environment-file loading are needed.

## Reproduce the fixtures offline

After downloading, this command performs **no network requests** and writes nothing:

```sh
pnpm exec tsx pipelines/scripts/benchmarks/import-rag-multi-corpus.ts \
  --input "$RAG_BENCHMARK_DIR/queries.csv" \
  --output fixtures/vantage-benchmarks/rag-multi-corpus/pilot.json \
  --source-sample fixtures/vantage-benchmarks/rag-multi-corpus/pilot-source.csv \
  --count 20 --duplicates merge-identical --check
```

To generate fresh outputs for review, use new paths (existing files are never
overwritten):

```sh
RAG_OUTPUT_DIR="$(mktemp -d /tmp/launchstack-rag-normalized.XXXXXX)"
pnpm exec tsx pipelines/scripts/benchmarks/import-rag-multi-corpus.ts \
  --input "$RAG_BENCHMARK_DIR/queries.csv" \
  --output "$RAG_OUTPUT_DIR/pilot.json" \
  --source-sample "$RAG_OUTPUT_DIR/pilot-source.csv" \
  --count 20 --duplicates merge-identical
diff -u fixtures/vantage-benchmarks/rag-multi-corpus/pilot.json "$RAG_OUTPUT_DIR/pilot.json"
diff -u fixtures/vantage-benchmarks/rag-multi-corpus/pilot-source.csv "$RAG_OUTPUT_DIR/pilot-source.csv"
```

`--count` can select another positive size up to the unique-case count for local
experiments. Keep large exports outside the tracked repository. The committed
pilot stays small. No command in this workflow performs a live agent evaluation.

## Evaluation schema and reproducibility

The TypeScript/Zod contract is in
`pipelines/scripts/benchmarks/rag-multi-corpus.ts`. It is an evaluation input
schema, **not** a production Vantage input type or HTTP DTO. Converting these cases
directly into production Vantage inputs would mean inventing fields the dataset does
not supply, so no such conversion is included.

`pilot.json` has:

- `schemaVersion`: `vantage-external-benchmark-v1`.
- `provenance`: repository, commit, source path/hash, license/hash/notice location,
  and upstream citation. This applies to every case in the bundle.
- `selection`: versioned algorithm, explicit duplicate policy, source/unique/duplicate
  counts, and available/selected enterprise and category counts.
- `cases`: stable ID, original enterprise/category/question, benchmark ground truth,
  all original source-row locations, and `vantageAnnotations: null`.

The ID is `rag-multi-corpus:` plus the full SHA-256 of the UTF-8 JSON encoding of:

```text
["rag-multi-corpus-case-v1", enterprise, queryType, question,
 [[filename, text], ...]]
```

No case trimming, Unicode normalization, paraphrasing, repeated JSON unescaping,
or evidence reordering occurs. Standard CSV and JSON transport escaping is decoded
once. Evidence order and repeated passages are preserved. The record position and
revision do not enter the ID, so reordering the file does not change IDs; changing
the content does. Distinct IDs do not guarantee questions are semantically unrelated.

`recordNumber` counts nonblank logical CSV records with the header as record 1;
`startLine` identifies the physical starting line in the original file. Multiline
quoted fields are supported. Original locations change if the source file is
rearranged, even when IDs and selected case order remain stable.

Selection algorithm `coverage-balanced-sha256-v1` repeatedly chooses the case that:

1. Adds the most previously unseen enterprise/category labels.
2. Has the least represented enterprise, then category, then enterprise/category pair.
3. Has the lexicographically smallest full case ID when still tied.

Comparisons use fixed string ordering, not locale settings or randomness. Output
contains no wall-clock timestamp, absolute local paths, or machine-specific data.

`pilot-source.csv` includes only original records represented by selected cases,
including their duplicate occurrences, in source order. CSV quoting is re-encoded;
every decoded cell, including the original JSON-encoded Supporting Facts field,
is preserved. This is a **derived subset**, not the original pinned CSV: its hash
differs and it cannot be passed to the pinned importer. Offline tests use it to
compare normalized fields to upstream sample records without downloading anything.

Malformed CSV, unexpected/duplicate headers, wrong field counts, invalid facts JSON,
empty fields, extra evidence keys, and ID collisions fail the import. Duplicate
normalized IDs, content/ID mismatches and invalid fixture schemas are rejected.
All rows are validated before selecting or writing a pilot; invalid later rows are
not hidden by sampling. Failures exit nonzero and do not log source passages.

## Tests and checks

```sh
pnpm --filter @launchstack/pipelines exec vitest run scripts/benchmarks/rag-multi-corpus.test.ts
pnpm --filter @launchstack/pipelines typecheck
pnpm exec eslint pipelines/scripts/benchmarks/*.ts
pnpm exec prettier --check pipelines/scripts/benchmarks/*.ts fixtures/vantage-benchmarks/rag-multi-corpus/*.json fixtures/vantage-benchmarks/rag-multi-corpus/README.md
```

Tests use synthetic malformed records and the real checked-in subset. They cover
CSV/JSON edge cases, exact content preservation, stable IDs, duplicates, deterministic
selection, schema/provenance validation, license integrity and fixture serialization.
Two upstream records (539 and 1165) are embedded verbatim with expected values and IDs
decoded by Python's standard `csv`/`json` modules. They check `pilot.json` against an
oracle this importer did not produce. Selection is tested on synthetic pools larger
than the pick, each built so that one scoring rule (coverage, enterprise, category,
pair, ID tie-break) alone decides the outcome. CLI `--check` additionally reproduces
the selection from the complete pinned CSV.

**CI status:** all 45 tests pass locally, but the current CI workflow
(`.github/workflows/CI.yml`) does not run the `@launchstack/pipelines` test suite, so
these tests do not run automatically. Run them with the commands above. Adding the
pipelines package to CI is a separate change. `--check` needs the downloaded source
files and is a manual step.

## How Vantage could evaluate these inputs later

Use an isolated evaluation workspace, not production data. A future harness can
submit `question` to retrieval and compare retrieved sources/passages against
`groundTruth.supportingFacts`. Do not provide these labeled passages to the
retriever as its search input; doing so would leak the expected evidence.

For a retrieval benchmark, first acquire and index the actual corpus at the same
revision, resolve the enterprise/filename references to real document versions,
and define retrieval metrics and source matching. This integration has **not**
downloaded those documents or verified that every passage matches a source file.
Filenames remain opaque dataset labels, not trusted paths or authorized document IDs.

Generation can later be evaluated for support by the passages, with a clearly
defined rubric. The passages are not official reference answers, so an exact-answer
score cannot be honestly computed from this CSV alone. Role recognition and weekly
agenda quality also need additional labels and a separate evaluation design.

Keep validated Vantage annotations in a **separate sidecar file**, keyed by case ID
and dataset revision, with reviewer, review date, justification and evaluation-only
scope. A future adapter must validate these before joining them to cases. Until
then, leave `vantageAnnotations` null. Never turn an enterprise label into a real
workspace, a filename into a document permission, or a query category into a user role.

Treat all imported text as untrusted data. Embedded instructions must not control
tools or override evaluation instructions. Do not train/tune on this pilot and then
report it as held-out performance; duplicate and near-duplicate leakage must also
be addressed when designing train/test splits.

## Limitations and extension points

- This is a coverage-oriented 20-case smoke-test set, not a statistically representative
  evaluation of the full benchmark. All 11 labels fit, but not all 39 enterprise/category
  combinations do. Rare categories are intentionally overrepresented.
- Exact duplicate rows are detectable; near-duplicates and factual errors are not
  adjudicated. The full 1,075 unique cases are normalized in memory, not committed.
- No corpus ingestion, model invocation, permission mapping, reference-answer generation,
  role labeling, weekly-agenda scoring, or live performance results are included.
- The CSV parser operates in memory; this adapter targets the pinned ~606 KB file,
  not arbitrarily large datasets or every spreadsheet dialect.
- To support EnterpriseRAG-Bench, LongMemEval or FinanceBench, first inspect each
  real schema and license, pin its source artifacts, and add a separate adapter and
  license notice. Reuse deterministic selection where appropriate. Version/extend
  the evaluation schema for genuine answer labels, dialogue history, or other supplied
  evidence instead of squeezing them into invented RAG-Multi-Corpus fields. Keep
  dataset-specific ID namespaces and label provenance. Those integrations are not
  implemented or licensed by this change.
