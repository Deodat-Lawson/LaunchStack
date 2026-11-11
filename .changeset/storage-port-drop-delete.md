---
"@launchstack/runtime": minor
---

`StoragePort` no longer has `delete(urlOrKey)`. Nothing in the engine called
it, and the host implementation behind it could not delete database-backed or
Vercel Blob objects and sent S3 deletes to the wrong key. Hosts delete stored
objects through their own reference-based lifecycle instead.
