"""Single-process runtime: worker tick runs tasks + drains events; brain2-init bootstrap."""
import json

from brain2.app_context import build_app_context
from brain2.init_cmd import init_tenant
from brain2.runtime import run_worker, worker_tick
from brain2.store.local import LocalStore
from brain2.tasks.queue import enqueue


def _actx():
    store = LocalStore(":memory:")
    store.migrate()
    store.create_tenant("t1", "Acme")
    return build_app_context(store=store, gateway=object())


def test_worker_runs_enqueued_task():
    actx = _actx()
    ran = []
    # Convention: claim_task returns payload as a JSON string; handlers parse it.
    actx.tasks.register("demo", lambda task: ran.append(json.loads(task["payload"])))
    with actx.store.transaction() as cx:
        enqueue(actx.store, cx, "t1", "demo", {"n": 7})
    run_worker(actx, max_ticks=5)
    assert ran and ran[0] == {"n": 7}


def test_worker_drains_event_to_subscriber():
    actx = _actx()
    seen = []
    actx.events.on("thing_happened", "sub1", lambda ev: seen.append(ev["event_type"]))
    with actx.store.transaction() as cx:
        actx.store.emit_event_in_txn(cx, "t1", "thing_happened", "ent:1", {"x": 1})
    run_worker(actx, max_ticks=5)
    assert seen == ["thing_happened"]
    # event was acked (delivered), not left claimable
    remaining = actx.store.claim_events(["t1"], 10, "9999-01-01T00:00:00+00:00")
    assert remaining == []


def test_worker_tick_noop_when_idle():
    actx = _actx()
    assert worker_tick(actx.store, actx.tasks, actx.events) is False


def test_app_context_does_not_seed_workers_and_runtime_registers_only_itself():
    actx = _actx()
    assert actx.store.list_workers("t1") == []
    run_worker(actx, max_ticks=1, agent_name="Terra")
    workers = actx.store.list_workers("t1")
    assert [(worker["name"], worker["status"]) for worker in workers] == [("Terra", "idle")]


def test_named_runtimes_remain_distinct():
    actx = _actx()
    run_worker(actx, max_ticks=1, agent_name="Terra")
    run_worker(actx, max_ticks=1, agent_name="Atlas")
    assert {worker["name"] for worker in actx.store.list_workers("t1")} == {"Terra", "Atlas"}


def test_init_tenant_bootstraps_and_token_works():
    store = LocalStore(":memory:")
    store.migrate()
    actx = build_app_context(store=store, gateway=object())
    result = init_tenant(actx, tenant_id="acme", name="Acme Inc",
                         email="owner@acme.com", password="s3cret!")
    assert result["token"]
    # password verifies and the issued token resolves to the owner
    actx.passwords.verify_password("acme", result["user_id"], "s3cret!")  # no raise
    ctx = actx.tokens.validate(result["token"])
    assert ctx.tenant_id == "acme" and ctx.user_id == result["user_id"]
