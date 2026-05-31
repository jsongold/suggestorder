from __future__ import annotations
from db.client import settings
from services.ports import LLMClient, EmbeddingClient, CacheClient
from services.adapters.openai_llm import OpenAILLM, OpenAIEmbedding
from services.adapters.redis_cache import RedisCache


_llm: LLMClient = OpenAILLM(api_key=settings.openai_api_key, model="gpt-4o-mini")
_embedding: EmbeddingClient = OpenAIEmbedding(api_key=settings.openai_api_key, model="text-embedding-3-small")
_cache: CacheClient = RedisCache(url=settings.redis_url)


def get_llm() -> LLMClient:
    return _llm


def get_embedding() -> EmbeddingClient:
    return _embedding


def get_cache() -> CacheClient:
    return _cache
