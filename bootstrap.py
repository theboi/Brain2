# bootstrap.py — create the first tenant/user/password
from brain2.app_context import build_app_context

actx = build_app_context()            # opens LocalStore at $BRAIN2_DB_PATH, runs migrations
store = actx.store

store.create_tenant("default", "Example Org")
store.create_user("default", "ryan", "ryan@example.com", role="owner")
actx.passwords.set_password("default", "ryan", "abcd")
print("bootstrapped: tenant=default user=ryan@example.com")