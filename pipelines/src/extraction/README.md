# Extraction

One set of fields read out of many documents. A table is a list of fields
(the columns) and a set of documents (the rows); each cell is what one
document says for one field, with the quote and page it came from.

| File        | What it holds                                                       |
| ----------- | ------------------------------------------------------------------- |
| `types.ts`  | The contract: fields, cells, records, the ports a host provides     |
| `schema.ts` | Drizzle tables `extraction_tables` and `extraction_rows`            |
| `engine.ts` | `extractDocumentCells` (one document) and `advanceTable` (one unit) |
| `db.ts`     | `createExtractionStore()` and the executor's lease helpers          |

## How a document is read

`extractDocumentCells` reads the whole document, however long. Passages are
packed in order into calls of about 12,000 characters, each labelled `[p3]`
with its page; a passage is split only when it alone is longer than that.

Each call returns a flat list of answers (`field`, `found`, `value`, `quote`,
`passage`). An answer is kept only when its quote appears in the text, under
the same tolerant matching as the company profile (whitespace, quote marks,
hyphenation). An answer whose quote is not there is stored as not found.
Values arrive as strings and are coerced by the field's type.

Across calls, the first grounded answer in reading order wins; a `list` field
collects its items from every call. If a call fails the document fails,
because cells built from part of a document would say "not found" about text
nobody read.

An image whose text left a field unanswered is handed to
`ports.readImageFields` with only the missing fields. Nothing else ever is.

## How a table runs

`advanceTable(ports, tableId)` performs one unit: it claims up to
`ports.concurrency` pending rows, reads them in parallel, and returns
`{ state: "advanced", processed }`. A document that cannot be read fails its
own row. When no row is pending or running the table ends: `failed` only if
every row failed, otherwise `done`. The host calls it until it returns
`finished` or `skipped`.

The engine never calls `store.releaseRunningRows`. A host that takes over a
table after a stale lease should call it once, before its first unit, so rows
left `running` by a process that died are read again.

## Tests

```
pnpm --filter @launchstack/pipelines exec vitest run src/extraction
```
