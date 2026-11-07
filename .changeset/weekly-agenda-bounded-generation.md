---
"@launchstack/llm": patch
"@launchstack/pipelines": patch
---

Add the optional Contract v1 weekly-agenda generator with bounded evidence selection,
source-linked suggestions, protection for reviewed topics, and deterministic fallback.
Expose a single-attempt structured model helper that disables inherited SDK retries
and caps request timeouts without mutating the shared model. The host must explicitly
install the generation adapter; this release does not activate it automatically.

Restore the generated Contract v1 migration snapshot and declare the existing
foreign-key names explicitly so schema validation agrees with the committed SQL.
