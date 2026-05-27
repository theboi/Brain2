"""Entrypoint: `brain2-telegram` / `python -m brain2_telegram`."""
from __future__ import annotations

from brain2_telegram.bot import run
from brain2_telegram.config import load_tg_config


def main() -> None:
    run(load_tg_config())


if __name__ == "__main__":
    main()
