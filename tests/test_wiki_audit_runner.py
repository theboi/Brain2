def test_run_wiki_audit_once_inserts_and_derives_cited(store, monkeypatch):
    store.create_tenant("T", "Tenant")
    store.create_project("T", "p", "Project")

    import brain2.wiki_audit_runner as runner

    monkeypatch.setattr(runner, "build_provider", lambda *args, **kwargs: object())
    monkeypatch.setattr(
        runner,
        "complete_once",
        lambda *args, **kwargs: type(
            "Resp",
            (),
            {
                "text": (
                    'SUGGESTION: {"section":"Origins","proposed_content":"X",'
                    '"rationale":"why","sources_cited":["a.pdf"]}\n'
                    'SUGGESTION: {"section":"Body","proposed_content":"Y",'
                    '"rationale":"w","sources_cited":[]}\nDONE'
                )
            },
        )(),
    )

    audit_id, suggestions = runner.run_wiki_audit_once(
        store,
        secrets=None,
        tenant_id="T",
        project_id="p",
        topic="Cell theory",
        agent_row={"model_id": "m1"},
        instructions="",
        page_content="# Cell theory",
    )

    assert audit_id
    assert len(suggestions) == 2
    assert suggestions[0]["cited"] is True
    assert suggestions[1]["cited"] is False
    assert all(s["suggestion_id"] for s in suggestions)
