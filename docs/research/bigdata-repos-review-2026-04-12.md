# Big Data Repository Review — 2026-04-12

Evaluation of 4 open-source repositories for patterns, tools, and
ideas applicable to the compliance-analyzer project.

## Evaluation Criteria

Each repo is assessed on:
- **Purpose & maturity** (stars, activity, documentation)
- **Architectural patterns** (streaming, batch, visualization, data pipelines)
- **Compliance relevance** (transaction monitoring, reporting, sanctions screening, audit trail, MLRO dashboards)
- **Security posture** (secrets handling, access control, licensing)
- **Actionable takeaways** for this project

---

## 1. apache/superset

| Field | Detail |
|-------|--------|
| **URL** | https://github.com/apache/superset |
| **Stars** | 63,000+ |
| **License** | Apache 2.0 |
| **Stack** | Python (Flask, SQLAlchemy, Celery), React/TypeScript, Apache ECharts, Redis, PostgreSQL |
| **Last active** | April 2026 (v6.1.0rc1, daily commits) |

### What it does
Apache Superset is an open-source business intelligence and data exploration
platform that connects directly to SQL databases and OLAP engines without
requiring an intermediate ETL layer. It provides a no-code chart builder, a
full SQL IDE (SQL Lab) with metadata browsing, and a drag-and-drop dashboard
composer — all served through a web UI backed by a REST API.

Organizations use it to build self-service analytics: analysts build charts and
dashboards via the UI, operators embed dashboards inside internal tools via
iframes with JWT-secured guest tokens, and Celery workers handle async queries
and scheduled report delivery. The platform scales from single-machine Docker
deployments to Kubernetes clusters with distributed workers.

### Key architectural patterns
- **Query-time, not ETL** — pushes SQL down to the source database; does not
  extract or store data locally (except for Redis/Memcached caching of query
  results). Semantic layer maintained as "datasets" with calculated columns and
  metrics.
- **Plugin architecture** — chart types are npm packages registered at boot;
  database connectors are Python classes subclassing `BaseEngineSpec` for
  dialect-specific behavior (limit syntax, time grains, schema introspection).
- **RBAC + Row-Level Security** — Flask-AppBuilder provides five built-in
  roles (Admin, Alpha, Gamma, Public, sql_lab). RLS applies per-dataset SQL
  WHERE clauses based on role/user identity, ANDed transparently into every
  query. Guest tokens for embedded dashboards carry an `rls` array enforcing
  tenant isolation.
- **Three-tier caching** — metadata cache (Flask-Caching/Redis), query result
  cache keyed by SQL hash + datasource, and dashboard thumbnail cache. TTLs
  configurable per datasource.
- **Alerts & Reports** — Celery beat schedules stored in `report_schedule`
  table. Conditional alerts fire when a SQL query result crosses a threshold.
  Workers render PDF/PNG via headless browser (Selenium/Playwright) or export
  CSV, then dispatch via SMTP or Slack webhook.
- **Embedding** — `EmbeddedDashboard` model + guest token API. React SDK
  (`@superset-ui/embedded-sdk`) wraps the iframe and handles token refresh.

### Compliance relevance
| Aspect | Rating | Notes |
|--------|--------|-------|
| KPI dashboards | **High** | Dataset + chart + dashboard model maps directly to 30-KPI DPMS compliance report |
| Scheduled reporting | **High** | Celery beat + Alerts & Reports module for quarterly MoE/EOCN/FIU PDF/CSV exports |
| Alerting / thresholds | **High** | SQL-based conditional alerts for AED 55K CTR breach, 24h freeze countdown monitoring |
| MLRO dashboard access control | **High** | RBAC + RLS restricts MLRO to their cases, auditors to read-only, four-eyes segregation |
| Export for audit packs | **High** | Charts export to CSV, Excel, JSON; dashboards to PDF — usable for goAML supporting docs |
| Audit trail | Medium | Logs query history (user, SQL, datasource, execution time) but not dashboard view events |
| Embedding in React app | **High** | Guest-token-secured iframes surfaceable inside compliance-analyzer frontend |
| Sanctions screening | None | No AML-specific data models — pure visualization layer |
| Transaction monitoring | None | No streaming capability — operates at query time only |

