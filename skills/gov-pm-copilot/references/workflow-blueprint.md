# Workflow Blueprint

## Main chain

1. PolicyRadar discovers a new policy source.
2. PolicyRadar extracts structured policy fields and lifecycle status.
3. EntityMatcher scores candidate entities against hard and soft constraints.
4. PolicyInterpreter creates an opportunity strategy and risk summary.
5. WorkflowOrchestrator opens an opportunity card and routes owner confirmation.
6. ProposalComposer assembles application materials from verified source data.
7. ReviewAuditor scores the draft and returns revision guidance.
8. WorkflowOrchestrator packages the final version, logs the audit trail, and waits for human submission approval.

## Mandatory human checkpoints

- Entity confirmation
- Application direction confirmation
- Budget and KPI confirmation
- Final submission approval

## Timeout and escalation principles

- Time-sensitive opportunities require deadline-based reminders.
- Missing materials trigger owner reminders and escalation.
- Skips, rollbacks, and overrides must be logged.
