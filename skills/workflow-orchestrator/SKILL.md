---
name: workflow-orchestrator
description: Workflow orchestration skill for government project management. Use when Codex needs to coordinate status transitions, human checkpoints, handoffs, reminders, escalation logic, versioning, and audit traceability across the full government application lifecycle from policy discovery to submission readiness.
---

# WorkflowOrchestrator

Use this skill whenever the task involves cross-stage coordination, routing, or process control.

## Responsibilities

- Drive state transitions across all modules.
- Define human approval gates and timeout rules.
- Generate project opportunity cards, todo queues, and escalation prompts.
- Manage versioning, audit records, and final packaging checkpoints.

## Guardrails

- Never auto-approve the final submission gate.
- Record every skip, rollback, and override with an explicit reason.
- Require human confirmation for budgets, legal statements, and final release status.
- Keep workflow status vocabulary standardized.

## Read These References

- `references/orchestration-states.md`
- `references/handoff-rules.md`
- `references/workflow-orchestrator-source.md`