### Security
- **Secrets**: `SUPERSET_SECRET_KEY` via environment variable; docs explicitly
  warn against hardcoding.
- **CSRF**: Enabled by default via `flask-wtf`. API endpoints exempt when using
  token auth.
- **CSP**: Implemented via `Talisman` Flask extension (`TALISMAN_ENABLED = True`
  by default). Embedded iframe CSP tuning is non-trivial and per-deployment.
- **Headers**: Talisman adds HSTS, X-Frame-Options, X-Content-Type-Options.
- **Sessions**: httpOnly, Secure, SameSite cookies. Server-side session store
  (Redis) recommended for production.
- **Known gap**: CSRF + CSP configuration for embedded dashboards requires
  careful tuning — relevant if embedding inside the compliance-analyzer frontend.

### Verdict: HIGH-VALUE INTEGRATION CANDIDATE
- **Adopt?** Strong candidate for MLRO dashboard and compliance reporting
  infrastructure. Not code to vendor — a deployment alongside the
  compliance-analyzer that consumes the same PostgreSQL compliance data.
- **Key patterns to adopt:**
  1. **RLS for multi-tenant compliance dashboards** — each business unit sees
     only their cases; MLRO sees all; auditors get read-only cross-unit access.
  2. **Celery beat scheduled reports** — quarterly MoE/EOCN/FIU export
     automation maps directly to `/kpi-report` and `/audit-pack` skill outputs.
  3. **Conditional SQL alerts** — threshold-crossing detection for AED 55K CTR
     volume and EOCN 24h countdown queue age.
  4. **Guest token embedding** — surface compliance dashboards inside the
     React frontend without separate Superset login.
- **Risk:** Low (Apache 2.0). Operational complexity of maintaining a Superset
  deployment alongside the main app.

---

## 2. pathwaycom/pathway

| Field | Detail |
|-------|--------|
| **URL** | https://github.com/pathwaycom/pathway |
| **Stars** | 63,500+ |
| **License** | BSL 1.1 (converts to Apache 2.0 after 4 years) |
| **Stack** | Python (API surface), Rust (compute engine, Differential Dataflow) |
| **Last active** | April 2026 (daily commits) |

### What it does
Pathway is a Python ETL and stream-processing framework that allows developers
to write pipeline code once and run it identically in batch, streaming, and
hybrid modes — eliminating the dual-codebase problem common with Flink/Spark.
The Python API is backed by a Rust engine built on Differential Dataflow, giving
it sub-millisecond latency and benchmarked performance at 30–90x faster than
Flink on streaming workloads.

Its second major capability is live AI/RAG pipelines. Pathway maintains an
in-memory vector index that updates incrementally as upstream data changes —
meaning LLM applications always query fresh, synchronized data without periodic
batch re-indexing. It integrates with LangChain and LlamaIndex and ships
ready-to-deploy RAG templates via its companion `llm-app` repository.

The framework ingests data via a wide connector ecosystem (Kafka, PostgreSQL/
Debezium CDC, S3, Google Drive, SharePoint, NATS, HTTP, and 350+ Airbyte
sources), processes it through a declarative Python table/dataframe API, and
emits results to output connectors or exposes them via a built-in REST API.

### Key architectural patterns
- **Differential Dataflow engine** — Rust engine built on Frank McSherry's
  model: only recomputes outputs for rows affected by new/changed/deleted input
  records. Operator fusion and vectorized execution for low overhead.
- **Unified batch + streaming** — same code, same results, different mode.
  Eliminates the "batch pipeline for backfill, streaming pipeline for live"
  anti-pattern.
- **CDC as first-class pattern** — Debezium integration propagates row-level
  inserts/updates/deletes as a stream. Natural fit for immutable audit logs.
- **Connector ecosystem** — Input: Kafka, Debezium/PostgreSQL CDC, S3, GDrive,
  SharePoint, NATS, CSV/JSONLINES, filesystem watch, HTTP, Airbyte (350+).
  Output: PostgreSQL, Kafka, REST API, file sinks, custom Python connectors.
