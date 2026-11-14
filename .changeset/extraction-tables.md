---
"@launchstack/pipelines": minor
---

Add the extraction vertical (`@launchstack/pipelines/extraction`): read the same fields out of many documents into one table, a row per document and a cell per field, each value with the quote and page it rests on. Reads whole documents in batches, keeps a value only when its quote appears in the text, types values (text, number, date, yes/no, list), and can take a second look at image files with a vision model.
