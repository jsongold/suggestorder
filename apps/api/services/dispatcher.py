"""Destination dispatcher.

Resolves the store's destination_type to a concrete adapter, builds the
outbound payload, and records a DispatchLog row. Phase 1 only wires the
``standalone`` destination; ``square_pos`` raises NotImplementedError.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import DispatchLog, Entry, StandaloneOrder, Store, Tab, TabItem
from services.adapters.standalone_intake import StandaloneIntakeAdapter


# Phase 1 = no tax. Hook for later.
TAX_RATE = 0


def _money(amount: int, currency: str = "JPY") -> dict[str, Any]:
    return {"amount": int(amount), "currency": currency}


def _build_standalone_payload(
    *,
    store: Store,
    entry: Entry,
    tab: Tab,
    items: list[TabItem],
    closed_at: datetime,
) -> dict[str, Any]:
    line_items: list[dict[str, Any]] = []
    subtotal = 0
    inquiry_tags: set[str] = set()
    ai_assisted = False

    for it in items:
        line_subtotal = it.snapshot_price * it.quantity
        subtotal += line_subtotal
        line_items.append(
            {
                "line_id": str(it.id),
                "item_id": str(it.product_id),
                "name": it.snapshot_name,
                "quantity": it.quantity,
                "unit_price": _money(it.snapshot_price),
                "subtotal": _money(line_subtotal),
                "note": it.note,
            }
        )
        cs = it.cart_source or {}
        if cs.get("ai_assisted"):
            ai_assisted = True
        for tag in cs.get("inquiry_tags", []) or []:
            inquiry_tags.add(tag)

    tax = (subtotal * TAX_RATE) // 100
    total = subtotal + tax

    session_started_at = tab.session.created_at if tab.session else tab.created_at

    return {
        "schema_version": StandaloneIntakeAdapter.schema_version,
        "order_id": None,  # filled in by adapter after row insert
        "org_id": str(store.org_id),
        "store": {
            "id": str(store.id),
            "name": store.name,
            "timezone": store.timezone,
        },
        "entry": {
            "id": str(entry.id),
            "kind": entry.kind,
            "label": entry.label,
        },
        "session": {
            "id": str(tab.session_id),
            "started_at": session_started_at.isoformat() if session_started_at else None,
        },
        "mode": entry.mode,
        "closed_at": closed_at.isoformat(),
        "line_items": line_items,
        "totals": {
            "subtotal": _money(subtotal),
            "tax": _money(tax),
            "total": _money(total),
        },
        "cart_source": {
            "ai_assisted": ai_assisted,
            "inquiry_tags": sorted(inquiry_tags),
        },
        "payment": {"status": "unpaid"},
        "status": {
            "current": "received",
            "updated_at": closed_at.isoformat(),
            "history": [{"state": "received", "at": closed_at.isoformat()}],
        },
    }


class Dispatcher:
    """Routes a closed tab to the configured destination."""

    def __init__(self) -> None:
        self._standalone = StandaloneIntakeAdapter()

    async def dispatch_tab(
        self,
        *,
        store: Store,
        entry: Entry,
        tab: Tab,
        items: list[TabItem],
        db: AsyncSession,
    ) -> StandaloneOrder:
        closed_at = datetime.now(timezone.utc)

        if store.destination_type == "standalone":
            payload = _build_standalone_payload(
                store=store, entry=entry, tab=tab, items=items, closed_at=closed_at,
            )

            log = DispatchLog(
                tab_id=tab.id,
                store_id=store.id,
                destination_type="standalone",
                status="pending",
                payload=payload,
            )
            db.add(log)
            await db.flush()

            try:
                order = await self._standalone.dispatch(
                    payload=payload, store=store, tab=tab, db=db,
                )
            except Exception as exc:  # pragma: no cover - defensive
                log.status = "failed"
                log.error = str(exc)
                log.completed_at = datetime.now(timezone.utc)
                logger.exception("Standalone dispatch failed for tab {}", tab.id)
                raise

            log.status = "ok"
            log.response = {"standalone_order_id": str(order.id)}
            log.completed_at = datetime.now(timezone.utc)
            return order

        if store.destination_type == "square_pos":
            raise NotImplementedError("Square POS destination not implemented in Phase 1")

        raise NotImplementedError(
            f"Unknown destination_type: {store.destination_type}"
        )


_dispatcher = Dispatcher()


def get_dispatcher() -> Dispatcher:
    return _dispatcher
