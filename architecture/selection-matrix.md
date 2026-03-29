# Selection Matrix

## Workflow and orchestration

- LangGraph: best fit for complex stateful orchestration.
- Dify: strong for MVP and integrated workflow applications.
- Flowise: fast for visual PoC work.
- Custom BPM plus LLM adapters: strongest governance fit, highest delivery cost.

## Document parsing and knowledge base

- Unstructured: strong general-purpose parsing baseline.
- PaddleOCR: strong OCR support for Chinese scanned documents.
- Elasticsearch or OpenSearch: strong text indexing and retrieval.
- PostgreSQL plus pgvector: low-cost unified structured and vector storage.
- Milvus: stronger long-term large-scale vector retrieval option.

## Suggested adoption path

- MVP: Unstructured + PaddleOCR + Elasticsearch + PostgreSQL/pgvector + Dify or LangGraph.
- Production: stronger parsing, rule engine, workflow governance, audit, and permission layers.
