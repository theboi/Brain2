from brain2.store.local import LocalStore


def _store():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_workspace("t1", "Engineering", workspace_id="eng")
    s.create_workspace("t1", "Finance", workspace_id="fin")
    s.create_user("t1", "u_eng", "eng@acme.com", "member")
    s.create_user("t1", "u_fin", "fin@acme.com", "member")
    s.create_user("t1", "u_guest", "guest@acme.com", "member")
    s.add_workspace_member("t1", "eng", "u_eng", "member")
    s.add_workspace_member("t1", "fin", "u_fin", "member")
    # A guest with a direct grant on an Engineering vault.
    s.create_project("t1", "eng_vault", "Eng Vault", workspace_id="eng")
    s.grant_access("t1", "eng_vault", "user", "u_guest", "viewer")
    return s


def test_directory_scoped_to_workspace_members_and_guests():
    s = _store()
    emails = {u["email"] for u in s.list_workspace_user_directory("t1", "eng")}
    assert emails == {"eng@acme.com", "guest@acme.com"}


def test_directory_excludes_other_workspace_only_users():
    s = _store()
    emails = {u["email"] for u in s.list_workspace_user_directory("t1", "eng")}
    assert "fin@acme.com" not in emails
