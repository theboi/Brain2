from brain2.context import RequestContext
from brain2.persona_ops import make_set, persona_preamble
from brain2.store.local import LocalStore


def _seed():
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    return s


def test_preamble_empty_when_unset():
    s = _seed()
    assert persona_preamble(s, "t1", "u1") == ""


def test_preamble_formats_block_when_set():
    s = _seed()
    make_set(s)(RequestContext(
        tenant_id="t1", user_id="u1", tenant_role="member", project_id=None),
        {"content": "Ops & Finance lead."})
    block = persona_preamble(s, "t1", "u1")
    assert block.startswith("## About the user")
    assert "Ops & Finance lead." in block
