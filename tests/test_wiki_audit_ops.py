from types import SimpleNamespace


def _ctx(tenant_id="T", user_id="u1", project_id="p"):
    return SimpleNamespace(tenant_id=tenant_id, user_id=user_id, project_id=project_id)


def _seed_audit(store):
    store.create_tenant("T", "Tenant")
    store.create_user("T", "u1", "u1@example.com", "member")
    store.create_project("T", "p", "Project")
    from brain2.wiki_audit_ops import create_audit_row

    return create_audit_row(
        store,
        tenant_id="T",
        project_id="p",
        topic="Cell theory",
        agent_id="m1",
        instructions="",
        created_by="u1",
    )


def test_list_suggestions_includes_cited(store):
    from brain2.wiki_audit_ops import insert_suggestion, make_list_suggestions

    audit_id = _seed_audit(store)
    insert_suggestion(
        store,
        tenant_id="T",
        audit_id=audit_id,
        section="Origins",
        proposed_content="X",
        rationale="why",
        sources_cited=["a.pdf"],
    )
    insert_suggestion(
        store,
        tenant_id="T",
        audit_id=audit_id,
        section="Body",
        proposed_content="Y",
        rationale="why",
        sources_cited=[],
    )

    out = make_list_suggestions(store)(_ctx(), {"audit_id": audit_id, "project_id": "p"})
    cited = {s["section"]: s["cited"] for s in out["suggestions"]}
    assert cited == {"Origins": True, "Body": False}


def test_open_audit_counts_groups_by_topic(store):
    from brain2.wiki_audit_ops import insert_suggestion, make_open_audit_counts

    audit_id = _seed_audit(store)
    insert_suggestion(
        store,
        tenant_id="T",
        audit_id=audit_id,
        section="Origins",
        proposed_content="X",
        rationale="why",
        sources_cited=[],
    )

    out = make_open_audit_counts(store)(_ctx(), {"project_id": "p"})
    assert out["counts"]["Cell theory"] == 1


def test_insert_suggestion_auto_suppresses_per_item_notification(store):
    from brain2.wiki_audit_ops import insert_suggestion

    audit_id = _seed_audit(store)
    insert_suggestion(
        store,
        tenant_id="T",
        audit_id=audit_id,
        section="Auto",
        proposed_content="X",
        rationale="why",
        sources_cited=[],
        auto=True,
    )
    row = store._conn.execute(
        "SELECT COUNT(*) AS n FROM notifications WHERE tenant_id='T' AND type='wiki_suggestion'"
    ).fetchone()
    assert row["n"] == 0
