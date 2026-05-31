"""Merchant intake API for the Standalone destination.

Auth: ``X-Api-Key`` (must match the store's api_key). The store_id is taken
from the path; no separate ``X-Store-ID`` header is required for these
routes since the path already carries it.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.client import get_db
from db.models import StandaloneOrder, Store
from schemas import (
    StandaloneOrderOut,
    StandaloneOrderPaymentUpdate,
    StandaloneOrderStatusUpdate,
)

router = APIRouter()


ACTIVE_STATUSES = {"received", "preparing", "ready"}
TERMINAL_STATUSES = {"handed", "canceled"}
FORWARD_ORDER = ["received", "preparing", "ready", "handed"]


async def _authenticate_store(
    store_id: UUID,
    x_api_key: str = Header(..., alias="X-Api-Key"),
    db: AsyncSession = Depends(get_db),
) -> Store:
    result = await db.execute(
        select(Store).where(Store.id == store_id, Store.api_key == x_api_key)
    )
    store = result.scalar_one_or_none()
    if not store:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return store


def _validate_transition(current: str, target: str) -> None:
    if current in TERMINAL_STATUSES:
        raise HTTPException(
            status_code=409, detail=f"Order is already terminal ({current})"
        )
    if target == "canceled":
        return  # cancel is reachable from any non-terminal state
    if target not in FORWARD_ORDER:
        raise HTTPException(status_code=400, detail=f"Unknown target state: {target}")
    if FORWARD_ORDER.index(target) <= FORWARD_ORDER.index(current):
        raise HTTPException(
            status_code=409,
            detail=f"Invalid transition: {current} → {target} (no backward)",
        )


@router.get("/{store_id}/orders", response_model=list[StandaloneOrderOut])
async def list_orders(
    store_id: UUID,
    status: str | None = Query(default=None, description="active|all|<state>"),
    since: datetime | None = Query(default=None),
    store: Store = Depends(_authenticate_store),
    db: AsyncSession = Depends(get_db),
) -> list[StandaloneOrder]:
    stmt = select(StandaloneOrder).where(StandaloneOrder.store_id == store_id)

    if status is None or status == "all":
        pass
    elif status == "active":
        stmt = stmt.where(StandaloneOrder.status.in_(list(ACTIVE_STATUSES)))
    else:
        stmt = stmt.where(StandaloneOrder.status == status)

    if since is not None:
        # Treat naive datetimes as UTC for safe comparison.
        if since.tzinfo is None:
            since = since.replace(tzinfo=timezone.utc)
        stmt = stmt.where(StandaloneOrder.updated_at > since)

    stmt = stmt.order_by(StandaloneOrder.received_at.desc())
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.get("/{store_id}/orders/{order_id}", response_model=StandaloneOrderOut)
async def get_order(
    store_id: UUID,
    order_id: UUID,
    store: Store = Depends(_authenticate_store),
    db: AsyncSession = Depends(get_db),
) -> StandaloneOrder:
    result = await db.execute(
        select(StandaloneOrder).where(
            StandaloneOrder.id == order_id, StandaloneOrder.store_id == store_id
        )
    )
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


def _append_payload_history(
    order: StandaloneOrder, state: str, at_iso: str, **extra: str | None
) -> None:
    history_entry = {"state": state, "at": at_iso}
    for key, value in extra.items():
        if value is not None:
            history_entry[key] = value

    new_history = list(order.status_history or []) + [history_entry]
    order.status_history = new_history

    # Mirror into the embedded payload so the JSON stays self-contained.
    payload = dict(order.payload or {})
    status_block = dict(payload.get("status") or {})
    status_block["current"] = state
    status_block["updated_at"] = at_iso
    status_block["history"] = list(status_block.get("history") or []) + [history_entry]
    payload["status"] = status_block
    order.payload = payload


@router.patch(
    "/{store_id}/orders/{order_id}/status", response_model=StandaloneOrderOut
)
async def update_status(
    store_id: UUID,
    order_id: UUID,
    body: StandaloneOrderStatusUpdate,
    store: Store = Depends(_authenticate_store),
    db: AsyncSession = Depends(get_db),
) -> StandaloneOrder:
    result = await db.execute(
        select(StandaloneOrder).where(
            StandaloneOrder.id == order_id, StandaloneOrder.store_id == store_id
        )
    )
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    _validate_transition(order.status, body.state)

    if body.state == "canceled" and not body.reason:
        raise HTTPException(status_code=400, detail="reason required to cancel")

    now_iso = datetime.now(timezone.utc).isoformat()
    order.status = body.state
    _append_payload_history(
        order, body.state, now_iso, reason=body.reason, actor=body.actor
    )

    await db.commit()
    await db.refresh(order)
    return order


@router.patch(
    "/{store_id}/orders/{order_id}/payment", response_model=StandaloneOrderOut
)
async def update_payment(
    store_id: UUID,
    order_id: UUID,
    body: StandaloneOrderPaymentUpdate,
    store: Store = Depends(_authenticate_store),
    db: AsyncSession = Depends(get_db),
) -> StandaloneOrder:
    result = await db.execute(
        select(StandaloneOrder).where(
            StandaloneOrder.id == order_id, StandaloneOrder.store_id == store_id
        )
    )
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    order.payment_status = body.status
    payload = dict(order.payload or {})
    payment_block = dict(payload.get("payment") or {})
    payment_block["status"] = body.status
    if body.method:
        payment_block["method"] = body.method
    if body.external_ref:
        payment_block["external_ref"] = body.external_ref
    if body.status == "paid":
        payment_block["paid_at"] = datetime.now(timezone.utc).isoformat()
    payload["payment"] = payment_block
    order.payload = payload

    await db.commit()
    await db.refresh(order)
    return order
