# GovPMCopilot

GovPMCopilot is a composite enterprise skill system for end-to-end government project automation.

GovPMCopilot 是一个面向集团化企业与项目团队的复合型 Skill System，用于覆盖政府项目管理与申报的全链路自动化工作，从政策发现到材料成稿，再到预审复核与流程编排。

## Overview | 项目概览

This repository organizes the system into six coordinated skills plus shared architecture, schemas, and compliance guidance.

本仓库将系统组织为 6 个协同 Skill，并补充系统架构、标准数据模型与合规约束，方便持续扩展与复用。

## Core Skills | 核心 Skills

- `gov-pm-copilot`: system entry point and cross-skill coordinator
- `policy-radar`: policy discovery, extraction, classification, lifecycle tracking
- `entity-matcher`: multi-entity eligibility matching and gap analysis
- `policy-interpreter`: six-dimension policy interpretation and strategy output
- `proposal-composer`: application material drafting and structured writing
- `review-auditor`: expert-style pre-review, scoring, and remediation guidance
- `workflow-orchestrator`: workflow state management, handoffs, reminders, and auditability

- `gov-pm-copilot`：系统总入口与总控编排
- `policy-radar`：政策发现、抽取、分类与生命周期跟踪
- `entity-matcher`：多主体资格匹配与缺口分析
- `policy-interpreter`：六维政策解读与申报策略生成
- `proposal-composer`：申报材料融合撰写与结构化输出
- `review-auditor`：专家视角预审、评分与修改建议
- `workflow-orchestrator`：流程状态、交接、提醒与审计追踪

## Repository Structure | 仓库结构

```text
skills/
  gov-pm-copilot/
  policy-radar/
  entity-matcher/
  policy-interpreter/
  proposal-composer/
  review-auditor/
  workflow-orchestrator/
architecture/
schemas/
```

## Shared Data Models | 标准数据模型

The system standardizes four core objects:

- `Policy`
- `Entity`
- `MatchResult`
- `Opportunity`

These live under [`schemas/`](./schemas) and serve as the shared contract for policy intake, qualification evaluation, opportunity management, and workflow routing.

系统统一定义了 4 个核心对象：`Policy`、`Entity`、`MatchResult`、`Opportunity`，用于支撑政策知识库、主体评估、机会卡管理和工作流流转。

## Architecture | 架构设计

Repository-level architecture notes are stored in [`architecture/`](./architecture):

- `selection-matrix.md`
- `integration-architecture.md`
- `implementation-roadmap.md`

这些文档分别覆盖：技术选型建议、集成架构蓝图、实施路线图。

## Design Principles | 设计原则

- Source authority first
- Traceable conclusions
- Rule-based hard eligibility checks
- Human confirmation for high-risk outputs
- Standardized workflow states and audit trail

- 权威来源优先
- 结论全链路可追溯
- 硬门槛优先走规则判断
- 高风险内容必须保留人工确认
- 流程状态和操作痕迹标准化

## Compliance Notice | 合规声明

This repository is intended to support compliant project automation. It must not be used to fabricate policy facts, financial evidence, certifications, KPI commitments, or submission materials inconsistent with reality.

本仓库旨在支持合规前提下的政府项目自动化，不应用于编造政策条款、财务数据、资质证明、绩效指标或与事实不符的申报材料。

## License

Apache License 2.0
