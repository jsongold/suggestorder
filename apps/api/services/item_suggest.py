from __future__ import annotations
import hashlib
import json
import random
import re
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from loguru import logger
from db.models import Session, Product
from schemas import SuggestedProduct, InquiryOptions
from services.deps import get_llm, get_cache
from services.ports import LLMClient, CacheClient

_HARDCODED_SITUATIONS = ["軽め", "重め", "甘い", "辛い", "冷たい", "温かい"]
_REASON_TTL = 3600


def _reasons_cache_key(product_ids: list[UUID], selected_tags: list[str]) -> str:
    payload = json.dumps(
        {"ids": sorted(str(i) for i in product_ids), "tags": sorted(selected_tags)},
        ensure_ascii=False,
    )
    digest = hashlib.sha256(payload.encode()).hexdigest()
    return f"reasons:{digest}"


def _parse_list_lenient(raw: str) -> list:
    try:
        v = json.loads(raw)
        return v if isinstance(v, list) else []
    except json.JSONDecodeError:
        match = re.search(r"\[.*\]", raw, re.DOTALL)
        return json.loads(match.group()) if match else []


async def _generate_reasons(
    top3: list[Product],
    selected_tags: list[str],
    llm: LLMClient,
    cache: CacheClient,
) -> list[str]:
    cache_key = _reasons_cache_key([p.id for p in top3], selected_tags)
    cached = await cache.get(cache_key)
    if cached:
        logger.debug(f"Cache hit: {cache_key}")
        return json.loads(cached)

    tags_str = json.dumps(selected_tags, ensure_ascii=False)
    products_block = "\n".join(
        f"{i+1}. {p.name} — {p.description or ''} (tags: {', '.join(p.tags or [])})"
        for i, p in enumerate(top3)
    )

    prompt = f"""あなたはメニュー提案アシスタントです。お客様の好みに合わせた理由を日本語で短く書いてください。

お客様の選択: {tags_str}

おすすめメニュー:
{products_block}

各メニューについて、お客様の好みに合う理由を15〜30文字の日本語1文で書いてください。
JSON配列で3つの文字列を返してください。マークダウン不要。"""

    try:
        raw = await llm.complete(prompt, max_tokens=256)
        reasons = _parse_list_lenient(raw)
    except Exception as e:
        logger.warning(f"Reason generation failed: {e}")
        reasons = []

    while len(reasons) < len(top3):
        reasons.append("おすすめの一品です。")

    await cache.set(cache_key, json.dumps(reasons, ensure_ascii=False), _REASON_TTL)
    return reasons


async def get_suggestions(
    session_id: UUID,
    selections: dict,
    db: AsyncSession,
    llm: LLMClient | None = None,
    cache: CacheClient | None = None,
) -> tuple[list[SuggestedProduct], InquiryOptions]:
    llm = llm or get_llm()
    cache = cache or get_cache()

    session_result = await db.execute(select(Session).where(Session.id == session_id))
    session = session_result.scalar_one_or_none()

    products_result = await db.execute(
        select(Product).where(
            Product.store_id == session.store_id,
            Product.is_available == True,
            Product.enriched_at.is_not(None),
        )
    )
    products = list(products_result.scalars().all())

    all_tags: list[str] = list(_HARDCODED_SITUATIONS)
    seen_tags: set[str] = set(all_tags)
    for p in products:
        for tag in p.tags or []:
            if tag not in seen_tags and len(all_tags) < 15:
                all_tags.append(tag)
                seen_tags.add(tag)

    inquiry_options = InquiryOptions(tags=all_tags, situations=_HARDCODED_SITUATIONS)

    selected_tags: list[str] = selections.get("tags", [])

    filtered = [p for p in products if set(selected_tags) & set(p.tags or [])] if selected_tags else products
    if len(filtered) < 3:
        filtered = products

    def score(p: Product) -> float:
        overlap = len(set(selected_tags) & set(p.tags or []))
        return overlap + random.random() * 0.1

    top3 = sorted(filtered, key=score, reverse=True)[:3]

    if not top3:
        return [], inquiry_options

    reasons = await _generate_reasons(top3, selected_tags, llm, cache)

    return [
        SuggestedProduct(
            id=p.id,
            name=p.name,
            price=p.price,
            photo_url=p.photo_url,
            description=p.description,
            reason=reasons[i],
        )
        for i, p in enumerate(top3)
    ], inquiry_options
