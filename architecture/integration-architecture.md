# Integration Architecture

## Logical layers

- Ingestion layer: website crawling, document intake, OCR, extraction.
- Knowledge layer: policy KB, project template KB, enterprise material KB.
- Reasoning layer: rules engine, retrieval, LLM orchestration.
- Workflow layer: approvals, reminders, state transitions, audit logs.
- Experience layer: analyst console, project manager workbench, reporting outputs.

## Core integration principles

- Separate authoritative facts from generated narrative.
- Keep structured storage for policy and entity data.
- Use retrieval for evidence grounding.
- Keep workflow control outside free-form generation.
