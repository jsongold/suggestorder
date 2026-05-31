#!/usr/bin/env python3
"""Phase 1 seed script.

Wipes all rows from the suggestorder tables and inserts a known set of fixtures
so the Phase 1 customer + merchant flows can be exercised end to end.

What it creates:
    * 1 Org   : "Demo Cafe Org"
    * 1 Store : "カフカ渋谷店"  (standalone destination, stub payment, Asia/Tokyo)
    * 3 Entries:
        - "テーブル1"     (dine_in / send)
        - "テーブル2"     (dine_in / send)
        - "テイクアウト"  (takeout / send)
    * 6 Products with realistic Japanese cafe items, hand-curated
      descriptions and tags (no LLM call required for repeatable seeding).

Usage:
    # DB must be reachable (docker compose up -d db redis)
    uv run python scripts/seed.py

Environment:
    DATABASE_URL  - SQLAlchemy URL (default: postgresql+asyncpg://suggestorder:suggestorder@localhost:5432/suggestorder)
    SEED_ENRICH   - "1" to additionally run CatalogGen against every product
                    (requires OPENAI_API_KEY). Default is to skip and use the
                    static descriptions/tags shipped in this file.

The script is fully idempotent: it deletes every row from every Phase 1 table
in FK-safe order before inserting. For a clean slate including schema:
    docker compose down -v && docker compose up -d db redis
"""
from __future__ import annotations

import asyncio
import os
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path

# Make `apps/api` importable so we can reuse the project's models/client.
_REPO_ROOT = Path(__file__).resolve().parent.parent
_API_ROOT = _REPO_ROOT / "apps" / "api"
if str(_API_ROOT) not in sys.path:
    sys.path.insert(0, str(_API_ROOT))

# Default the env vars before importing the API package — `db.client.Settings`
# requires them at import time.
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://suggestorder:suggestorder@localhost:5432/suggestorder",
)
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
os.environ.setdefault("OPENAI_API_KEY", "sk-seed-placeholder")
os.environ.setdefault("STORE_API_KEY", "seed-placeholder")

from sqlalchemy import text  # noqa: E402

from db.client import Base, SessionLocal, engine  # noqa: E402
from db.models import (  # noqa: E402
    DispatchLog,
    Entry,
    Org,
    Product,
    Session,
    StandaloneOrder,
    Store,
    SuggestionLog,
    Tab,
    TabItem,
)


WEB_BASE = os.environ.get("WEB_BASE_URL", "http://localhost:3000").rstrip("/")


# ---------------------------------------------------------------------------
# Fixture data
# ---------------------------------------------------------------------------

ORG_NAME = "Demo Cafe Org"

STORE_FIXTURE = {
    "name": "カフカ渋谷店",
    "timezone": "Asia/Tokyo",
    "destination_type": "standalone",
    "payment_channel": "stub",
}

ENTRY_FIXTURES = [
    {"label": "テーブル1", "kind": "dine_in", "mode": "send"},
    {"label": "テーブル2", "kind": "dine_in", "mode": "send"},
    {"label": "テイクアウト", "kind": "takeout", "mode": "send"},
]

PRODUCT_FIXTURES = [
    {
        "name": "オーツラテ",
        "price": 620,
        "category": "drink",
        "description": "オーツミルクで作るまろやかなラテ。植物性で軽やかな後味。",
        "tags": ["hot", "milk", "vegan", "smooth", "coffee"],
        "attributes": {
            "temperature": "hot",
            "sweetness": "low",
            "milk": "oat",
        },
    },
    {
        "name": "アイスコーヒー",
        "price": 500,
        "category": "drink",
        "description": "深煎り豆を時間をかけて抽出したすっきりとしたアイスコーヒー。",
        "tags": ["cold", "coffee", "bitter", "refreshing"],
        "attributes": {
            "temperature": "cold",
            "sweetness": "none",
            "caffeine": "high",
        },
    },
    {
        "name": "キャロットケーキ",
        "price": 580,
        "category": "sweets",
        "description": "クリームチーズフロスティングをのせたしっとりキャロットケーキ。",
        "tags": ["sweet", "cake", "cream_cheese", "spiced"],
        "attributes": {
            "temperature": "room",
            "sweetness": "high",
            "contains": ["nuts", "dairy"],
        },
    },
    {
        "name": "アボカドトースト",
        "price": 880,
        "category": "food",
        "description": "サワードウにアボカド、レモン、チリフレークをのせた軽食。",
        "tags": ["savory", "brunch", "veggie", "fresh"],
        "attributes": {
            "temperature": "warm",
            "spiciness": "mild",
            "filling": "medium",
        },
    },
    {
        "name": "ホットサンド",
        "price": 780,
        "category": "food",
        "description": "ハムとチェダーチーズのホットサンド。外はカリッと中はとろける。",
        "tags": ["savory", "warm", "filling", "lunch"],
        "attributes": {
            "temperature": "hot",
            "filling": "high",
            "contains": ["dairy", "gluten"],
        },
    },
    {
        "name": "緑茶ラテ",
        "price": 600,
        "category": "drink",
        "description": "宇治抹茶を使った優しい甘さの緑茶ラテ。ホット/アイス対応。",
        "tags": ["hot", "milk", "matcha", "sweet", "tea"],
        "attributes": {
            "temperature": "hot",
            "sweetness": "medium",
            "caffeine": "medium",
        },
    },
]


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

