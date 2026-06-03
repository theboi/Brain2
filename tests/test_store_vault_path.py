from brain2.store.local import LocalStore

def _seed():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_project("t1", "p1", "Research")
    return s

def test_set_and_get_vault_path():
    s = _seed()
    s.set_project_vault_path("t1", "p1", "/srv/brain2/vaults/t1/p1")
    p = s.get_project("t1", "p1")
    assert p.vault_path == "/srv/brain2/vaults/t1/p1"

def test_get_project_by_vault_path_prefix():
    s = _seed()
    s.set_project_vault_path("t1", "p1", "/srv/brain2/vaults/t1/p1")
    found = s.find_project_by_vault_path("/srv/brain2/vaults/t1/p1/raw/wiki/x.md")
    assert found is not None
    assert found.id == "p1"
    assert found.tenant_id == "t1"

def test_get_project_by_vault_path_no_match():
    s = _seed()
    assert s.find_project_by_vault_path("/tmp/unrelated/foo.md") is None
