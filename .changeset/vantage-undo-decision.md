---
"@launchstack/pipelines": minor
---

Vantage: `undoDecision` takes back a decision just recorded — clears the
topic's decision and removes the commitment it opened, in one transaction,
and never removes a commitment opened from another topic. It backs the Undo
on the web app's one-click Commit.
