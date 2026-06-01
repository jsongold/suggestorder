"""Admin / merchant management API.

- Orgs / stores / entries are managed without a per-store API key (these are
  the bootstrap endpoints used by a seed script or a dedicated admin UI).
- Product CRUD is scoped to a store via ``X-Api-Key`` + ``X-Store-ID``
  headers (existing pattern, preserved).
"""

from __future__ import annotations

import secrets
import uuid as _uuid
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Response, UploadFile, File
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.client import SessionLocal, get_db, settings
from db.models import (
    Entry,
    Org,
    Product,
    Session as SessionRow,
    StandaloneOrder,
    Store,
    Tab,
)
from schemas import (
    EntryCreate,
    EntryOut,
    EntryUpdate,
    OrgCreate,
    OrgOut,
    ProductAvailabilityUpdate,
    ProductCreate,
    ProductGenerateRequest,
    ProductGenerateResponse,
    ProductOut,
    ProductUpdate,
    StoreCreate,
    StoreOut,
)
from services import catalog_gen
from services.deps import get_llm
from services.supabase_auth import verify_supabase_token

router = APIRouter()


# ---------------------------------------------------------------------------
# Auth dependency for product CRUD (existing pattern)
# ---------------------------------------------------------------------------


async def authenticate(
    authorization: str | None = Header(None, alias="Authorization"),
    x_api_key: str | None = Header(None, alias="X-Api-Key"),
    x_store_id: str | None = Header(None, alias="X-Store-ID"),
    db: AsyncSession = Depends(get_db),
) -> UUID:
    """Accept Supabase JWT (prod) or API key (local dev) for admin endpoints."""
    if authorization and authorization.startswith("Bearer ") and settings.supabase_jwt_secret:
        token = authorization.removeprefix("Bearer ")
        user_id = verify_supabase_token(token)
        if not x_store_id:
            raise HTTPException(status_code=400, detail="X-Store-ID header required")
        try:
            store_id = UUID(x_store_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid store ID")
        org = (await db.execute(select(Org).where(Org.supabase_user_id == user_id))).scalar_one_or_none()
        if not org:
            raise HTTPException(status_code=401, detail="No org found for this user. Complete setup first.")
        store = (await db.execute(select(Store).where(Store.id == store_id, Store.org_id == org.id))).scalar_one_or_none()
        if not store:
            raise HTTPException(status_code=403, detail="Access denied")
        return store_id

    if x_api_key and x_store_id:
        try:
            store_id = UUID(x_store_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid store ID")
        store = (await db.execute(select(Store).where(Store.id == store_id, Store.api_key == x_api_key))).scalar_one_or_none()
        if not store:
            raise HTTPException(status_code=401, detail="Invalid API key")
        return store_id

    raise HTTPException(status_code=401, detail="Authentication required")


async def _run_enrichment(product_id: UUID) -> None:
    async with SessionLocal() as db:
        await catalog_gen.enrich_product(product_id, db)


# ---------------------------------------------------------------------------
# Supabase Auth helpers
# ---------------------------------------------------------------------------


async def _require_supabase_user(
    authorization: str = Header(..., alias="Authorization"),
) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Bearer token required")
    return verify_supabase_token(authorization.removeprefix("Bearer "))


@router.post("/setup", response_model=dict)
async def setup_org_and_store(
    body: dict,
    user_id: str = Depends(_require_supabase_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """First-time setup: create Org + initial Store linked to the Supabase user."""
    org_name = (body.get("org_name") or "").strip()
    store_name = (body.get("store_name") or "").strip()
    if not org_name or not store_name:
        raise HTTPException(status_code=422, detail="org_name and store_name required")

    existing = (await db.execute(select(Org).where(Org.supabase_user_id == user_id))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Org already exists for this user")

    org = Org(name=org_name, supabase_user_id=user_id)
    db.add(org)
    await db.flush()

    store = Store(
        org_id=org.id,
        name=store_name,
        api_key=secrets.token_urlsafe(32),
    )
    db.add(store)
    await db.commit()
    await db.refresh(org)
    await db.refresh(store)
    return {"org": {"id": str(org.id), "name": org.name}, "store": {"id": str(store.id), "name": store.name, "api_key": store.api_key}}


@router.get("/me", response_model=dict)
async def get_me(
    user_id: str = Depends(_require_supabase_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Return the authenticated user's org and stores."""
    org = (await db.execute(select(Org).where(Org.supabase_user_id == user_id))).scalar_one_or_none()
    if not org:
        return {"setup_required": True}
    stores_result = await db.execute(select(Store).where(Store.org_id == org.id).order_by(Store.created_at))
    stores = stores_result.scalars().all()
    return {
        "setup_required": False,
        "org": {"id": str(org.id), "name": org.name},
        "stores": [{"id": str(s.id), "name": s.name} for s in stores],
    }


@router.post("/upload", response_model=dict)
async def upload_photo(
    file: UploadFile = File(...),
    store_id: UUID = Depends(authenticate),
) -> dict:
    """Upload a product photo to Supabase Storage and return the public URL."""
    from services.adapters.gcs_storage import upload_photo as _upload

    contents = await file.read()
    ext = ""
    if file.filename and "." in file.filename:
        ext = "." + file.filename.rsplit(".", 1)[-1].lower()
    path = f"products/{store_id}/{_uuid.uuid4()}{ext}"
    try:
        url = _upload(contents, path, file.content_type or "application/octet-stream")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Storage upload failed: {exc}")
    return {"url": url}


# ---------------------------------------------------------------------------
# Org
# ---------------------------------------------------------------------------


@router.post("/orgs", response_model=OrgOut)
async def create_org(body: OrgCreate, db: AsyncSession = Depends(get_db)) -> Org:
    org = Org(name=body.name)
    db.add(org)
    await db.commit()
    await db.refresh(org)
    return org


@router.get("/orgs", response_model=list[OrgOut])
async def list_orgs(db: AsyncSession = Depends(get_db)) -> list[Org]:
    result = await db.execute(select(Org).order_by(Org.created_at.desc()))
    return list(result.scalars().all())


# ---------------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------------


@router.post("/stores", response_model=StoreOut)
async def create_store(body: StoreCreate, db: AsyncSession = Depends(get_db)) -> Store:
    org_result = await db.execute(select(Org).where(Org.id == body.org_id))
    if org_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Org not found")

    store = Store(
        org_id=body.org_id,
        name=body.name,
        timezone=body.timezone,
        destination_type=body.destination_type,
        payment_channel=body.payment_channel,
        api_key=secrets.token_urlsafe(32),
    )
    db.add(store)
    await db.commit()
    await db.refresh(store)
    return store


@router.get("/stores", response_model=list[StoreOut])
async def list_stores(
    org_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[Store]:
    stmt = select(Store)
    if org_id is not None:
        stmt = stmt.where(Store.org_id == org_id)
    stmt = stmt.order_by(Store.created_at.desc())
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.get("/stores/{store_id}", response_model=StoreOut)
async def get_store(store_id: UUID, db: AsyncSession = Depends(get_db)) -> Store:
    result = await db.execute(select(Store).where(Store.id == store_id))
    store = result.scalar_one_or_none()
    if store is None:
        raise HTTPException(status_code=404, detail="Store not found")
    return store


# ---------------------------------------------------------------------------
# Entry
# ---------------------------------------------------------------------------


@router.post("/stores/{store_id}/entries", response_model=EntryOut)
async def create_entry(
    store_id: UUID,
    body: EntryCreate,
    db: AsyncSession = Depends(get_db),
) -> Entry:
    store_result = await db.execute(select(Store).where(Store.id == store_id))
    if store_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Store not found")

    entry = Entry(
        store_id=store_id,
        label=body.label,
        kind=body.kind,
        mode=body.mode,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry


@router.get("/stores/{store_id}/entries", response_model=list[EntryOut])
async def list_entries(
    store_id: UUID, db: AsyncSession = Depends(get_db)
) -> list[Entry]:
    result = await db.execute(
        select(Entry).where(Entry.store_id == store_id).order_by(Entry.created_at.desc())
    )
    return list(result.scalars().all())


@router.patch("/entries/{entry_id}", response_model=EntryOut)
async def update_entry(
    entry_id: UUID,
    body: EntryUpdate,
    db: AsyncSession = Depends(get_db),
) -> Entry:
    result = await db.execute(select(Entry).where(Entry.id == entry_id))
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    for key, value in body.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(entry, key, value)
    await db.commit()
    await db.refresh(entry)
    return entry


@router.delete("/entries/{entry_id}", status_code=204, response_class=Response)
async def delete_entry(
    entry_id: UUID, db: AsyncSession = Depends(get_db)
) -> Response:
    """Hard delete an Entry, but refuse if anything still references it.

    Sessions / tabs / standalone_orders carry an entry_id FK without
    ON DELETE CASCADE, so a blind delete would 500 from the DB. Reject
    with 409 instead and let the merchant deactivate (is_active=false)."""
    result = await db.execute(select(Entry).where(Entry.id == entry_id))
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    for model in (SessionRow, Tab, StandaloneOrder):
        count = await db.scalar(
            select(func.count()).select_from(model).where(model.entry_id == entry_id)
        )
        if count:
            raise HTTPException(
                status_code=409,
                detail="この Entry は注文履歴があるため削除できません。停止 (is_active=false) してください。",
            )

    await db.delete(entry)
    await db.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Product
# ---------------------------------------------------------------------------


@router.post("/products", response_model=ProductOut)
async def create_product(
    body: ProductCreate,
    background_tasks: BackgroundTasks,
    store_id: UUID = Depends(authenticate),
    db: AsyncSession = Depends(get_db),
) -> Product:
    product = Product(
        store_id=store_id,
        name=body.name,
        price=body.price,
        photo_url=body.photo_url,
    )
    db.add(product)
    await db.commit()
    await db.refresh(product)
    background_tasks.add_task(_run_enrichment, product.id)
    return product


@router.get("/products", response_model=list[ProductOut])
async def list_products(
    store_id: UUID = Depends(authenticate),
    db: AsyncSession = Depends(get_db),
) -> list[Product]:
    result = await db.execute(select(Product).where(Product.store_id == store_id))
    return list(result.scalars().all())


@router.patch("/products/{product_id}", response_model=ProductOut)
async def update_product(
    product_id: UUID,
    body: ProductUpdate,
    _: UUID = Depends(authenticate),
    db: AsyncSession = Depends(get_db),
) -> Product:
    result = await db.execute(select(Product).where(Product.id == product_id))
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    for key, value in body.model_dump(exclude_none=True).items():
        setattr(product, key, value)
    await db.commit()
    await db.refresh(product)
    return product


@router.post("/products/generate", response_model=ProductGenerateResponse)
async def generate_products(
    body: ProductGenerateRequest,
    background_tasks: BackgroundTasks,
    store_id: UUID = Depends(authenticate),
    db: AsyncSession = Depends(get_db),
) -> ProductGenerateResponse:
    """Generate a menu catalog from a free-form chat prompt.

    The LLM is asked to extract candidate menu items (name + price in JPY).
    Each item is persisted as a Product and queued for the existing
    background enrichment (description/tags/category/embedding).
    """
    llm = get_llm()
    instruction = (
        "あなたは飲食店のメニュー設計アシスタントです。"
        "ユーザーの要望から具体的なメニュー候補を抽出し、JSON で返してください。"
        "返答は必ず以下の形：\n"
        '{"items":[{"name":"<商品名>","price":<円・整数>}, ...],'
        '"message":"<日本語で1〜2文の要約>"}\n'
        "- name は重複しない商品名（日本語）\n"
        "- price は税込の円（10円単位の整数、100〜5000の範囲を目安）\n"
        "- items は 1〜12 件\n"
        "- 写真URLや説明は不要（後段で自動生成される）\n\n"
        f"ユーザーの要望:\n{body.prompt}"
    )

    try:
        raw = await llm.complete(instruction, max_tokens=1024, json_mode=True)
        data = catalog_gen._parse_json_lenient(raw)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM 呼び出しに失敗: {e}")

    raw_items = data.get("items") or []
    if not isinstance(raw_items, list) or not raw_items:
        raise HTTPException(
            status_code=422,
            detail="LLM が候補を返しませんでした。プロンプトを具体化してください。",
        )

    created: list[Product] = []
    for it in raw_items[:12]:
        if not isinstance(it, dict):
            continue
        name = (it.get("name") or "").strip()
        price = it.get("price")
        if not name or not isinstance(price, int) or price <= 0:
            continue
        product = Product(store_id=store_id, name=name, price=price)
        db.add(product)
        created.append(product)

    if not created:
        raise HTTPException(
            status_code=422, detail="生成結果から有効な商品を抽出できませんでした。"
        )

    await db.commit()
    for product in created:
        await db.refresh(product)
        background_tasks.add_task(_run_enrichment, product.id)

    message = (data.get("message") or "").strip() or f"{len(created)} 件の商品を生成しました。"
    return ProductGenerateResponse(products=created, message=message)


@router.patch("/products/{product_id}/availability", response_model=ProductOut)
async def update_availability(
    product_id: UUID,
    body: ProductAvailabilityUpdate,
    _: UUID = Depends(authenticate),
    db: AsyncSession = Depends(get_db),
) -> Product:
    result = await db.execute(select(Product).where(Product.id == product_id))
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    product.is_available = body.is_available
    await db.commit()
    await db.refresh(product)
    return product
