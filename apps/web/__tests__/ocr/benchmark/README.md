# OCR Benchmark Harness — LaunchStack vs Onyx

Compares LaunchStack's OSS OCR stack (Marker + Docling via `ocr-worker`) against Onyx's ingestion pipeline on a fixed suite of documents.

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
# LaunchStack (assumes ocr-worker is already running)
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
