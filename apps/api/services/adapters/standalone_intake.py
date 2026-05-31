"""Standalone destination adapter.

Persists a StandaloneOrder row with a self-contained payload that the
merchant intake UI can poll directly. No external HTTP call is made — the
"destination" is the suggestorder DB itself.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from db.models import StandaloneOrder, Store, Tab


class StandaloneIntakeAdapter:
    """Writes the closed-tab payload into the local intake store."""

    destination_type = "standalone"
    schema_version = "1.0"

    async def dispatch(
        self,
        *,
        payload: dict,
        store: Store,
        tab: Tab,
        db: AsyncSession,
    ) -> StandaloneOrder:
        order = StandaloneOrder(
            store_id=store.id,
            tab_id=tab.id,
            entry_id=tab.entry_id,
            payload=payload,
            status="received",
            payment_status=payload.get("payment", {}).get("status", "unpaid"),
            status_history=[
                {
                    "state": "received",
                    "at": datetime.now(timezone.utc).isoformat(),
                }
            ],
        )
        db.add(order)
        await db.flush()
        # Backfill the order_id we generated into the stored payload so that
        # the persisted JSON matches what a downstream consumer would see.
        payload["order_id"] = str(order.id)
        order.payload = payload
        return order
