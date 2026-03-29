---
name: entity-matcher
description: Enterprise eligibility and entity matching skill for government applications. Use when Codex needs to determine which legal entity is most suitable for a policy opportunity, compare multiple subsidiaries, score match quality, identify qualification gaps, or enforce hard eligibility rules such as region, age, revenue, R&D ratio, or certification requirements.
---

# EntityMatcher

Use this skill to decide which enterprise entity should apply.

## Responsibilities

- Normalize enterprise profiles into a standard eligibility model.
- Apply hard rule checks before any soft recommendation.
- Compare multiple entities under one policy opportunity.
- Produce match scores, gap analysis, and ranked recommendations.
- Separate blocking conditions from improvable conditions.

## Guardrails

- Never let language-model reasoning override hard qualification rules.
- Treat missing data as missing, not as implied compliance.
- Keep score explanations traceable to structured facts.
- Escalate disputed entity ownership, registration region, or qualification documents for human review.

## Read These References

- `references/entity-profile-schema.md`
- `references/eligibility-rules.md`
- `references/entity-matcher-source.md`
