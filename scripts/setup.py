#!/usr/bin/env python3
"""Complete Brain2 setup for a fresh install.

Handles everything from bootstrapping tenant/user to vault initialization to
optional test data seeding. Run this once after installing dependencies.

Interactive mode (prompts for all values):
  python scripts/setup.py

Non-interactive with defaults:
  python scripts/setup.py --tenant-id default --email alice@example.com \\
    --password change-me \\
    --tenant-name "My Organization" \\
    --user-name Alice

Reset everything (wipes DB and vault directories):
  python scripts/setup.py --reset --yes

With test data seeding:
  python scripts/setup.py --with-seed

Respects BRAIN2_ROOT, BRAIN2_DB_PATH, BRAIN2_SEED_VAULT_ROOT env vars.
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


def _now() -> str:
    """ISO 8601 timestamp in UTC."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _seed_root() -> Path:
    """Root directory for vault storage."""
    return Path(os.environ.get(
        "BRAIN2_SEED_VAULT_ROOT",
        str(Path.home() / "Knowledge" / "Brain2DevSeed")))


def _db_path() -> Path:
    """SQLite database path."""
    return Path(os.environ.get(
        "BRAIN2_DB_PATH",
        str(Path.home() / "Knowledge" / "Brain2" / "brain2.sqlite")))


