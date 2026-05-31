from __future__ import annotations
from uuid import UUID
from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Org
# ---------------------------------------------------------------------------


class OrgCreate(BaseModel):
    name: str


class OrgOut(BaseModel):
    id: UUID
    name: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------------


class StoreCreate(BaseModel):
    org_id: UUID
    name: str
    timezone: str = "Asia/Tokyo"
    destination_type: Literal["standalone", "square_pos"] = "standalone"
    payment_channel: Literal["stub", "web_payments", "terminal"] = "stub"


class StoreOut(BaseModel):
    id: UUID
    org_id: UUID
    name: str
    api_key: str
    timezone: str
    destination_type: str
    payment_channel: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Entry
# ---------------------------------------------------------------------------


EntryKind = Literal["dine_in", "takeout", "counter", "delivery"]
EntryMode = Literal["no", "send", "tab"]


class EntryCreate(BaseModel):
    label: str
    kind: EntryKind = "dine_in"
    mode: EntryMode = "send"


class EntryUpdate(BaseModel):
    label: str | None = None
    kind: EntryKind | None = None
    mode: EntryMode | None = None
    is_active: bool | None = None


class EntryOut(BaseModel):
    id: UUID
    store_id: UUID
    label: str
    kind: str
    mode: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class EntryStoreContext(BaseModel):
    id: UUID
    name: str
    timezone: str


class EntryContext(BaseModel):
    """Public payload returned from GET /entries/{entry_id}."""

    id: UUID
    label: str
    kind: str
    mode: str
    is_active: bool
    store: EntryStoreContext


# ---------------------------------------------------------------------------
# Product
# ---------------------------------------------------------------------------


class ProductCreate(BaseModel):
    name: str
    price: int = Field(..., gt=0)
    photo_url: str | None = None


class ProductEnriched(BaseModel):
    description: str
    category: str
    tags: list[str]
    attributes: dict[str, Any]


class ProductOut(BaseModel):
    id: UUID
    store_id: UUID
    name: str
    price: int
    photo_url: str | None
    description: str | None
    category: str | None
    tags: list[str]
    attributes: dict[str, Any]
    is_available: bool
    enriched_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ProductUpdate(BaseModel):
    name: str | None = None
    price: int | None = Field(None, gt=0)
    photo_url: str | None = None


class ProductAvailabilityUpdate(BaseModel):
    is_available: bool


class ProductGenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=4000)


class ProductGenerateResponse(BaseModel):
    products: list[ProductOut]
    message: str


# ---------------------------------------------------------------------------
# Session
# ---------------------------------------------------------------------------


class SessionStart(BaseModel):
    entry_id: UUID
    context: dict[str, Any] = Field(default_factory=dict)


class SessionEntryOut(BaseModel):
    id: UUID
    label: str
    kind: str
    mode: str


class SessionOut(BaseModel):
    session_id: UUID
    store_id: UUID
    entry: SessionEntryOut
    created_at: datetime


# ---------------------------------------------------------------------------
# Suggest
# ---------------------------------------------------------------------------


class SuggestRequest(BaseModel):
    selections: dict[str, Any] = Field(
        ...,
        description="Structured user selections: {tags: [...], situation: '...', etc.}",
    )


class SuggestedProduct(BaseModel):
    id: UUID
    name: str
    price: int
    photo_url: str | None
    description: str | None
    reason: str


class InquiryOptions(BaseModel):
    tags: list[str]
    situations: list[str]


class SuggestResponse(BaseModel):
    session_id: UUID
    suggestions: list[SuggestedProduct]
    inquiry_options: InquiryOptions


SuggestResponse.model_rebuild()


# ---------------------------------------------------------------------------
# Tab
# ---------------------------------------------------------------------------


class TabItemAdd(BaseModel):
    product_id: UUID
    quantity: int = Field(default=1, ge=1)
    note: str | None = None
    cart_source: dict[str, Any] = Field(default_factory=dict)


class TabItemUpdate(BaseModel):
    quantity: int | None = Field(None, ge=1)
    note: str | None = None


class Money(BaseModel):
    amount: int
    currency: str = "JPY"


class TabItemOut(BaseModel):
    id: UUID
    product_id: UUID
    name: str
    quantity: int
    unit_price: int
    subtotal: int
    note: str | None
    cart_source: dict[str, Any]
    created_at: datetime


class TabTotals(BaseModel):
    subtotal: int
    tax: int
    total: int
    currency: str = "JPY"


class TabOut(BaseModel):
    id: UUID
    session_id: UUID
    entry_id: UUID
    store_id: UUID
    state: str
    items: list[TabItemOut]
    totals: TabTotals
    closed_at: datetime | None
    created_at: datetime


class TabCloseResponse(BaseModel):
    order_id: UUID
    tab_id: UUID
    status: str
    dispatched_at: datetime


# ---------------------------------------------------------------------------
# Standalone order (merchant intake)
# ---------------------------------------------------------------------------


StandaloneStatus = Literal["received", "preparing", "ready", "handed", "canceled"]
PaymentStatus = Literal["unpaid", "authorized", "paid", "refunded", "void"]
PaymentMethod = Literal["cash", "card", "qr", "in_app", "other"]


class StandaloneOrderOut(BaseModel):
    id: UUID
    store_id: UUID
    tab_id: UUID
    entry_id: UUID
    status: str
    payment_status: str
    payload: dict[str, Any]
    status_history: list[dict[str, Any]]
    received_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class StandaloneOrderStatusUpdate(BaseModel):
    state: StandaloneStatus
    reason: str | None = None
    actor: str | None = None


class StandaloneOrderPaymentUpdate(BaseModel):
    status: PaymentStatus
    method: PaymentMethod | None = None
    external_ref: str | None = None


# ---------------------------------------------------------------------------
# Stub payment
# ---------------------------------------------------------------------------


class StubChargeRequest(BaseModel):
    amount: int = Field(..., gt=0)
    currency: str = "JPY"
    tab_id: UUID


class StubChargeResponse(BaseModel):
    payment_id: str
    status: str
    amount: int
    currency: str
