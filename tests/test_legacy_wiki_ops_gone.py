import pytest
from fastapi.testclient import TestClient
from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore


def test_wiki_ops_module_is_gone():
    import importlib
    try:
        importlib.import_module("brain2.wiki_ops")
    except ModuleNotFoundError:
        return
    raise AssertionError("brain2.wiki_ops should have been deleted")


def test_wiki_ops_not_registered():
    from brain2.app_context import build_app_context
    from brain2.store.local import LocalStore
    s = LocalStore(":memory:"); s.migrate()
    actx = build_app_context(store=s, gateway=object())
    op_names = set(actx.operations._ops.keys())
    forbidden = {"wiki:list", "wiki:get", "wiki:put", "wiki:search",
                 "wiki:list_revisions", "wiki:get_revision",
                 "wiki:diff", "wiki:restore", "wiki:get_sources"}
    overlap = op_names & forbidden
    assert not overlap, f"legacy wiki ops still registered: {overlap}"


def test_legacy_wiki_store_methods_removed():
    from brain2.store.local import LocalStore
    s = LocalStore(":memory:")
    for name in ("put_wiki_page", "get_wiki_page", "list_wiki_pages",
                 "search_wiki_fts", "list_wiki_revisions",
                 "get_wiki_revision", "get_wiki_revision_by_version"):
        assert not hasattr(s, name), f"{name} should be removed"