class Setup:
    """Brain2 complete setup orchestrator."""

    def __init__(self):
        self.app_context = None

    def _build_app_context(self):
        """Lazy-load app context (triggers DB migration on first call)."""
        if self.app_context is None:
            from brain2.app_context import build_app_context
            self.app_context = build_app_context()
        return self.app_context

    @property
    def store(self):
        return self._build_app_context().store

    @property
    def actx(self):
        return self._build_app_context()

    def bootstrap_tenant(self, tenant_id: str, tenant_name: str) -> None:
        """Create tenant if it doesn't exist."""
        if self.store.get_tenant(tenant_id) is None:
            print(f"  Creating tenant '{tenant_id}' ({tenant_name})...")
            self.store.create_tenant(tenant_id, tenant_name)
        else:
            print(f"  Tenant '{tenant_id}' already exists, skipping.")

    def bootstrap_user(self, tenant_id: str, user_id: str, email: str,
                      password: str, role: str = "owner") -> None:
        """Create user and set password if not already created."""
        existing_id = self.store.get_user_id_by_email(tenant_id, email)
        if existing_id is None:
            print(f"  Creating user '{email}' (role: {role})...")
            self.store.create_user(tenant_id, user_id, email, role)
            self.actx.passwords.set_password(tenant_id, user_id, password)
        else:
            print(f"  User '{email}' already exists (user_id: {existing_id}), skipping.")

    def create_workspace(self, tenant_id: str, workspace_name: str) -> str:
        """Create workspace, return its ID."""
        # Check if workspace already exists
        for w in self.store.list_workspaces(tenant_id):
            if w.name == workspace_name:
                print(f"  Workspace '{workspace_name}' already exists "
                      f"(workspace_id: {w.workspace_id}), skipping.")
                return w.workspace_id

        print(f"  Creating workspace '{workspace_name}'...")
        ws = self.store.create_workspace(tenant_id, workspace_name)
        return ws.workspace_id

    def create_vault(self, tenant_id: str, project_id: str, project_name: str,
                    workspace_id: str, vault_root: Optional[Path] = None) -> Path:
        """Create vault directory structure and project, return vault path."""
        if vault_root is None:
            vault_root = _seed_root()

        vault_path = vault_root / project_id

        # Initialize vault directory
        from brain2.vault.init import init_vault_tree
        from brain2.vault.git import git_init_vault

        if not vault_path.exists():
            print(f"  Initializing vault at {vault_path}...")
            vault_path.mkdir(parents=True, exist_ok=True)
            init_vault_tree(vault_path)
            try:
                git_init_vault(vault_path, project_name=project_name,
                             tenant_id=tenant_id, project_id=project_id)
            except Exception as e:
                print(f"    (git init skipped: {e})")
        else:
            print(f"  Vault directory already exists at {vault_path}, skipping init.")

        # Create project in DB
        if self.store.get_project(tenant_id, project_id) is None:
            print(f"  Creating project '{project_name}' (project_id: {project_id})...")
            self.store.create_project(tenant_id, project_id, project_name,
                                    workspace_id=workspace_id)
        else:
            print(f"  Project '{project_id}' already exists, skipping.")

        # Link vault path to project
        self.store.set_project_vault_path(tenant_id, project_id, str(vault_path))

        return vault_path

    def seed_test_data(self, tenant_id: str) -> None:
        """Seed optional test vaults and data (like seed_dev_vault.py)."""
        from brain2.vault.indexer import reindex_vault
        from brain2.vault.fs import write_text_atomic

        print("\n  Seeding test vaults and data...")

        # Workspace 1: Science
        ws1_id = self.create_workspace(tenant_id, "Science")

        # Vault A: Cells & Microscopy
        vault_a_id = "cells-and-microscopy"
        vault_a_path = self.create_vault(
            tenant_id, vault_a_id, "Cells & Microscopy", ws1_id)

        pages_a = {
            "Cell theory": "# Cell theory\n\nAll living things are made of cells. "
                          "First described by [[Robert Hooke]] in [[Micrographia]] "
                          "(1665) and generalised by Schleiden and Schwann.\n",
            "Micrographia": "# Micrographia\n\n1665 work by [[Robert Hooke]] "
                           "describing observations made with a [[Microscopy|microscope]].\n",
            "Robert Hooke": "# Robert Hooke\n\nNatural philosopher; coined 'cell' "
                           "in [[Micrographia]].\n",
            "Microscopy": "# Microscopy\n\nThe technical art of seeing the small. "
                         "Enables [[Cell theory]] and modern biology.\n",
        }

        wiki_a = vault_a_path / "wiki"
        wiki_a.mkdir(parents=True, exist_ok=True)
        for topic, body in pages_a.items():
            fp = wiki_a / f"{topic}.md"
            if not fp.exists():
                write_text_atomic(fp, body)
                print(f"    Created wiki page: {topic}")

        reindex_vault(self.store, vault_a_id, vault_a_path)

        # Seed some sources
        sources_a = [
            ("file", "Hooke 1665.pdf", "Micrographia"),
            ("text", "Cell theory notes.txt", "Cell theory"),
        ]
        for kind, filename, topic in sources_a:
            existing = self.store._conn.execute(
                "SELECT source_id FROM sources WHERE tenant_id=? "
                "AND project_id=? AND filename=?",
                (tenant_id, vault_a_id, filename)
            ).fetchone()
            if not existing:
                self.store._conn.execute(
                    "INSERT INTO sources(source_id, tenant_id, project_id, kind, "
                    "filename, size_bytes, topic, status, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, 0, ?, 'extracted', ?, ?)",
                    (uuid.uuid4().hex, tenant_id, vault_a_id, kind, filename, topic,
                     _now(), _now()))
        self.store._conn.commit()

        # Workspace 2: Research
        ws2_id = self.create_workspace(tenant_id, "Research")

        # Vault B: Q3 User Research
        vault_b_id = "q3-user-research"
        vault_b_path = self.create_vault(
            tenant_id, vault_b_id, "Q3 User Research", ws2_id)

        pages_b = {
            "Q3 themes": "# Q3 themes\n\nSee [[Personas]] and [[Churn analysis]].\n",
            "Personas": "# Personas\n\nDerived from [[Q3 themes]].\n",
            "Churn analysis": "# Churn analysis\n\nLinked to [[Personas]].\n",
        }

        wiki_b = vault_b_path / "wiki"
        wiki_b.mkdir(parents=True, exist_ok=True)
        for topic, body in pages_b.items():
            fp = wiki_b / f"{topic}.md"
            if not fp.exists():
                write_text_atomic(fp, body)
                print(f"    Created wiki page: {topic}")

        reindex_vault(self.store, vault_b_id, vault_b_path)

        # Seed source for vault B
        sources_b = [("url", "https://example.com/survey", "Q3 themes")]
        for kind, filename, topic in sources_b:
            existing = self.store._conn.execute(
                "SELECT source_id FROM sources WHERE tenant_id=? "
                "AND project_id=? AND filename=?",
                (tenant_id, vault_b_id, filename)
            ).fetchone()
            if not existing:
                self.store._conn.execute(
                    "INSERT INTO sources(source_id, tenant_id, project_id, kind, "
                    "filename, size_bytes, topic, status, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, 0, ?, 'extracted', ?, ?)",
                    (uuid.uuid4().hex, tenant_id, vault_b_id, kind, filename, topic,
                     _now(), _now()))
        self.store._conn.commit()

        print(f"    Seeded {len(pages_a) + len(pages_b)} wiki pages across 2 vaults")

    def reset(self) -> None:
        """Reset everything: delete vault directories and DB file."""
        vault_root = _seed_root()
        db_path = _db_path()

        print("⚠️  This will delete:")
        print(f"  - {vault_root}")
        print(f"  - {db_path}")
        print()

        if vault_root.exists():
            print(f"Removing {vault_root}...")
            shutil.rmtree(vault_root)

        if db_path.exists():
            print(f"Removing {db_path}...")
            db_path.unlink()

        print("✓ Reset complete. Run setup again to initialize.")

    def run_interactive(self) -> None:
        """Interactive setup flow."""
        print("\n" + "=" * 60)
        print("Brain2 Setup — Fresh Install")
        print("=" * 60 + "\n")

        # Tenant setup
        print("Step 1: Tenant Configuration")
        print("-" * 40)
        tenant_id = input("  Tenant ID [default]: ").strip() or "default"
        tenant_name = input("  Tenant name [Default Tenant]: ").strip() or "Default Tenant"

        # User setup
        print("\nStep 2: Owner User Account")
        print("-" * 40)
        user_id = input("  User ID (short, internal) [alice]: ").strip() or "alice"
        email = input("  Email address [alice@example.com]: ").strip() or "alice@example.com"
        password = input("  Password [change-me-please]: ").strip() or "change-me-please"
        user_name = input("  Display name [Alice]: ").strip() or "Alice"

        # Workspace & vault setup
        print("\nStep 3: Workspace & Vault")
        print("-" * 40)
        create_vault = input("  Create a vault? [Y/n]: ").strip().lower() != "n"

        workspace_name = None
        vault_id = None
        vault_name = None

        if create_vault:
            workspace_name = input("  Workspace name [Default Workspace]: ").strip() or "Default Workspace"
            vault_id = input("  Vault/Project ID (short, kebab-case) [main-vault]: ").strip() or "main-vault"
            vault_name = input("  Vault name [Main Vault]: ").strip() or "Main Vault"

        # Optional seeding
        print("\nStep 4: Test Data (Optional)")
        print("-" * 40)
        with_seed = input("  Seed test vaults and data? [y/N]: ").strip().lower() == "y"

        print("\n" + "=" * 60)
        print("Summary")
        print("=" * 60)
        print(f"Tenant:     {tenant_id} ({tenant_name})")
        print(f"User:       {email} / {user_id}")
        print(f"Password:   {password}")
        if create_vault:
            print(f"Workspace:  {workspace_name}")
            print(f"Vault:      {vault_id} ({vault_name})")
        print(f"Test data:  {'Yes' if with_seed else 'No'}")
        print(f"Vault root: {_seed_root()}")
        print(f"DB path:    {_db_path()}")
        print()

        confirm = input("Proceed? [Y/n]: ").strip().lower() != "n"
        if not confirm:
            print("Aborted.")
            return

        print("\n" + "=" * 60)
        print("Initializing...")
        print("=" * 60 + "\n")

        # Execute setup
        print("Step 1: Tenant & User Bootstrap")
        print("-" * 40)
        self.bootstrap_tenant(tenant_id, tenant_name)
        self.bootstrap_user(tenant_id, user_id, email, password, role="owner")

        if create_vault:
            print("\nStep 2: Workspace & Vault Setup")
            print("-" * 40)
            ws_id = self.create_workspace(tenant_id, workspace_name)
            vault_path = self.create_vault(tenant_id, vault_id, vault_name, ws_id)

        if with_seed:
            print("\nStep 3: Test Data")
            print("-" * 40)
            self.seed_test_data(tenant_id)

        print("\n" + "=" * 60)
        print("✓ Setup Complete!")
        print("=" * 60)
        print()
        print("Next steps:")
        print("  1. Start the API server:")
        print("     .venv/bin/brain2-api")
        print()
        print("  2. Log in with:")
        print(f"     Email:    {email}")
        print(f"     Password: {password}")
        print()
        print("  3. Open http://localhost:8000/docs for interactive API docs")
        print()


