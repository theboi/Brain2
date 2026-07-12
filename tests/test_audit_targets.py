from brain2.models import VaultPage


def test_topics_for_source_prefers_indexed_wiki_topics(store):
    from brain2.source_ops import create_source_row
    from brain2.tasks.audit_targets import topics_for_source

    store.create_tenant("T", "Tenant")
    store.create_project("T", "p", "Project")
    source_id = create_source_row(
        store,
        tenant_id="T",
        project_id="p",
        kind="file",
        topic="Cell theory",
        mode="wiki",
    )
    store.upsert_vault_page(
        VaultPage(
            tenant_id="T",
            project_id="p",
            path="wiki/concepts/other.md",
            zone="wiki",
            topic="Other",
            content_hash="h",
            mtime=1,
        )
    )

    assert topics_for_source(store, "T", "p", source_id)[:2] == ["Other", "Cell theory"]


def test_default_auditor_agent_picks_ready_model(store):
    from brain2.tasks.audit_targets import default_auditor_agent

    store.create_tenant("T", "Tenant")
    with store.transaction() as cx:
        cx.execute(
            "INSERT INTO models(model_id, tenant_id, name, provider, model, status, created_at, updated_at) "
            "VALUES ('m1', 'T', 'Audit model', 'stub', 'stub', 'ready', '2026-01-01', '2026-01-01')"
        )

    agent = default_auditor_agent(store, "T")
    assert agent is not None
    assert agent["model_id"] == "m1"
