---
"@launchstack/pipelines": patch
---

Keyless runs read five companies at once instead of one after another, through
a new optional `enrichConcurrency` on `DistributionPorts`. Each company's own
site is still read one page at a time. Fixture runs and the worker's durable
job are unchanged.
