"""Stub PaymentChannel.

Returns a fake completed payment for any request — no DB writes. Phase 1
flows do not call this; it exists so frontends / e2e tests can demonstrate
the future PaymentChannel surface.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter

from schemas import StubChargeRequest, StubChargeResponse

router = APIRouter()


@router.post("/charge", response_model=StubChargeResponse)
async def charge(body: StubChargeRequest) -> StubChargeResponse:
    return StubChargeResponse(
        payment_id=f"stub_{uuid.uuid4()}",
        status="completed",
        amount=body.amount,
        currency=body.currency,
    )
