# Report Generation Add-on — Design

> An add-on on [Brain2 Core](2026-05-23-brain2-core-design.md). It packages the core's **unified Q&A engine** (which already answers over wiki text + live data sources) into **repeatable, scheduled, stored reports** — replacing the analyst who runs the same queries every month and writes up the numbers. The interactive "chat with your data" capability itself is **core `query`**, not this add-on; this add-on is about turning that into report *artifacts*.

## 1. Purpose

- **Report templates** — named, multi-section report definitions ("Monthly financials", "Customer health summary") that can be run repeatedly.
- **Generation** — on-demand or scheduled production of a narrative report from a template, computed from live data via the core engine.
- **Artifacts** — each run is stored (markdown, optional PDF) with provenance (the queries actually run), retrievable later and optionally written back as a wiki page.

It deliberately does **not** re-implement query planning or crunching — that lives in core `query` / `run_query`.

## 2. How it attaches to the core

- **Package:** `addons/report-generation/`, always shipped, enabled per tenant.
- **Engine dependency:** calls the core **`query(question, scope)`** engine (plan→query→compute→narrate over wiki + data) to produce each report section, and/or core `run_query` for precise template-defined queries. All the data access, read-only enforcement, bounded extraction, and access filtering come from core.
- **LLM:** when it composes/structures multi-section reports it uses the core `LLMClient`; sensitive-data narration honors the same core setting (local Ollama tier) — it doesn't manage its own provider logic.
- **Auth:** generating a report needs project `viewer`; defining/editing templates + schedules needs `editor`. Enforced by core on every registered operation.
- **Tasks:** `generate_report` is **async** (several core queries + composition) → returns `task_id`.
- **Hook (optional):** subscribes to `data_source_registered` to suggest report templates for a newly connected source.

## 3. How a report is produced

A report = an ordered set of **sections**, each section a question/spec answered by the core engine, then composed:

1. For each section in the template, call core `query(section.question, scope=template.project(s))` — or, for precise control, core `run_query` against a template-pinned data source. Core does the planning, read-only querying, computing, and narrating with provenance.
2. The add-on **composes** the section answers into the report structure (title, sections, ordering, formatting), adds a generated executive summary if requested, and records the union of all `queries_used` as provenance.
3. Render to markdown (optional PDF); store as a `Report` artifact; optionally write back as a wiki page.

The add-on owns *structure, repeatability, scheduling, storage, rendering*; the core owns *answering*.

## 4. Data model (add-on namespaced storage)

```
ReportTemplate = {
  id, tenant_id, project_id, name,
  spec,                       # natural-language description of the report + sections
  data_source_ids: [str],
  output: "markdown" | "pdf",
  writeback_to_wiki: bool,    # if true, the finished report is also written as a wiki page
  schedule: { timezone: IANA-tz, cron } | null,  # explicit IANA tz; DST-aware next-run; idempotent per (template_id, scheduled_slot_utc) — P5 §8.7. Metadata for an EXTERNAL scheduler; the add-on does not run cron.
  created_by, created_at
}

Report = {                    # a generated artifact
  id, tenant_id, project_id, template_id | null,
  title, generated_at,
  content_md, pdf_ref | null,
  inputs: [{data_source_id, query, row_count}],   # provenance: what was actually run
  status: "done" | "failed", error | null
}
```

Both persist via core namespaced storage (`registry.storage("report-generation")`), keyed `template:{project_id}:{id}` and `report:{project_id}:{id}`. Generated PDFs are stored as add-on blobs. **Caches** of intermediate data carry a TTL because the underlying data is dynamic (§5 of the core spec).

## 5. Triggers & delivery

- **On-demand report:** `generate_report(template_id)` or `generate_report(ad_hoc_spec, scope)` → `task_id`. Poll core `get_task_status`; result is a stored `Report`.
- **Scheduled reports:** the add-on does **not** run an internal scheduler (consistent with core). Templates carry a `schedule`; an **external scheduler** (cron/launchd/an agent, or optional built-in core scheduler if enabled) periodically calls `list_due_report_templates(now)` then `generate_report(template_id)` for each. Scheduling stays out-of-process and swappable. The `schedule` carries an explicit IANA `timezone`, next-run is computed **DST-aware**, and generation is **idempotent on `(template_id, scheduled_slot_utc)`** so overlapping scheduler ticks produce exactly one report per slot ([Phase 5 §8.7](2026-05-24-brain2-phase5-platform-hardening.md)).
- **Delivery:** reports are stored and retrievable (`list_reports`, `get_report`). **Access control:** report reads are authorized by project (user must have project `viewer` or higher). `list_reports` is filtered to projects the user can access.
- **Writeback to wiki:** if `writeback_to_wiki` is set, the finished report is also written as a wiki page (via core wiki write) so it's searchable/shareable. Wiki page access follows project access control (inherited).
- **Ad-hoc "chat with your data"** is **not here** — it's core `query`. Users/agents hit core directly for one-off analytics; this add-on is for the repeatable, stored, scheduled case.

## 6. Registered operations (→ REST + MCP via core)

```
Templates:   define_report_template, list_report_templates, get_report_template,
             update_report_template, delete_report_template
Generate:    generate_report (async → task_id)
Artifacts:   list_reports, get_report
Scheduling:  list_due_report_templates(now)   # for an external scheduler
```

All thin handlers, registered via `registry.register_operation(...)`, authorized by the core. The crunching/answering itself is delegated to core `query` / `run_query`.

## 7. Governance, safety, privacy

Inherited from core (the add-on adds none of its own data access):
- **Read-only + bounded extraction + access filtering + data residency + local-LLM-for-sensitive** all come from the core `query`/`run_query` engine the add-on calls.
- **Provenance.** Each `Report` records the union of `queries_used` returned by core for its sections, so a human can audit how every number was produced.

## 8. Out of scope (this add-on)

Chart/dashboard rendering (could emit chart specs later); forecasting/ML; writing back to source databases; real-time/streaming analytics; cross-tenant benchmarking; the analysis engine itself (that's core). A future "analytics visualization" add-on can consume `Report.inputs`.

## 9. Testing

Through the core REST `TestClient` with the add-on enabled, mocking core `query`/`run_query` + `LLMClient`:
- enabling the add-on registers its operations on REST + MCP;
- `define_report_template` then `generate_report` calls core `query` per section (mocked to return answers + `queries_used`), composes a multi-section `Report` artifact, stores it, and it's retrievable with the merged provenance;
- `writeback_to_wiki=true` results in a wiki page write;
- `list_due_report_templates` returns only templates whose `schedule` is due at a given `now`;
- auth denies a non-member and blocks template editing for a `viewer`.
