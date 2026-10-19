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

Persist complete draft dependencies, including uncited retrieval and quoteless
profile inputs. Preserve them through rewrites and manual edits; legacy generated
prose without proof requires a redraft under constrained scopes.

Store durable library-source snapshots in the existing evidence JSONB, with
explicit provenance for new manual answers. Legacy evidence arrays remain
readable/editable but are excluded from generation until replaced by a proven
snapshot or an explicitly new manual entry. No SQL migration is required.

Clearing text removes citation and gap annotations, not its source provenance.
This prevents both false source attribution and accidental declassification when
the author restores or replaces the text.