def main():
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)

    p.add_argument("--reset", action="store_true",
                  help="Reset: delete vault dirs and DB (asks for confirmation)")
    p.add_argument("--yes", action="store_true",
                  help="Skip confirmation prompts (use with --reset)")

    p.add_argument("--tenant-id", default="default",
                  help="Tenant ID (default: default)")
    p.add_argument("--tenant-name", default="Default Tenant",
                  help="Tenant display name (default: Default Tenant)")
    p.add_argument("--email", default="alice@example.com",
                  help="Owner email (default: alice@example.com)")
    p.add_argument("--password", default="change-me-please",
                  help="Owner password (default: change-me-please)")
    p.add_argument("--user-id", default="alice",
                  help="Owner user ID (default: alice)")
    p.add_argument("--user-name", default="Alice",
                  help="Owner display name (default: Alice)")

    p.add_argument("--create-vault", action="store_true", default=False,
                  help="Create a default vault (requires --vault-id, --vault-name, "
                       "--workspace-name)")
    p.add_argument("--vault-id", default="main-vault",
                  help="Vault/project ID (default: main-vault)")
    p.add_argument("--vault-name", default="Main Vault",
                  help="Vault display name (default: Main Vault)")
    p.add_argument("--workspace-name", default="Default Workspace",
                  help="Workspace name (default: Default Workspace)")

    p.add_argument("--with-seed", action="store_true",
                  help="Seed test vaults and data (like seed_dev_vault.py)")

    p.add_argument("--non-interactive", action="store_true",
                  help="Use CLI args; don't prompt (implies --create-vault)")

    args = p.parse_args()

    setup = Setup()

    # Handle reset
    if args.reset:
        if not args.yes:
            ans = input(f"Wipe {_seed_root()} and {_db_path()}? [y/N]: ")
            if ans.strip().lower() != "y":
                print("Aborted.")
                return
        setup.reset()
        return

    # Non-interactive mode
    if args.non_interactive:
        print("=" * 60)
        print("Brain2 Setup — Non-Interactive")
        print("=" * 60 + "\n")

        print("Tenant & User Bootstrap")
        print("-" * 40)
        setup.bootstrap_tenant(args.tenant_id, args.tenant_name)
        setup.bootstrap_user(args.tenant_id, args.user_id, args.email,
                           args.password, role="owner")

        if args.create_vault:
            print("\nWorkspace & Vault Setup")
            print("-" * 40)
            ws_id = setup.create_workspace(args.tenant_id, args.workspace_name)
            vault_path = setup.create_vault(args.tenant_id, args.vault_id,
                                           args.vault_name, ws_id)

        if args.with_seed:
            print("\nTest Data Seeding")
            print("-" * 40)
            setup.seed_test_data(args.tenant_id)

        print("\n" + "=" * 60)
        print("✓ Setup Complete!")
        print("=" * 60)
        print(f"Login: {args.email} / {args.password}")
        return

    # Interactive mode (default)
    setup.run_interactive()


if __name__ == "__main__":
    main()