- **Incremental vector RAG** — live document sync → chunking → embedding →
  in-memory index → LLM query, all within one pipeline. Zero re-indexing cost
  on document updates.
- **Windowed aggregations** — sliding/tumbling/session windows for time-based
  analytics over streaming data.

### Compliance relevance
| Aspect | Rating | Notes |
|--------|--------|-------|
| Real-time transaction monitoring | **High** | Streaming ingestion from Kafka/Debezium; sub-millisecond latency; sliding window aggregations |
| Streaming sanctions screening | **High** | Incremental joins against sanctions list tables; list updates propagate as deltas — no full rescan needed |
| Incremental risk scoring | **High** | Differential Dataflow recalculates only affected customer/transaction scores when inputs change |
| Live alerting pipelines | **High** | Output connectors trigger webhooks or write to alert queues; in-memory joins detect threshold crossings (AED 55K CTR, AED 60K cross-border) |
| CDC for audit trails | **High** | Debezium CDC captures every insert/update/delete with timestamps — natural immutable audit log (FDL Art.24) |
| goAML batch + streaming | **High** | Unified model produces both real-time alerts and periodic batch XML exports from same pipeline |
| KPI dashboards | Low | No visualization — infrastructure layer only |
| Four-eyes workflows | None | No built-in identity management or approval gates |
| MLRO dashboard | None | No UI layer — must be paired with Superset or similar |

### Security
- **Secrets**: Connector credentials (Kafka SASL, PostgreSQL passwords, S3
  keys) passed via environment variables or config objects. No built-in vault
  integration documented.
- **License concern**: BSL 1.1 is source-available but not fully open-source.
  Production enterprise deployments should review BSL terms. Converts to
  Apache 2.0 after 4 years.
- **Closed engine**: Rust engine bundled as a Python wheel; internals not
  fully auditable.
- **No built-in RBAC**: Operator must layer on access controls, TLS, and
  secrets management (Vault, AWS Secrets Manager) for production AML use.

### Verdict: HIGH-VALUE INFRASTRUCTURE PATTERN
- **Adopt?** Not direct code vendoring (Python/Rust vs our JS/TS stack), but
  the **architectural patterns are directly transferable** to our compliance
  monitoring pipeline design:
  1. **Incremental sanctions screening** — when OFAC/UN/EU lists update,
     Differential Dataflow recomputes only affected customer matches, not
     a full rescan of the entire database. This is the ideal architecture
     for `/multi-agent-screen` at scale.
  2. **CDC audit trail** — Debezium → Pathway → PostgreSQL pipeline creates
     an immutable event log satisfying FDL Art.24 (10-year retention) without
     application-level audit code.
  3. **Threshold crossing detection** — windowed aggregations detect AED 55K
     CTR and AED 60K cross-border breaches as transactions arrive, firing
     alerts before any batch window closes.
  4. **Unified batch + streaming for goAML** — same pipeline logic produces
     real-time STR triggers and periodic CTR/DPMSR XML batch exports.
- **Caution:** BSL 1.1 license requires legal review before production use.
  Closed Rust engine limits auditability.
- **Risk:** Medium (license terms, closed engine).

---

## 3. oxnr/awesome-bigdata

| Field | Detail |
|-------|--------|
| **URL** | https://github.com/oxnr/awesome-bigdata |
| **Stars** | 14,300+ |
| **License** | MIT |
| **Stack** | Pure Markdown (curated awesome-list) |
| **Last active** | February 2026 (591 commits, 32 open PRs) |

### What it does
A community-maintained curated index of big data tools, frameworks, papers,
books, and resources. Covers the full stack from storage (RDBMS, distributed
filesystems, graph and columnar DBs) through processing (streaming, batch, ML)
to tooling (ingestion, scheduling, BI, visualization). Does not rank or
benchmark tools — lists them with brief descriptions and links.

### Key categories
- RDBMS / Frameworks
- Distributed Programming (Spark, Flink, Storm, Beam, Samza, Kafka Streams)
- Distributed Filesystem
- Document / Key-Map / Key-Value / Graph Data Models
- Columnar Databases
- NewSQL Databases
- Time-Series Databases
- SQL-like Processing
- Data Ingestion
- Service Programming / Scheduling
- Machine Learning
- Benchmarking / Security
- Search Engine and Framework
- Business Intelligence / Data Visualization
- IoT and Sensor Data

