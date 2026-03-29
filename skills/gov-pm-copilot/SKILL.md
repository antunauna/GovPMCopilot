---
name: gov-pm-copilot
description: Composite enterprise skill system for end-to-end government project automation. Use when Codex needs to coordinate the full workflow across policy discovery, entity qualification matching, policy interpretation, proposal drafting, review auditing, and workflow orchestration for government funding, subsidy, industrial, innovation, or compliance-driven project applications.
---

# GovPMCopilot

Use this skill as the primary entry point when the task spans multiple stages of government project management rather than a single isolated step.

## Do This First

- Determine whether the user needs the full chain or only one module.
- If only one module is needed, route conceptually to the relevant child skill:
  - `policy-radar`
  - `entity-matcher`
  - `policy-interpreter`
  - `proposal-composer`
  - `review-auditor`
  - `workflow-orchestrator`
- If the request spans discovery through submission readiness, keep this skill active and orchestrate the sequence.

## Core Workflow

1. Use `policy-radar` to discover, validate, classify, and track the policy source.
2. Use `entity-matcher` to compare qualified legal entities against hard eligibility constraints.
3. Use `policy-interpreter` to convert policy text into an executable application strategy.
4. Use `workflow-orchestrator` to create an opportunity card, assign owners, and define checkpoints.
5. Use `proposal-composer` to draft the required application materials from verified enterprise inputs.
6. Use `review-auditor` to run pre-submission review, scoring, and remediation guidance.
7. Return control to `workflow-orchestrator` for final packaging, versioning, and audit logging.

## Operating Principles

- Treat official government sources as the default authority.
- Keep every conclusion traceable to policy text, structured fields, or verified enterprise data.
- Use rules, not free-form generation, for hard eligibility gates.
- Mark uncertain facts as `needs verification` instead of inferring them.
- Require human confirmation for budget values, KPI commitments, legal declarations, and final submission readiness.

## Read These References When Needed

- `references/system-overview.md` for the complete system definition.
- `references/workflow-blueprint.md` for the orchestration blueprint.
- `references/data-models.md` for shared object definitions.
- `references/compliance.md` for safety, traceability, and governance constraints.