# Order matters: child tables first so FK cascades aren't required.
_TRUNCATE_ORDER = [
    SuggestionLog,
    DispatchLog,
    StandaloneOrder,
    TabItem,
    Tab,
    Session,
    Product,
    Entry,
    Store,
    Org,
]


async def ensure_schema() -> None:
    """Create the pgvector extension and every Phase 1 table if missing."""
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))
        await conn.run_sync(Base.metadata.create_all)


async def wipe_all() -> None:
    async with SessionLocal() as db:
        for model in _TRUNCATE_ORDER:
            await db.execute(text(f'DELETE FROM "{model.__tablename__}";'))
        await db.commit()


async def maybe_enrich(product_ids: list) -> None:
    """Optionally run CatalogGen LLM enrichment against the seeded products."""
    if os.environ.get("SEED_ENRICH") != "1":
        return
    try:
        from services import catalog_gen  # noqa: WPS433
    except Exception as exc:  # pragma: no cover - optional path
        print(f"  ! SEED_ENRICH=1 but CatalogGen import failed: {exc}")
        return

    print("  Running CatalogGen enrichment (this calls OpenAI)...")
    async with SessionLocal() as db:
        for pid in product_ids:
            try:
                await catalog_gen.enrich_product(pid, db)
                print(f"    + enriched {pid}")
            except Exception as exc:  # pragma: no cover - network errors
                print(f"    ! enrichment failed for {pid}: {exc}")


# ---------------------------------------------------------------------------
# Seed
# ---------------------------------------------------------------------------

async def seed() -> dict:
    await ensure_schema()
    await wipe_all()

    now = datetime.now(timezone.utc)

    async with SessionLocal() as db:
        org = Org(name=ORG_NAME, created_at=now)
        db.add(org)
        await db.flush()

        store = Store(
            org_id=org.id,
            name=STORE_FIXTURE["name"],
            timezone=STORE_FIXTURE["timezone"],
            destination_type=STORE_FIXTURE["destination_type"],
            payment_channel=STORE_FIXTURE["payment_channel"],
            api_key=secrets.token_hex(16),
            created_at=now,
        )
        db.add(store)
        await db.flush()

        entries: list[Entry] = []
        for fx in ENTRY_FIXTURES:
            entry = Entry(
                store_id=store.id,
                label=fx["label"],
                kind=fx["kind"],
                mode=fx["mode"],
                is_active=True,
                created_at=now,
            )
            db.add(entry)
            entries.append(entry)
        await db.flush()

        products: list[Product] = []
        for fx in PRODUCT_FIXTURES:
            prod = Product(
                store_id=store.id,
                name=fx["name"],
                price=fx["price"],
                category=fx["category"],
                description=fx["description"],
                tags=list(fx["tags"]),
                attributes=dict(fx["attributes"]),
                is_available=True,
                enriched_at=now,  # treat static descriptions as already enriched
                created_at=now,
                updated_at=now,
            )
            db.add(prod)
            products.append(prod)

        await db.commit()

        result = {
            "org_id": str(org.id),
            "store_id": str(store.id),
            "store_name": store.name,
            "api_key": store.api_key,
            "entries": [
                {"id": str(e.id), "label": e.label, "kind": e.kind, "mode": e.mode}
                for e in entries
            ],
            "products": [
                {"id": str(p.id), "name": p.name, "price": p.price} for p in products
            ],
        }

    await maybe_enrich([p["id"] for p in result["products"]])

    return result


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def print_summary(info: dict) -> None:
    line = "=" * 72
    print(line)
    print("suggestorder seed complete")
    print(line)
    print(f"org_id    : {info['org_id']}  ({ORG_NAME})")
    print(f"store_id  : {info['store_id']}  ({info['store_name']})")
    print(f"api_key   : {info['api_key']}")
    print()
    print("Products:")
    for p in info["products"]:
        print(f"  - {p['name']:<20}  ¥{p['price']:>5}  id={p['id']}")
    print()
    print("Customer entry URLs:")
    for e in info["entries"]:
        url = f"{WEB_BASE}/e/{e['id']}"
        print(f"  - {e['label']:<14} ({e['kind']:<8}/{e['mode']:<4})  {url}")
    print()
    print("Merchant intake URL:")
    print(f"  {WEB_BASE}/merchant/{info['store_id']}/intake")
    print(f"  (X-Api-Key: {info['api_key']})")
    print()
    print("Reset DB:")
    print("  docker compose down -v && docker compose up -d db redis")
    print(line)


def main() -> None:
    info = asyncio.run(seed())
    print_summary(info)


if __name__ == "__main__":
    main()