### Compliance relevance
| Category | Rating | Compliance Use Case |
|----------|--------|---------------------|
| Graph Data Model (Neo4j, JanusGraph, DGraph) | **High** | UBO ownership graph traversal (>25% threshold), shell company/layering detection |
| Search Engines (Elasticsearch, Weaviate) | **High** | Fuzzy-match sanctions screening across UN/OFAC/EU/UK/UAE/EOCN name lists; embedding-based name-variant matching |
| Time-Series DBs (InfluxDB, Prometheus, Druid) | **High** | Transaction event timelines, threshold breach tracking (AED 55K/60K), KPI rollups, 24h freeze countdowns |
| Data Ingestion (Kafka, Pulsar, NiFi, Redpanda) | **High** | Real-time transaction stream ingestion feeding AML rule engines |
| Distributed Programming (Flink, Spark Streaming) | **High** | Streaming analytics for transaction monitoring (velocity checks, structuring detection) |
| Security (Apache Ranger, Knox) | Medium | Fine-grained access control on compliance data stores, four-eyes enforcement |
| Columnar / SQL-like Processing | Medium | OLAP queries for goAML report generation and STR/CTR aggregations |
| BI / Visualization | Medium | Dashboard tooling alternatives (overlaps with Superset above) |

### Notable tools for compliance stack
- **Neo4j / JanusGraph** — UBO ownership graph traversal, shell company detection
- **Elasticsearch / Weaviate** — name-variant and semantic sanctions screening
- **Apache Kafka / Pulsar** — real-time transaction event streaming
- **Apache Flink** — sliding-window rule evaluation (structuring, velocity limits)
- **Apache Druid** — sub-second OLAP over high-volume transaction histories for MLRO dashboards
- **Apache NiFi** — data provenance and lineage tracking (supports audit trail requirements, FDL Art.24)
- **Apache Ranger** — fine-grained access control on compliance data stores
- **Prometheus / VictoriaMetrics** — operational metrics and SLA monitoring for compliance pipelines

### Security
Zero attack surface — no executable code, no dependencies, no secrets. MIT license.

### Maintenance
Actively maintained via community PRs. Some older links (pre-2020 entries like
Twitter FlockDB, Facebook Peregrine) may be stale, but compliance-relevant
entries (Kafka, Flink, Neo4j, Elasticsearch) are current stable projects.

### Verdict: REFERENCE DIRECTORY
- **Adopt?** No code to vendor. Valuable as a **technology selection reference**
  when designing the compliance data pipeline architecture:
  1. **Graph database selection** for UBO/shell company analysis — Neo4j vs
     JanusGraph vs DGraph comparison starting point.
  2. **Streaming framework selection** for real-time transaction monitoring —
     Flink vs Spark Streaming vs Pathway (reviewed above) comparison.
  3. **Search engine selection** for sanctions screening — Elasticsearch vs
     Weaviate for fuzzy/semantic name matching.
  4. **Time-series DB selection** for threshold monitoring and KPI rollups.
- **Risk:** None.

---

## 4. milla-jovovich/mempalace

| Field | Detail |
|-------|--------|
| **URL** | https://github.com/milla-jovovich/mempalace (fork: trex0092/mempalace) |
| **Stars** | 42,900+ |
| **License** | MIT |
| **Stack** | Python 3.9+, ChromaDB (vector store), SQLite (knowledge graph), MCP server (19 tools) |
| **Last active** | April 2026 (early stage — ~7 commits over 2 days) |

### What it does
MemPalace is a local-first, long-term memory system for AI agents. It persists
conversation history and structured facts on the user's machine via ChromaDB
(vector embeddings) and SQLite (temporal knowledge graph triples), then
retrieves them in subsequent AI sessions without cloud APIs or subscriptions.
The system exposes an MCP server with 19 tools so that Claude, ChatGPT, Cursor,
and other MCP-compatible clients can read/write to the memory store.

