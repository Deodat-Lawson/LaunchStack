# Atlas pilot rollback runbook
Fictional Harborlight Analytics document. Maintainer: Luis Moreno, infrastructure.
Updated: November 13, 2026, 20:00 UTC. Service: Atlas pilot.

## Coverage
Execution operator: infrastructure primary on call. Accountable rollback decision owner: UNASSIGNED. Elena declined the proposed assignment due to leave; the infrastructure rotation has not accepted decision authority. Escalation contact: Jonah Reed for coordination only.

## Trigger and procedure
A confirmed cross-tenant export, repeated authorization failures, or sustained export errors above 5 percent for ten minutes warrants escalation to the decision owner. After authorization, disable the Atlas pilot flag, drain export workers, and restore the last approved image, atlas-pilot.179. Keep audit logs and record the incident timeline. Do not delete saved views during rollback.

## Verification and limits
Check a disabled tenant cannot open Atlas, worker queue depth falls, and legacy reports remain accessible. The staging flag-disable exercise on November 11 completed in seven minutes. Restoring image 179 has not been rehearsed against the current schema. There is no production rollback timing measurement in this record.
