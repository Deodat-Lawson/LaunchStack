---
"@launchstack/pipelines": minor
---

Add the Google Drive connector to the connectors vertical: a thin Drive v3
fetch client, Picker-scoped discovery/collect/sync under the `KnowledgeSink`
contract, and export rules for Google-native files, exported at
`@launchstack/pipelines/connectors/google-drive`. The shared connector
contract widens `KnowledgeItem.content` to `string | Uint8Array` (with
`contentByteLength`/`contentToBuffer` helpers) so remote connectors can carry
binary formats; text-only sinks must narrow and reject bytes.