The design philosophy is "verbatim-first": raw exchanges are stored in ChromaDB
with deterministic heuristics (regex, keyword scoring) for classification and
chunking — no LLM calls on the write path. Retrieval uses a progressive 4-layer
loading strategy (L0: ~50-100 tokens identity constants, L1: ~500-800 tokens
top-15 importance-scored drawers, L2: ~200-500 tokens room-scoped recall,
L3: unbounded semantic search fallback) to inject only the most relevant
context at session start.

The project uses a spatial "palace" metaphor: Wings (people/projects) → Rooms
(topics) → Halls (memory types: facts, events, discoveries) → Closets
(summaries) → Drawers (verbatim originals). "Tunnels" link related rooms
across wings. The temporal knowledge graph stores RDF-style subject-predicate-
object triples with valid-from/ended date windows for time-windowed fact
validity.

### Key architectural patterns
- **4-layer progressive context loading** — predictable, cheap session
  injection with escalating detail levels. Prevents context bloat while
  preserving recall optionality (~170 tokens for the wake-up context).
- **Verbatim-first storage** — no lossy summarization at write time. Raw
  exchanges preserved; LLM calls only happen in the conversation layer.
- **Temporal knowledge graph** — SQLite-backed RDF triples with valid-from/
  ended date windows. Entity types: person, project; properties as JSON blobs.
- **MCP 19-tool exposure** — `add_drawer`, `query_palace`, `get_wake_up_context`,
  etc. Designed for direct AI client integration.
- **Zero-LLM write path** — all classification and chunking uses regex/keyword
  heuristics. Fast, deterministic, cost-free.
- **AAAK dialect** — experimental lossy abbreviation for token compression
  (entity codes + 55-char truncation); currently regresses retrieval performance.

### Compliance relevance
| Aspect | Rating | Notes |
|--------|--------|-------|
| MLRO session reconstruction | **High** | 4-layer progressive loading injects last N decisions at session start without full replay |
| Audit trail integrity | **High** | Verbatim-first storage aligns with FDL Art.24 (10-year verbatim record retention) |
| Temporal fact tracking | **High** | Valid-from/ended triples answer "what did we know and when" for STR/CNMR timelines |
| Case-scoped recall | **High** | Wing/Room metadata filtering isolates memories per customer entity |
| MCP tool exposure | Medium | Could expose compliance memory as tools to the advisor/executor agent pair |
| Provenance / evidence trails | None | Cannot prove a retrieved fact came from a specific source document (LBMA/MoE requirement) |
| Multi-user access control | None | No authentication — assumes local machine; incompatible with four-eyes separation |
| Contradiction detection | None | Described in README but not implemented — dangerous for compliance fact stores |

### Security
- **Local-first**: no cloud egress is a genuine strength for sensitive data.
- **No authentication**: assumes trusted local machine. No user auth, no API
  keys for the MCP server.
- **No encryption at rest**: SQLite and ChromaDB files are plaintext on disk.
- **No input validation**: `add_drawer` MCP tool performs no input validation —
  identified as a prompt injection surface.
- **No write gating**: any MCP client call writes immediately without
  confirmation.
- **Minimal dependencies**: ChromaDB + PyYAML only — small attack surface.

### Verdict: PATTERN REFERENCE (with caveats)
- **Adopt?** Not direct code — Python stack, and critical compliance gaps (no
  auth, no provenance, no encryption, non-functional contradiction detection).
  But **two patterns are directly transferable**:
  1. **4-layer progressive context loading** for MLRO session reconstruction —
     inject the last N compliance decisions at session start without full
     context replay. Maps to the `claude-mem` vendor pattern already in the
     project.
  2. **Temporal knowledge graph with validity windows** for "what did we know
     and when" audit trail queries — essential for CNMR filing timelines
     (Cabinet Res 74/2020 Art.4-7) and STR retrospective analysis.
  3. **Spatial metaphor (Wing/Room/Hall)** as a compliance domain model:
     Wings = business units, Rooms = customer entities, Halls = case types
     (CDD/EDD/STR/CTR), Drawers = individual evidence items.
