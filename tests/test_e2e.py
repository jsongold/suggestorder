"""End-to-end happy-path tests for suggestorder MVP Phase 1.

Prerequisites:
    * Docker DB + Redis are up: ``docker compose up -d db redis``
    * API is running on $API_URL (default http://localhost:8000), e.g.::

          make api

    * ``scripts/seed.py`` can be invoked by the test session — the ``seeded``
      fixture in conftest.py runs it for you and parses its output into a
      dict containing the org_id, store_id, api_key, entries and products.

Run with::

    uv run pytest tests/test_e2e.py -v

The tests cover the full Phase 1 flow described in
``docs/mvp-phase1-spec.md`` §8 (customer) and §9 (merchant intake).
"""
from __future__ import annotations

from typing import Any

import httpx
import pytest


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

async def test_health(api_url: str) -> None:
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(f"{api_url}/health")
    assert resp.status_code == 200, resp.text
    assert resp.json().get("status") == "ok"


# ---------------------------------------------------------------------------
# Seed sanity
# ---------------------------------------------------------------------------

def test_seed_shape(seeded: dict[str, Any]) -> None:
    """seed.py must produce 3 entries and 6 products and a usable api_key."""
    assert seeded["api_key"], seeded
    assert len(seeded["entries"]) == 3, seeded["entries"]
    assert len(seeded["products"]) == 6, seeded["products"]
    labels = {e["label"] for e in seeded["entries"]}
    assert {"テーブル1", "テーブル2", "テイクアウト"}.issubset(labels), labels


# ---------------------------------------------------------------------------
# Customer flow (§8 of spec)
# ---------------------------------------------------------------------------

