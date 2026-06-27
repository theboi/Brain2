# Security Remediation Plan Index — 2026-06-27

Plans addressing [`docs/security-review-handoff-2026-06-27.md`](../../security-review-handoff-2026-06-27.md).
Each plan is self-contained and independently shippable. Execute in priority order.

## Execution order

| # | Plan | Handoff item | Severity | Surface |
|---|------|--------------|----------|---------|
| 01 | [Vault write path containment](2026-06-27-01-vault-path-containment.md) | §1 | **Critical** | backend |
| 02 | [Tenant-scoped vault cache](2026-06-27-02-vault-cache-tenant-scope.md) | §2 | **High** | backend (migration + ~30 call sites) |
| 03 | [Scope users:directory to workspace](2026-06-27-03-user-directory-scoping.md) | §3 | **High** | backend |
| 04 | [Ingest vault targeting by project_id](2026-06-27-04-ingest-vault-targeting.md) | §4 | **High** | frontend |
| 05 | [Medium hardening](2026-06-27-05-medium-hardening.md) | Medium (A/B/C) | Medium | backend + small frontend |
| 06 | [Mock-surface cleanup](2026-06-27-06-mock-surface-cleanup.md) | Low | Low | frontend |

**Recommended order:** 01 → 02 → 03 → 05 → 04 → 06. Path containment and the
tenant-scope migration have the largest blast radius and the highest security
value; do them first (per the handoff's "Notes For Implementation"). 04 and 06
are frontend and can proceed in parallel with the backend work.

## Cross-plan notes

- **Plan 05 Sub-item A** (reject unknown workspace IDs) and **Plan 06 Task 2**
  (remove stale `WS_OPTS`) are the server + client halves of the same defect —
  ship them together if possible.
- **Plan 02** is the riskiest mechanical change (signature threading across many
  call sites). Run the grep audit in its Self-Review before the final commit.
- Tests: backend `\.venv/bin/python -m pytest tests/ -q`; frontend
  `cd brain2-web && npm test -- --run`. Each plan lists the focused subsets.

## Decisions baked into these plans (override if product disagrees)

1. **users:directory** (Plan 03): workspace admins see only people already in
   the workspace or guests of its vaults. Inviting arbitrary tenant users is an
   owner-level People action.
2. **stats:llm_tokens / audit:list** (Plan 05 B): gated to tenant **admin**
   (`view_audit_logs`). Token spend treated as admin cost metadata, not owner-only.
3. **vault cache tenant-scoping** (Plan 02): implemented as defense-in-depth
   (project_ids are UUIDs today); schema + queries must still forbid cross-tenant
   reads.
