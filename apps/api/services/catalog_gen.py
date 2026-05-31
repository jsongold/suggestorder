from __future__ import annotations
import json
import re
from uuid import UUID
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from loguru import logger
from db.models import Product
from services.deps import get_llm, get_embedding
from services.ports import LLMClient, EmbeddingClient


def _parse_json_lenient(raw: str) -> dict:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        return json.loads(match.group()) if match else {}


async def enrich_product(
    product_id: UUID,
    db: AsyncSession,
    llm: LLMClient | None = None,
    embedding: EmbeddingClient | None = None,
) -> None:
    llm = llm or get_llm()
    embedding = embedding or get_embedding()

    result = await db.execute(select(Product).where(Product.id == product_id))
    product = result.scalar_one_or_none()
    if not product:
        return

    prompt = f"""You are a food/drink menu enrichment assistant.
Given a menu item, return a JSON object with these fields:
- description: string (1-2 sentences)
- category: string (single word or short phrase)
- tags: list of 5-10 strings (flavor, situation, dietary, etc.)
- attributes: dict with keys like flavor, texture, temperature, sweetness, spiciness

Menu item name: {product.name}
Price: {product.price} yen"""

    try:
        raw = await llm.complete(prompt, max_tokens=512, json_mode=True)
        data = _parse_json_lenient(raw)
    except Exception as e:
        logger.warning(f"Enrichment failed for product {product_id}: {e}")
        data = {}

    embed_text = " ".join(
        [product.name, data.get("description", "")] + data.get("tags", [])
    )

    try:
        vector = await embedding.embed(embed_text)
    except Exception as e:
        logger.warning(f"Embedding failed for product {product_id}: {e}")
        vector = None

    product.description = data.get("description")
    product.category = data.get("category")
    product.tags = data.get("tags", [])
    product.attributes = data.get("attributes", {})
    product.embedding = vector
    product.enriched_at = datetime.now(timezone.utc)

    await db.commit()
    logger.info(f"Enriched product {product_id}: {product.name}")
