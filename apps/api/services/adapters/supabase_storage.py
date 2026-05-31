"""Supabase Storage adapter for product photo uploads.

Prerequisites (one-time, in Supabase Dashboard):
  1. Create a public storage bucket named "product-photos"
  2. Set bucket to public so uploaded files are served without auth
"""
from __future__ import annotations
from supabase import create_client, Client
from db.client import settings

_client: Client | None = None

BUCKET = "product-photos"


def _get_client() -> Client:
    global _client
    if _client is None:
        if not settings.supabase_url or not settings.supabase_service_role_key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
        _client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    return _client


def upload_photo(file_bytes: bytes, path: str, content_type: str) -> str:
    """Upload bytes to Supabase Storage and return the public URL."""
    client = _get_client()
    client.storage.from_(BUCKET).upload(
        path=path,
        file=file_bytes,
        file_options={"content-type": content_type, "upsert": "true"},
    )
    return client.storage.from_(BUCKET).get_public_url(path)