- **Caution:** The project is very early stage (~7 commits). Benchmarks are
  disputed (headline 96.6% LongMemEval actually measures ChromaDB defaults,
  not the palace architecture). Contradiction detection is non-functional.
- **Risk:** Low (MIT license, pattern reference only). Do not vendor without
  adding auth, provenance, and encryption layers.

---

## Summary Matrix

| Repo | Stars | Stack | Compliance Relevance | Recommendation |
|------|-------|-------|---------------------|----------------|
| apache/superset | 63K | Python/React | **High** (dashboards, reporting, alerting, RBAC) | Integration candidate: MLRO dashboards, scheduled compliance reports, threshold alerts |
| pathwaycom/pathway | 63.5K | Python/Rust | **High** (streaming, CDC, incremental screening) | Architecture reference: incremental sanctions screening, CDC audit trails, threshold detection |
| oxnr/awesome-bigdata | 14.3K | Markdown | Medium (technology directory) | Reference: tool selection for graph DB, search, streaming, time-series components |
| milla-jovovich/mempalace | 42.9K | Python/ChromaDB/SQLite | **High** (memory, temporal KG, session recall) | Pattern reference: 4-layer progressive loading, temporal fact validity, spatial domain model |

## Top 4 Actionable Takeaways

1. **Superset for MLRO compliance dashboards** (from apache/superset): Deploy
   Superset alongside the compliance-analyzer, connected to the same PostgreSQL
   database. Use RLS for multi-tenant access control, Celery beat for scheduled
   MoE/EOCN/FIU report generation (PDF/CSV), and conditional SQL alerts for
   AED threshold monitoring. Embed dashboards in the React frontend via guest
   tokens — this directly supports `/kpi-report`, `/audit-pack`, and
   `/moe-readiness` skill outputs without building custom visualization code.

2. **Differential Dataflow for incremental sanctions screening** (from
   pathwaycom/pathway): The core insight is that sanctions list updates should
   trigger delta recomputation, not full database rescans. When OFAC publishes
   an update, only customer records matching changed entries need re-evaluation.
   This pattern should inform the architecture of `/multi-agent-screen` at
   scale — whether implemented via Pathway itself, Apache Flink, or a custom
   incremental engine in our JS/TS stack.

3. **Graph database for UBO and layering analysis** (from oxnr/awesome-bigdata):
   The awesome-bigdata list highlights Neo4j, JanusGraph, and DGraph as mature
   graph databases. For the compliance-analyzer's UBO register requirements
   (Cabinet Decision 109/2023, >25% beneficial ownership threshold), a graph
   database enables recursive ownership traversal, shell company detection via
   cycle analysis, and layering pattern identification — capabilities that are
   expensive to implement in relational SQL alone.

4. **Temporal knowledge graph + progressive loading for MLRO memory** (from
   milla-jovovich/mempalace): The 4-layer progressive context loading pattern
   (L0 identity → L1 top facts → L2 scoped recall → L3 full search) maps
   directly to MLRO session reconstruction — inject the last N compliance
   decisions at session start without full context replay. The temporal
   knowledge graph with valid-from/ended date windows enables "what did we
   know and when" audit trail queries, essential for CNMR filing timelines
   (Cabinet Res 74/2020 Art.4-7). Complements the `claude-mem` vendor
   pattern already in the project.

## Repos NOT Recommended for Vendoring

- **apache/superset** — too large to vendor (63K+ files); should be deployed as
  a standalone service, not embedded in this repo. Reference the patterns and
  integration APIs.
- **pathwaycom/pathway** — BSL 1.1 license requires legal review; Python/Rust
  stack incompatible with our JS/TS codebase. Adopt the architectural patterns
  (incremental computation, CDC pipelines), not the code.
- **oxnr/awesome-bigdata** — no code to vendor; pure reference material.
  Bookmark for technology selection decisions.
- **milla-jovovich/mempalace** — very early stage (~7 commits), Python stack,
  critical compliance gaps (no auth, no provenance, no encryption, non-functional
  contradiction detection). Adopt the architectural patterns (progressive loading,
  temporal KG, spatial metaphor), not the code.
