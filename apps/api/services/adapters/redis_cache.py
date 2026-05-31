from __future__ import annotations
from redis.asyncio import Redis


class RedisCache:
    def __init__(self, url: str):
        self._redis = Redis.from_url(url, decode_responses=True)

    async def get(self, key: str) -> str | None:
        return await self._redis.get(key)

    async def set(self, key: str, value: str, ttl: int) -> None:
        await self._redis.setex(key, ttl, value)
