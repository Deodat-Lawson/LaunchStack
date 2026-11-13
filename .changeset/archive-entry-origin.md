---
"@launchstack/conversion": minor
---

Archive expansion carries an archive's origin down to the files it extracts.
When the archive's row has `originUrl` and `originEntryBaseUrl` in its
`ocr_metadata` (the GitHub import writes both), each extracted file gets its
own `originUrl` (the base plus its path, without a GitHub zipball's top
folder) and the project summary gets the archive's. New exports:
`sharedTopFolder` and `archiveEntryOriginUrl`.
