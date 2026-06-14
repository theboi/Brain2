"""groups:* ops."""
import pytest

from brain2.context import RequestContext
from brain2.errors import Conflict
from brain2.group_ops import (
    make_add_member,
    make_create_group,
    make_delete_group,
    make_list_groups,
    make_remove_member,
    make_remove_vault_role,
    make_remove_workspace_role,
    make_rename_group,
    make_set_vault_role,
    make_set_workspace_role,
)
from brain2.store.local import LocalStore


def _store():
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner1", "owner@t1.com", "owner", "Owner")
    s.create_user("t1", "u2", "u2@t1.com", "member", "Two")
    s.create_workspace("t1", "Eng", workspace_id="ws1")
    s.create_project("t1", "p1", "Vault 1", workspace_id="ws1")
    return s


def _owner():
    return RequestContext(tenant_id="t1", user_id="owner1", tenant_role="owner")


def test_create_list_rename_delete():
    s = _store()
    group = make_create_group(s)(_owner(), {"name": "Squad"})
    gid = group["group_id"]
    assert any(x["group_id"] == gid for x in make_list_groups(s)(_owner(), {})["groups"])
    make_rename_group(s)(_owner(), {"group_id": gid, "name": "Squad 2"})
    assert s.get_group("t1", gid)["name"] == "Squad 2"
    make_delete_group(s)(_owner(), {"group_id": gid})
    assert s.get_group("t1", gid) is None


def test_create_duplicate_name_conflicts():
    s = _store()
    make_create_group(s)(_owner(), {"name": "Dup"})
    with pytest.raises(Conflict):
        make_create_group(s)(_owner(), {"name": "Dup"})


def test_members_workspace_roles_and_vault_grants():
    s = _store()
    gid = make_create_group(s)(_owner(), {"name": "Squad"})["group_id"]
    detail = make_add_member(s)(_owner(), {"group_id": gid, "user_id": "u2"})
    assert detail["members"][0]["user_id"] == "u2"
    detail = make_set_workspace_role(s)(_owner(), {
        "group_id": gid, "workspace_id": "ws1", "role": "admin"})
    assert detail["workspace_roles"][0]["role"] == "admin"
    detail = make_set_vault_role(s)(_owner(), {
        "group_id": gid, "project_id": "p1", "role": "editor"})
    assert detail["vault_grants"][0]["role"] == "editor"
    make_remove_vault_role(s)(_owner(), {"group_id": gid, "project_id": "p1"})
    make_remove_workspace_role(s)(_owner(), {"group_id": gid, "workspace_id": "ws1"})
    detail = make_remove_member(s)(_owner(), {"group_id": gid, "user_id": "u2"})
    assert detail["members"] == []
