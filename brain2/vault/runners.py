"""Single place to assemble the type→runner table for the dispatcher."""
from __future__ import annotations
from brain2.vault.ingest_dynamic import run_dynamic
from brain2.vault.ingest_static import run_static
from brain2.vault.ingest_wiki import run_wiki


def build_runners(store, gateway):
    return {
        "wiki":    lambda req: run_wiki(store, gateway, req),
        "static":  lambda req: run_static(store, gateway, req),
        "dynamic": lambda req: run_dynamic(store, gateway, req),
    }
