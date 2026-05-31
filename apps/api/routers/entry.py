"""Entry context + session creation.

Two routers are exported:
- ``entries_router`` mounted at ``/entries`` for GET /entries/{entry_id}
- ``sessions_router`` mounted at ``/sessions`` for POST /sessions

Sessions are identified by the ``so_sid`` cookie (HttpOnly, SameSite=Lax).
"""

from __future__ import annotations

import os
from uuid import UUID

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.client import get_db
from db.models import Entry, Session, Store
from schemas import (
    EntryContext,
    EntryStoreContext,
    SessionEntryOut,
    SessionOut,
    SessionStart,
)

entries_router = APIRouter()
sessions_router = APIRouter()


SESSION_COOKIE_NAME = "so_sid"
# 24h sliding window
SESSION_COOKIE_MAX_AGE = 60 * 60 * 24


def _cookie_secure() -> bool:
    return os.environ.get("COOKIE_SECURE", "false").lower() == "true"


@entries_router.get("/{entry_id}", response_model=EntryContext)
async def get_entry(entry_id: UUID, db: AsyncSession = Depends(get_db)) -> EntryContext:
    result = await db.execute(
        select(Entry, Store)
        .join(Store, Store.id == Entry.store_id)
        .where(Entry.id == entry_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Entry not found")
    entry, store = row
    if not entry.is_active:
        raise HTTPException(status_code=410, detail="Entry is inactive")

    return EntryContext(
        id=entry.id,
        label=entry.label,
        kind=entry.kind,
        mode=entry.mode,
        is_active=entry.is_active,
        store=EntryStoreContext(id=store.id, name=store.name, timezone=store.timezone),
    )


def _set_session_cookie(response: Response, session_id: UUID) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=str(session_id),
        max_age=SESSION_COOKIE_MAX_AGE,
        httponly=True,
        secure=_cookie_secure(),
        samesite="lax",
        path="/",
    )


@sessions_router.post("", response_model=SessionOut)
async def start_session(
    body: SessionStart,
    response: Response,
    so_sid: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
) -> SessionOut:
    # Resolve entry first to validate the requested entry exists and is active.
    entry_result = await db.execute(select(Entry).where(Entry.id == body.entry_id))
    entry = entry_result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    if not entry.is_active:
        raise HTTPException(status_code=410, detail="Entry is inactive")

    session: Session | None = None

    # Reuse existing session if its cookie maps to a session bound to this entry.
    if so_sid:
        try:
            sid = UUID(so_sid)
        except ValueError:
            sid = None
        if sid is not None:
            existing_result = await db.execute(select(Session).where(Session.id == sid))
            existing = existing_result.scalar_one_or_none()
            if existing and existing.entry_id == entry.id:
                session = existing

    if session is None:
        session = Session(
            entry_id=entry.id,
            store_id=entry.store_id,
            context=body.context,
        )
        db.add(session)
        await db.commit()
        await db.refresh(session)

    _set_session_cookie(response, session.id)

    return SessionOut(
        session_id=session.id,
        store_id=session.store_id,
        entry=SessionEntryOut(
            id=entry.id, label=entry.label, kind=entry.kind, mode=entry.mode
        ),
        created_at=session.created_at,
    )
