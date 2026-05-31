from __future__ import annotations
import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Integer, Boolean, Text, ARRAY, DateTime, ForeignKey, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from pgvector.sqlalchemy import Vector
from db.client import Base


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


class Org(Base):
    __tablename__ = "orgs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String, nullable=False)
    supabase_user_id: Mapped[str | None] = mapped_column(String, unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    stores: Mapped[list[Store]] = relationship(back_populates="org")


class Store(Base):
    __tablename__ = "stores"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("orgs.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    api_key: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    timezone: Mapped[str] = mapped_column(String, nullable=False, default="Asia/Tokyo")

    destination_type: Mapped[str] = mapped_column(String, nullable=False, default="standalone")
    payment_channel: Mapped[str] = mapped_column(String, nullable=False, default="stub")

    square_location_id: Mapped[str | None] = mapped_column(String)
    square_access_token: Mapped[str | None] = mapped_column(String)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    org: Mapped[Org] = relationship(back_populates="stores")
    products: Mapped[list[Product]] = relationship(back_populates="store")
    entries: Mapped[list[Entry]] = relationship(back_populates="store")


class Entry(Base):
    __tablename__ = "entries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    store_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("stores.id"), nullable=False)
    label: Mapped[str] = mapped_column(String, nullable=False)
    kind: Mapped[str] = mapped_column(String, nullable=False, default="dine_in")
    mode: Mapped[str] = mapped_column(String, nullable=False, default="send")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    store: Mapped[Store] = relationship(back_populates="entries")


class Product(Base):
    __tablename__ = "products"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    store_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("stores.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    photo_url: Mapped[str | None] = mapped_column(String)
    price: Mapped[int] = mapped_column(Integer, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(String)
    tags: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    attributes: Mapped[dict] = mapped_column(JSONB, default=dict)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(1536))
    is_available: Mapped[bool] = mapped_column(Boolean, default=True)
    enriched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)

    store: Mapped[Store] = relationship(back_populates="products")


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    entry_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("entries.id"), nullable=False)
    store_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("stores.id"), nullable=False)
    context: Mapped[dict] = mapped_column(JSONB, default=dict)
    last_activity_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    suggestion_logs: Mapped[list[SuggestionLog]] = relationship(back_populates="session")
    tabs: Mapped[list[Tab]] = relationship(back_populates="session")


class Tab(Base):
    __tablename__ = "tabs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=False)
    entry_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("entries.id"), nullable=False)
    store_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("stores.id"), nullable=False)
    state: Mapped[str] = mapped_column(String, nullable=False, default="open")
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    session: Mapped[Session] = relationship(back_populates="tabs")
    items: Mapped[list[TabItem]] = relationship(back_populates="tab", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_tabs_session_state", "session_id", "state"),
    )


class TabItem(Base):
    __tablename__ = "tab_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tab_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tabs.id"), nullable=False)
    product_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    note: Mapped[str | None] = mapped_column(Text)
    snapshot_name: Mapped[str] = mapped_column(String, nullable=False)
    snapshot_price: Mapped[int] = mapped_column(Integer, nullable=False)
    cart_source: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    tab: Mapped[Tab] = relationship(back_populates="items")


class StandaloneOrder(Base):
    __tablename__ = "standalone_orders"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    store_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("stores.id"), nullable=False)
    tab_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tabs.id"), nullable=False, unique=True)
    entry_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("entries.id"), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="received")
    payment_status: Mapped[str] = mapped_column(String, nullable=False, default="unpaid")
    status_history: Mapped[list[dict]] = mapped_column(JSONB, default=list)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)

    __table_args__ = (
        Index("ix_standalone_orders_store_status", "store_id", "status"),
    )


class DispatchLog(Base):
    __tablename__ = "dispatch_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tab_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tabs.id"), nullable=False)
    store_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("stores.id"), nullable=False)
    destination_type: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    response: Mapped[dict | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(Text)
    attempted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SuggestionLog(Base):
    __tablename__ = "suggestion_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=False)
    selections: Mapped[dict] = mapped_column(JSONB, nullable=False)
    suggested_ids: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False)
    selected_id: Mapped[str | None] = mapped_column(String)
    ordered: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    session: Mapped[Session] = relationship(back_populates="suggestion_logs")