async def test_customer_happy_path(
    api_url: str,
    seeded: dict[str, Any],
    intake_headers: dict[str, str],
) -> None:
    """Full customer flow + merchant status walk + idempotency guard.

    Steps:
      1.  GET /entries/{entry_id}                -> store + entry context
      2.  POST /sessions {entry_id}              -> session_id + cookie
      3.  GET /catalog/{store_id}/products       -> 6 products
      4.  POST /sessions/{id}/suggest            -> up to 3 suggestions
      5.  GET /sessions/{id}/tab                 -> empty open tab
      6.  POST /sessions/{id}/tab/items x2       -> tab has 2 items
      7.  POST /sessions/{id}/tab/close          -> order_id
      8.  GET /intake/{store}/orders?status=active -> 1 active order
      9.  PATCH .../status (preparing, ready, handed)
      10. GET /intake/{store}/orders?status=active -> 0 active orders
      11. POST /sessions/{id}/tab/close (again)  -> returns same order_id
    """
    store_id = seeded["store_id"]
    entry = seeded["entries"][0]  # テーブル1 / dine_in / send
    entry_id = entry["id"]
    products = seeded["products"]

    async with httpx.AsyncClient(timeout=30.0) as client:
        # --- 1. Entry context ---
        resp = await client.get(f"{api_url}/entries/{entry_id}")
        assert resp.status_code == 200, resp.text
        ctx = resp.json()
        assert ctx["id"] == entry_id
        assert ctx["mode"] == "send"
        assert ctx["store"]["id"] == store_id

        # --- 2. Start session ---
        resp = await client.post(
            f"{api_url}/sessions",
            json={"entry_id": entry_id},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        session_id = body["session_id"]
        assert body["store_id"] == store_id
        assert body["entry"]["id"] == entry_id
        # Cookie must be set so subsequent requests are recognized as the
        # same logical client.
        assert "so_sid" in client.cookies, dict(client.cookies)

        # --- 3. Catalog ---
        resp = await client.get(f"{api_url}/catalog/{store_id}/products")
        assert resp.status_code == 200, resp.text
        catalog = resp.json()
        assert len(catalog) == 6, [p["name"] for p in catalog]
        seeded_ids = {p["id"] for p in products}
        assert seeded_ids == {p["id"] for p in catalog}

        # --- 4. Suggest ---
        resp = await client.post(
            f"{api_url}/sessions/{session_id}/suggest",
            json={"selections": {"tags": ["cold"]}},
        )
        assert resp.status_code == 200, resp.text
        suggest_body = resp.json()
        assert "suggestions" in suggest_body
        assert isinstance(suggest_body["suggestions"], list)
        # Spec says "Top 3" but the suggester may legitimately return fewer
        # if not enough matching items exist; require at least 1 and at most 3.
        assert 1 <= len(suggest_body["suggestions"]) <= 3, suggest_body

        # --- 5. Empty open tab ---
        resp = await client.get(f"{api_url}/sessions/{session_id}/tab")
        assert resp.status_code == 200, resp.text
        tab = resp.json()
        assert tab["state"] == "open"
        assert tab["session_id"] == session_id
        assert tab["items"] == []
        assert tab["totals"]["total"] == 0

        # --- 6. Add two items ---
        first = products[0]
        second = products[1]

        resp = await client.post(
            f"{api_url}/sessions/{session_id}/tab/items",
            json={"product_id": first["id"], "quantity": 2},
        )
        assert resp.status_code in (200, 201), resp.text
        tab = resp.json()
        assert len(tab["items"]) == 1
        assert tab["items"][0]["product_id"] == first["id"]
        assert tab["items"][0]["quantity"] == 2
        assert tab["totals"]["subtotal"] == first["price"] * 2

        resp = await client.post(
            f"{api_url}/sessions/{session_id}/tab/items",
            json={"product_id": second["id"], "quantity": 1},
        )
        assert resp.status_code in (200, 201), resp.text
        tab = resp.json()
        assert len(tab["items"]) == 2
        expected_subtotal = first["price"] * 2 + second["price"]
        assert tab["totals"]["subtotal"] == expected_subtotal
        # Phase 1: tax = 0, so total == subtotal.
        assert tab["totals"]["total"] == expected_subtotal
        assert tab["totals"]["tax"] == 0

        # --- 7. Close tab ---
        resp = await client.post(f"{api_url}/sessions/{session_id}/tab/close")
        assert resp.status_code == 200, resp.text
        close_body = resp.json()
        order_id = close_body["order_id"]
        assert order_id, close_body
        assert close_body["tab_id"] == tab["id"]

        # --- 8. Intake list shows 1 active order ---
        resp = await client.get(
            f"{api_url}/intake/{store_id}/orders",
            params={"status": "active"},
            headers=intake_headers,
        )
        assert resp.status_code == 200, resp.text
        orders = resp.json()
        # The API may return either a list or a paginated envelope; handle both.
        order_list = orders if isinstance(orders, list) else orders.get("items", [])
        ids = [o["id"] for o in order_list]
        assert order_id in ids, ids

        # --- 9. Advance status through the happy path ---
        for state in ("preparing", "ready", "handed"):
            resp = await client.patch(
                f"{api_url}/intake/{store_id}/orders/{order_id}/status",
                json={"state": state},
                headers=intake_headers,
            )
            assert resp.status_code == 200, (
                f"PATCH status -> {state} failed: {resp.status_code} {resp.text}"
            )
            body = resp.json()
            # API may echo the order or just an ack — both fine, but if
            # an order body is returned the status must reflect the update.
            if isinstance(body, dict) and "status" in body:
                assert body["status"] == state, body

        # --- 10. Active list is now empty (handed is terminal) ---
        resp = await client.get(
            f"{api_url}/intake/{store_id}/orders",
            params={"status": "active"},
            headers=intake_headers,
        )
        assert resp.status_code == 200, resp.text
        orders = resp.json()
        order_list = orders if isinstance(orders, list) else orders.get("items", [])
        assert order_id not in [o["id"] for o in order_list], [
            o["id"] for o in order_list
        ]

        # --- 11. Idempotent re-close: same order_id, no new StandaloneOrder ---
        resp = await client.post(f"{api_url}/sessions/{session_id}/tab/close")
        assert resp.status_code == 200, resp.text
        second_close = resp.json()
        assert second_close["order_id"] == order_id, second_close
        assert second_close["tab_id"] == tab["id"]


# ---------------------------------------------------------------------------
# Negative paths (cheap sanity checks)
# ---------------------------------------------------------------------------

async def test_intake_requires_api_key(api_url: str, seeded: dict[str, Any]) -> None:
    """Calling intake without the X-Api-Key/X-Store-ID headers must fail."""
    store_id = seeded["store_id"]
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(f"{api_url}/intake/{store_id}/orders")
    assert resp.status_code in (401, 403, 422), resp.status_code


async def test_intake_rejects_wrong_api_key(
    api_url: str, seeded: dict[str, Any]
) -> None:
    store_id = seeded["store_id"]
    bad_headers = {"X-Api-Key": "nope", "X-Store-ID": store_id}
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(
            f"{api_url}/intake/{store_id}/orders", headers=bad_headers
        )
    assert resp.status_code in (401, 403), resp.status_code


# ---------------------------------------------------------------------------
# Admin bootstrap (name-only store creation auto-creates an Org)
# ---------------------------------------------------------------------------

async def test_admin_signup_creates_org_then_store(api_url: str) -> None:
    """/admin signup creates an Org first, then a Store under it.

    Mirrors what apps/web/app/admin/page.tsx does on form submit: a chained
    POST /admin/orgs followed by POST /admin/stores with the returned org_id.
    Finally /admin/stores?org_id= must list the new store under its org.
    """
    org_name = "Bootstrap 株式会社"
    store_name = "Bootstrap Cafe 1号店"
    async with httpx.AsyncClient(timeout=10.0) as client:
        # 1. Create Org
        org_resp = await client.post(
            f"{api_url}/admin/orgs", json={"name": org_name}
        )
        assert org_resp.status_code == 200, org_resp.text
        org = org_resp.json()
        assert org["name"] == org_name
        assert org["id"]

        # 2. Create Store under that Org (422 if org_id is missing — see admin/page.tsx)
        store_resp = await client.post(
            f"{api_url}/admin/stores",
            json={"org_id": org["id"], "name": store_name},
        )
        assert store_resp.status_code == 200, store_resp.text
        store = store_resp.json()
        assert store["name"] == store_name
        assert store["org_id"] == org["id"]
        assert store["api_key"]

        # 3. Org admin page (/admin/[org_id]) loads stores via this query
        list_resp = await client.get(
            f"{api_url}/admin/stores", params={"org_id": org["id"]}
        )
        assert list_resp.status_code == 200, list_resp.text
        ids = [s["id"] for s in list_resp.json()]
        assert store["id"] in ids

        # 4. /admin/[org_id]/[store_id] signin needs to resolve org_id from
        #    store_id alone — this is the GET /admin/stores/{store_id} path.
        store_get = await client.get(f"{api_url}/admin/stores/{store['id']}")
        assert store_get.status_code == 200, store_get.text
        assert store_get.json()["org_id"] == org["id"]


async def test_admin_get_store_404(api_url: str) -> None:
    """GET /admin/stores/{unknown_uuid} must 404 (signin form depends on this
    to flag bad Store IDs before redirecting)."""
    bogus = "00000000-0000-0000-0000-000000000000"
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(f"{api_url}/admin/stores/{bogus}")
    assert resp.status_code == 404, resp.text


# ---------------------------------------------------------------------------
# AI catalog generation (POST /admin/products/generate)
# ---------------------------------------------------------------------------

async def test_admin_generate_requires_auth(
    api_url: str, seeded: dict[str, Any]
) -> None:
    """Generate must reject calls without X-Api-Key/X-Store-ID."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"{api_url}/admin/products/generate",
            json={"prompt": "anything"},
        )
    assert resp.status_code in (401, 403, 422), resp.status_code


async def test_admin_generate_rejects_empty_prompt(
    api_url: str, admin_headers: dict[str, str]
) -> None:
    """Empty prompt is blocked by Pydantic min_length=1 before any LLM call."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"{api_url}/admin/products/generate",
            headers=admin_headers,
            json={"prompt": ""},
        )
    assert resp.status_code == 422, resp.text


