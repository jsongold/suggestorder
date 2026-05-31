from __future__ import annotations
from typing import Protocol


class LLMClient(Protocol):
    async def complete(self, prompt: str, max_tokens: int = 256, json_mode: bool = False) -> str: ...


class EmbeddingClient(Protocol):
    async def embed(self, text: str) -> list[float]: ...


class CacheClient(Protocol):
    async def get(self, key: str) -> str | None: ...
    async def set(self, key: str, value: str, ttl: int) -> None: ...
