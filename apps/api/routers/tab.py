"""Customer-facing tab management.

Endpoints:
- GET    /sessions/{session_id}/tab            current open tab (auto-creates)
- POST   /sessions/{session_id}/tab/items      add item
- PATCH  /sessions/{session_id}/tab/items/{id} update qty/note
- DELETE /sessions/{session_id}/tab/items/{id} remove item
- POST   /sessions/{session_id}/tab/close      close tab + dispatch
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from db.client import get_db
from db.models import (
    Entry,
    Product,
    Session,
    StandaloneOrder,
    Store,
    Tab,
    TabItem,
)
from schemas import (
    TabCloseResponse,
    TabItemAdd,
    TabItemOut,
    TabItemUpdate,
    TabOut,
    TabTotals,
)
from services.dispatcher import Dispatcher, get_dispatcher

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_session_or_404(session_id: UUID, db: AsyncSession) -> Session:
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


async def _get_or_create_open_tab(session: Session, db: AsyncSession) -> Tab:
    result = await db.execute(
        select(Tab)
        .where(Tab.session_id == session.id, Tab.state == "open")
        .order_by(Tab.created_at.desc())
    )
    tab = result.scalars().first()
    if tab:
        return tab

    tab = Tab(
        session_id=session.id,
        entry_id=session.entry_id,
        store_id=session.store_id,
        state="open",
    )
    db.add(tab)
    await db.commit()
    await db.refresh(tab)
    return tab


async def _load_tab_with_items(tab_id: UUID, db: AsyncSession) -> Tab:
    result = await db.execute(
        select(Tab).options(selectinload(Tab.items)).where(Tab.id == tab_id)
    )
    tab = result.scalar_one_or_none()
    if not tab:
        raise HTTPException(status_code=404, detail="Tab not found")
    return tab


def _serialize_item(item: TabItem) -> TabItemOut:
    return TabItemOut(
        id=item.id,
        product_id=item.product_id,
        name=item.snapshot_name,
        quantity=item.quantity,
        unit_price=item.snapshot_price,
        subtotal=item.snapshot_price * item.quantity,
        note=item.note,
        cart_source=item.cart_source or {},
        created_at=item.created_at,
    )


def _serialize_tab(tab: Tab) -> TabOut:
    items = sorted(tab.items, key=lambda i: i.created_at)
    subtotal = sum(i.snapshot_price * i.quantity for i in items)
    tax = 0  # Phase 1: no tax.
    total = subtotal + tax
    return TabOut(
        id=tab.id,
        session_id=tab.session_id,
        entry_id=tab.entry_id,
        store_id=tab.store_id,
        state=tab.state,
        items=[_serialize_item(i) for i in items],
        totals=TabTotals(subtotal=subtotal, tax=tax, total=total),
        closed_at=tab.closed_at,
        created_at=tab.created_at,
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/{session_id}/tab", response_model=TabOut)
async def get_open_tab(session_id: UUID, db: AsyncSession = Depends(get_db)) -> TabOut:
    session = await _get_session_or_404(session_id, db)
    tab = await _get_or_create_open_tab(session, db)
    tab = await _load_tab_with_items(tab.id, db)
    return _serialize_tab(tab)


@router.post(
    "/{session_id}/tab/items",
    response_model=TabOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_tab_item(
    session_id: UUID,
    body: TabItemAdd,
    db: AsyncSession = Depends(get_db),
) -> TabOut:
    session = await _get_session_or_404(session_id, db)
    tab = await _get_or_create_open_tab(session, db)

    product_result = await db.execute(
        select(Product).where(Product.id == body.product_id)
    )
    product = product_result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if product.store_id != session.store_id:
        raise HTTPException(status_code=400, detail="Product belongs to a different store")
    if not product.is_available:
        raise HTTPException(status_code=409, detail="Product is unavailable")

    item = TabItem(
        tab_id=tab.id,
        product_id=product.id,
        quantity=body.quantity,
        note=body.note,
        snapshot_name=product.name,
        snapshot_price=product.price,
        cart_source=body.cart_source or {},
    )
    db.add(item)
    await db.commit()

    tab = await _load_tab_with_items(tab.id, db)
    return _serialize_tab(tab)


@router.patch("/{session_id}/tab/items/{tab_item_id}", response_model=TabOut)
async def update_tab_item(
    session_id: UUID,
    tab_item_id: UUID,
    body: TabItemUpdate,
    db: AsyncSession = Depends(get_db),
) -> TabOut:
    session = await _get_session_or_404(session_id, db)

    result = await db.execute(
        select(TabItem, Tab)
        .join(Tab, Tab.id == TabItem.tab_id)
        .where(TabItem.id == tab_item_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Tab item not found")
    item, tab = row
    if tab.session_id != session.id:
        raise HTTPException(status_code=404, detail="Tab item not found")
    if tab.state != "open":
        raise HTTPException(status_code=409, detail="Tab is closed")

    updates = body.model_dump(exclude_unset=True)
    if "quantity" in updates and updates["quantity"] is not None:
        item.quantity = updates["quantity"]
    if "note" in updates:
        item.note = updates["note"]

    await db.commit()
    tab = await _load_tab_with_items(tab.id, db)
    return _serialize_tab(tab)


@router.delete(
    "/{session_id}/tab/items/{tab_item_id}",
    response_model=TabOut,
)
async def delete_tab_item(
    session_id: UUID,
    tab_item_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> TabOut:
    session = await _get_session_or_404(session_id, db)

    result = await db.execute(
        select(TabItem, Tab)
        .join(Tab, Tab.id == TabItem.tab_id)
        .where(TabItem.id == tab_item_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Tab item not found")
    item, tab = row
    if tab.session_id != session.id:
        raise HTTPException(status_code=404, detail="Tab item not found")
    if tab.state != "open":
        raise HTTPException(status_code=409, detail="Tab is closed")

    await db.delete(item)
    await db.commit()
    tab = await _load_tab_with_items(tab.id, db)
    return _serialize_tab(tab)


@router.post("/{session_id}/tab/close", response_model=TabCloseResponse)
async def close_tab(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
    dispatcher: Dispatcher = Depends(get_dispatcher),
) -> TabCloseResponse:
    session = await _get_session_or_404(session_id, db)

    # Find the most-recent tab for this session (open or closed).
    tab_result = await db.execute(
        select(Tab)
        .options(selectinload(Tab.items), selectinload(Tab.session))
        .where(Tab.session_id == session.id)
        .order_by(Tab.created_at.desc())
    )
    tab = tab_result.scalars().first()
    if not tab:
        raise HTTPException(status_code=404, detail="No tab to close")

    # Idempotency: if the most recent tab is already closed and has an order,
    # return that order.
    if tab.state == "closed":
        existing_order_result = await db.execute(
            select(StandaloneOrder).where(StandaloneOrder.tab_id == tab.id)
        )
        existing_order = existing_order_result.scalar_one_or_none()
        if existing_order:
            return TabCloseResponse(
                order_id=existing_order.id,
                tab_id=tab.id,
                status="sent",
                dispatched_at=existing_order.received_at,
            )
        raise HTTPException(
            status_code=409, detail="Tab is closed but no order was recorded"
        )

    if not tab.items:
        raise HTTPException(status_code=400, detail="Tab is empty")

    # Resolve store + entry needed for the payload.
    store_result = await db.execute(select(Store).where(Store.id == tab.store_id))
    store = store_result.scalar_one_or_none()
    entry_result = await db.execute(select(Entry).where(Entry.id == tab.entry_id))
    entry = entry_result.scalar_one_or_none()
    if not store or not entry:
        raise HTTPException(status_code=500, detail="Tab is missing store or entry")

    if entry.mode == "no":
        # mode=no means the tab is a memo; it never closes / dispatches.
        raise HTTPException(
            status_code=409, detail="Tab cannot be closed in mode=no entry"
        )

    order = await dispatcher.dispatch_tab(
        store=store, entry=entry, tab=tab, items=list(tab.items), db=db,
    )

    tab.state = "closed"
    tab.closed_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(order)

    return TabCloseResponse(
        order_id=order.id,
        tab_id=tab.id,
        status="sent",
        dispatched_at=order.received_at,
    )