# ---------------------------------------------------------------------------
# QR page data source (entries listing)
# ---------------------------------------------------------------------------

async def test_admin_list_entries_for_qr(
    api_url: str, seeded: dict[str, Any]
) -> None:
    """/admin/[org_id]/[store_id]/customer loads entries via this endpoint."""
    store_id = seeded["store_id"]
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(f"{api_url}/admin/stores/{store_id}/entries")
    assert resp.status_code == 200, resp.text
    entries = resp.json()
    assert len(entries) == len(seeded["entries"])
    assert all("id" in e and "label" in e for e in entries)


async def test_admin_entry_create_and_delete(
    api_url: str, seeded: dict[str, Any]
) -> None:
    """Customer admin page creates an Entry and can delete it when no orders."""
    store_id = seeded["store_id"]
    async with httpx.AsyncClient(timeout=10.0) as client:
        create = await client.post(
            f"{api_url}/admin/stores/{store_id}/entries",
            json={"label": "テーブル99", "kind": "dine_in", "mode": "send"},
        )
        assert create.status_code == 200, create.text
        entry = create.json()
        assert entry["label"] == "テーブル99"

        delete = await client.delete(f"{api_url}/admin/entries/{entry['id']}")
        assert delete.status_code == 204, delete.text

        # follow-up: gone
        listing = await client.get(f"{api_url}/admin/stores/{store_id}/entries")
        ids = [e["id"] for e in listing.json()]
        assert entry["id"] not in ids


async def test_admin_entry_delete_blocks_when_referenced(
    api_url: str, seeded: dict[str, Any], intake_headers: dict[str, str]
) -> None:
    """Deleting a seeded Entry that has tabs/orders must return 409, not 500.

    The full customer happy-path test has already created a Session and Tab
    against the first seeded entry, so this hits the referenced-FK branch.
    """
    referenced_entry = seeded["entries"][0]
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.delete(
            f"{api_url}/admin/entries/{referenced_entry['id']}"
        )
    assert resp.status_code == 409, resp.text


async def test_admin_entry_delete_404(api_url: str) -> None:
    bogus = "00000000-0000-0000-0000-000000000000"
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.delete(f"{api_url}/admin/entries/{bogus}")
    assert resp.status_code == 404, resp.text


async def test_admin_create_store_requires_org_id(api_url: str) -> None:
    """Posting /admin/stores without org_id (the original 422 bug) must still 422.

    Guards against silently re-introducing implicit Org creation on the API
    side: signup must go through the explicit /admin/orgs step first.
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"{api_url}/admin/stores", json={"name": "no org cafe"}
        )
    assert resp.status_code == 422, resp.text
