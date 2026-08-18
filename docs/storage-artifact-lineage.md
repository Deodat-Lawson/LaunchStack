# Storage artifact lineage

The storage manifest identifies each physical object. `storage_artifact_edges` records why a second object exists, so cleanup and orphan review can distinguish a source file from a derived artifact without parsing URLs.

## Group policy

Every ingestion flow chooses one deletion scope:

- **Full-document group** — the document row and every manifest object owned by it. A full-document request includes legacy document-owned rows and all rows owned by its versions.
- **Version-only group** — one `document_versions` row and the objects registered to that version. Deleting a version never claims sibling versions or the document's current pointer.

Group identifiers are propagated through processing events as `artifactGroupId` when a flow has a stable external group (for example a crawl or archive). The database does not use a URL as a group key: manifest ownership and the parent/child edge graph remain authoritative.

## Edge types

Writers use the following stable edge types:

- `zip-child`: extracted file derived from an uploaded ZIP
- `zip-summary`: generated project summary derived from an uploaded ZIP
- `audio-transcript`: transcript derived from uploaded audio
- `video-transcript`: transcript derived from an external video URL (no stored source ObjectRef)
- `supersedes`: edited DOCX replacing an earlier document object
- `derived-document`: generic derived document when a more specific type is unavailable

Each edge is written in the same transaction as the child manifest row. Replays are idempotent on `(parent_object_id, child_object_id)`. `ocrJobs` and `uploadBatchFiles` URL columns remain audit aids; they do not define lineage.

## Propagation rules

1. An adapter returns an `ObjectRef` at write time.
2. The writer registers that ref before the owning document/version is active.
3. A derived writer registers its child first, then writes the edge to the parent manifest object.
4. A version-only child carries the version ID; a full-document child carries the document ID.
5. External source URLs without a manifest parent are retained as historical references for orphan classification and are never promoted into an edge automatically.
