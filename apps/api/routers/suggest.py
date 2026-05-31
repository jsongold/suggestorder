"""AI suggestion endpoint.

Sessions are created via POST /sessions (see ``routers.entry``); this router
only owns the suggestion call. Ordering happens through the tab/close flow
in ``routers.tab``.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.client import get_db
from db.models import Session, SuggestionLog
from schemas import SuggestRequest, SuggestResponse
from services import item_suggest

router = APIRouter()


@router.post("/{session_id}/suggest", response_model=SuggestResponse)
async def suggest(
    session_id: UUID,
    body: SuggestRequest,
    db: AsyncSession = Depends(get_db),
) -> SuggestResponse:
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    suggestions, inquiry_options = await item_suggest.get_suggestions(
        session_id=session_id,
        selections=body.selections,
        db=db,
    )

    log = SuggestionLog(
        session_id=session_id,
        selections=body.selections,
        suggested_ids=[str(s.id) for s in suggestions],
    )
    db.add(log)
    await db.commit()

    return SuggestResponse(
        session_id=session_id,
        suggestions=suggestions,
        inquiry_options=inquiry_options,
    )
