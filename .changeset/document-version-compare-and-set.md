---
"@launchstack/orchestration": minor
---

`createDocumentVersionLifecycle` can refuse a stale save. It accepts an
optional `expectedCurrentVersionId`. Under the document row lock it already
takes, the version is created only if the document's current version still
matches. Otherwise it throws the new exported `StaleDocumentVersionError`
(carrying the document id and its actual current version). A retry with a
creation key that already exists returns that version, as before, without the
check. Callers that leave the field out are unaffected.
