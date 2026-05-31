from uuid import UUID
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from db.client import get_db
from db.models import Product
from schemas import ProductOut

router = APIRouter()


@router.get("/{store_id}/products", response_model=list[ProductOut])
async def get_catalog(
    store_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Product).where(
            Product.store_id == store_id,
            Product.is_available == True,
            Product.enriched_at.is_not(None),
        )
    )
    return result.scalars().all()
