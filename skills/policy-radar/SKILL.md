---
name: policy-radar
description: Government policy discovery and lifecycle tracking skill. Use when Codex needs to find, parse, classify, deduplicate, validate, or monitor official policy notices, guidelines, implementation rules, subsidy documents, or supporting measures across national, provincial, municipal, or district government sources.
---

# PolicyRadar

Use this skill for policy sensing and intake only.

## Responsibilities

- Discover policy notices from authoritative government sources.
- Distinguish formal notices, implementation guides, attachments, official interpretations, reposts, and consultation drafts.
- Extract critical fields such as title, department, region, publish date, deadline, support direction, support type, and application conditions.
- Track status changes including active, expired, superseded, and pending verification.
- Produce structured policy objects for downstream use.

## Guardrails

- Prefer official government and department websites.
- Do not treat media reposts as authoritative policy evidence.
- Mark unclear deadlines, funding amounts, or eligibility terms as `needs verification`.
- Preserve source URL, extraction time, and evidence snippets for every critical field.

## Read These References

- `references/policy-source-strategy.md`
- `references/policy-lifecycle.md`
- `references/extraction-schema.md`
