from __future__ import annotations
from openai import AsyncOpenAI
from tenacity import retry, stop_after_attempt, wait_exponential


class OpenAILLM:
    def __init__(self, api_key: str, model: str = "gpt-4o-mini"):
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=4))
    async def complete(self, prompt: str, max_tokens: int = 256, json_mode: bool = False) -> str:
        kwargs = {
            "model": self._model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
        }
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        response = await self._client.chat.completions.create(**kwargs)
        return response.choices[0].message.content.strip()


class OpenAIEmbedding:
    def __init__(self, api_key: str, model: str = "text-embedding-3-small"):
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=4))
    async def embed(self, text: str) -> list[float]:
        response = await self._client.embeddings.create(model=self._model, input=text)
        return response.data[0].embedding
