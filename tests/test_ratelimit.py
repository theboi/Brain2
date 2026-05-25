from brain2.ratelimit import SlidingWindowLimiter


def test_allows_under_limit():
    clock = {"t": 0.0}
    lim = SlidingWindowLimiter(now_fn=lambda: clock["t"])
    for _ in range(5):
        assert lim.check("user:u1", limit=5, window_s=60) is True


def test_blocks_over_limit():
    clock = {"t": 0.0}
    lim = SlidingWindowLimiter(now_fn=lambda: clock["t"])
    for _ in range(5):
        lim.check("user:u1", limit=5, window_s=60)
    assert lim.check("user:u1", limit=5, window_s=60) is False  # 6th denied


def test_window_slides():
    clock = {"t": 0.0}
    lim = SlidingWindowLimiter(now_fn=lambda: clock["t"])
    for _ in range(5):
        lim.check("user:u1", limit=5, window_s=60)
    clock["t"] = 61.0  # old events expire
    assert lim.check("user:u1", limit=5, window_s=60) is True


def test_degraded_backend_falls_back_to_conservative_local_cap():
    class _BrokenShared:
        def incr(self, *a, **k):
            raise ConnectionError("redis down")
    lim = SlidingWindowLimiter(shared=_BrokenShared(), local_degraded_cap=2)
    assert lim.check("user:u1", limit=100, window_s=60) is True
    assert lim.check("user:u1", limit=100, window_s=60) is True
    assert lim.check("user:u1", limit=100, window_s=60) is False  # degraded cap=2
