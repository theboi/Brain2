from brain2.store.base import Store


def test_store_is_protocol_with_expected_methods():
    # The protocol must declare the foundational surface other sub-plans build on.
    for name in (
        "transaction", "migrate", "schema_version",
        "create_tenant", "get_tenant",
        "create_user", "get_user",
        "create_project", "get_project",
        "grant_access", "effective_project_role",
        "remember_idempotent", "recall_idempotent",
    ):
        assert hasattr(Store, name), f"Store protocol missing {name}"
