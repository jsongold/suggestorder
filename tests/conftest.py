"""Shared fixtures for the Phase 1 e2e tests.

These tests talk to a live API instance and assume ``scripts/seed.py`` has
been run beforehand (or run it lazily via the ``seeded`` fixture).
"""
from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path
from typing import Any

import httpx
import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
SEED_SCRIPT = REPO_ROOT / "scripts" / "seed.py"
API_DIR = REPO_ROOT / "apps" / "api"


@pytest.fixture(scope="session")
def api_url() -> str:
    return os.environ.get("API_URL", "http://localhost:8000").rstrip("/")


@pytest.fixture(scope="session")
def web_base_url() -> str:
    return os.environ.get("WEB_BASE_URL", "http://localhost:3000").rstrip("/")


def _wait_for_api(api_url: str, timeout: float = 30.0) -> None:
    deadline = time.time() + timeout
    last_err: Exception | None = None
    while time.time() < deadline:
        try:
            resp = httpx.get(f"{api_url}/health", timeout=2.0)
            if resp.status_code == 200:
                return
        except Exception as exc:  # pragma: no cover - retry loop
            last_err = exc
        time.sleep(0.5)
    raise RuntimeError(
        f"API did not become healthy at {api_url} within {timeout}s "
        f"(last error: {last_err})"
    )


def _run_seed() -> dict[str, Any]:
    """Run scripts/seed.py and parse its summary back into a dict.

    Returns a dict shaped like::

        {
            "org_id": "...",
            "store_id": "...",
            "api_key": "...",
            "entries": [{"id": "...", "label": "...", "kind": "...", "mode": "..."}],
            "products": [{"id": "...", "name": "...", "price": 123}],
        }
    """
    env = os.environ.copy()
    env.setdefault("SEED_ENRICH", "0")
    # The seed script imports from apps/api (sqlalchemy, asyncpg, pgvector,
    # ...) so we invoke it via the API project's uv environment.
    proc = subprocess.run(
        ["uv", "run", "python", str(SEED_SCRIPT)],
        cwd=str(API_DIR),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"seed.py failed (exit {proc.returncode}):\n"
            f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
        )

    info: dict[str, Any] = {"entries": [], "products": []}
    section: str | None = None
    for raw in proc.stdout.splitlines():
        line = raw.rstrip()
        if line.startswith("org_id"):
            info["org_id"] = line.split(":", 1)[1].strip().split(" ", 1)[0]
        elif line.startswith("store_id"):
            info["store_id"] = line.split(":", 1)[1].strip().split(" ", 1)[0]
        elif line.startswith("api_key"):
            info["api_key"] = line.split(":", 1)[1].strip()
        elif line.startswith("Products:"):
            section = "products"
        elif line.startswith("Customer entry URLs:"):
            section = "entries"
        elif line.startswith("Merchant intake URL:"):
            section = None
        elif section == "products" and line.strip().startswith("- "):
            # "  - オーツラテ              ¥  620  id=<uuid>"
            parts = line.strip("- ").rsplit("id=", 1)
            id_part = parts[1].strip()
            left = parts[0].strip()
            # split price off the right
            name, _, price_str = left.rpartition("¥")
            price = int(price_str.strip())
            info["products"].append(
                {"id": id_part, "name": name.strip(), "price": price}
            )
        elif section == "entries" and line.strip().startswith("- "):
            # "  - テーブル1       (dine_in /send )  http://localhost:3000/e/<uuid>"
            body = line.strip("- ").strip()
            label, rest = body.split("(", 1)
            kind_mode, url_part = rest.split(")", 1)
            kind, mode = [s.strip() for s in kind_mode.split("/", 1)]
            entry_id = url_part.strip().rsplit("/", 1)[-1]
            info["entries"].append(
                {
                    "id": entry_id,
                    "label": label.strip(),
                    "kind": kind,
                    "mode": mode,
                }
            )

    required = {"org_id", "store_id", "api_key"}
    missing = required - info.keys()
    if missing:
        raise RuntimeError(
            f"seed.py output missing fields {missing}. Full stdout:\n{proc.stdout}"
        )
    return info


@pytest.fixture(scope="session")
def seeded(api_url: str) -> dict[str, Any]:
    """Run seed.py once per test session and return the parsed summary."""
    _wait_for_api(api_url)
    return _run_seed()


@pytest.fixture(scope="session")
def store(seeded: dict[str, Any]) -> dict[str, Any]:
    return {"id": seeded["store_id"], "api_key": seeded["api_key"]}


@pytest.fixture(scope="session")
def admin_headers(store: dict[str, Any]) -> dict[str, str]:
    return {"X-Api-Key": store["api_key"], "X-Store-ID": str(store["id"])}


@pytest.fixture(scope="session")
def intake_headers(store: dict[str, Any]) -> dict[str, str]:
    return {"X-Api-Key": store["api_key"], "X-Store-ID": str(store["id"])}
