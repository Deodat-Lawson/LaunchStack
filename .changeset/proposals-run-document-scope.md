---
"@launchstack/pipelines": patch
---

Keep proposal generation within the stored run writer's current document scope.
Inline and worker execution resolve active membership at execution time; a worker
event cannot substitute a more privileged writer. Scope resolution failures do
not fall back to workspace-wide access.

Require explicit document scope for run contexts, draft inputs, retrieval and
organisation-profile loading. Filter profile provenance and library answers to
readable same-workspace sources, check stored request sources, and refuse
rewrite/review reuse of drafts backed by inaccessible evidence or saved answers.
Rewrite and review continue to use existing evidence without fresh retrieval.
