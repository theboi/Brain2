from brain2_telegram.bot import build_application
from brain2_telegram.config import TgConfig


def _cfg(tmp_path):
    return TgConfig(bot_token="123:abc", api_url="http://x", service_key="svc",
                    owner_id=42, db_path=str(tmp_path / "s.sqlite"), poll_timeout=30)


def test_build_application_registers_core_commands(tmp_path):
    app = build_application(_cfg(tmp_path))
    # bot_data wired
    assert "client" in app.bot_data and "sessions" in app.bot_data and "cfg" in app.bot_data

    # collect registered command triggers, descending into ConversationHandler
    # entry points (setup/link/create_user are CommandHandler entry points nested
    # inside ConversationHandlers, not top-level handlers with a .commands attr).
    def _collect(h, acc):
        cmds = getattr(h, "commands", None)
        if cmds:
            acc |= set(cmds)
        for ep in getattr(h, "entry_points", []):
            _collect(ep, acc)

    commands = set()
    for group in app.handlers.values():
        for h in group:
            _collect(h, commands)
    assert {"start", "setup", "link", "create_user", "list_users", "ops", "op",
            "mode"} <= commands


def test_mode_toggle_is_stubbed(tmp_path):
    # NLP mode is a stub for now: the handler exists but only flips the flag.
    from brain2_telegram.bot import _NLP_STUB_MESSAGE
    assert "coming soon" in _NLP_STUB_MESSAGE.lower()
