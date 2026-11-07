# OCR Benchmark Harness — LaunchStack vs Onyx

Compares LaunchStack's OCR stack against Onyx's ingestion pipeline on a fixed suite of documents. LaunchStack reads PDFs and images in its shared order (`packages/conversion/src/ocr-processing/provider-order.ts`): Azure Document Intelligence when configured, Docling (docling-serve behind `services/document-converter`) when Azure fails or is absent, then Landing AI / Datalab, with the PDF's own text layer last. To benchmark Docling alone, set `OCR_DEFAULT_PROVIDER=DOCLING` and leave the Azure key unset. (The old `ocr-worker` and its Marker alias were removed by ADR-004.)

## Fixture categories

| Category | Count | What it tests |
|---|---|---|
| `scanned-pdf/` | 5 | OCR quality on scanned / photographed PDFs |
| `digital-pdf/` | 5 | Digital PDFs with complex tables, multi-column |
| `office/` | 5 | DOCX / PPTX / XLSX — format coverage |
| `mixed/` | 5 | Handwriting, receipts, multi-column academic |

Each fixture has a matching `ground-truth/<name>.md` with the expected markdown.

## Running

```bash
# LaunchStack (assumes the app, document-converter and, for Docling, docling-serve are running)
bun __tests__/ocr/benchmark/run.ts --target=launchstack

# Onyx (spins up onyxdotapp/onyx-backend via docker-compose)
bun __tests__/ocr/benchmark/run.ts --target=onyx

# Emit a side-by-side report
bun __tests__/ocr/benchmark/report.ts
```

## Metrics

- **Text Levenshtein**: character-level distance from ground truth, normalized by length (lower = better).
- **Table cell F1**: set-based F1 on `row|col|value` triples.
- **Format coverage**: did it produce *any* text at all? (1 / 0)
- **Wall-clock ms**: end-to-end latency per document.

## Adding fixtures

Drop the file in the right category directory and write the ground truth to `ground-truth/<filename>.md`. The harness picks it up automatically.
