---
"@launchstack/conversion": patch
---

Remove the `./heading-chunker` export. Its source was deleted in September, so
importing it could only fail.
