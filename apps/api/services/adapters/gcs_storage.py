"""Google Cloud Storage adapter for product photo uploads.

In production on Cloud Run, auth is via Workload Identity (ADC).
No credentials need to be configured explicitly.

Env vars:
  GCS_BUCKET  — target bucket name (default: suggestorder-dev-product-photos)
"""
from __future__ import annotations

import os

from google.cloud import storage

_client: storage.Client | None = None

BUCKET = os.environ.get("GCS_BUCKET", "suggestorder-dev-product-photos")


def _get_client() -> storage.Client:
    global _client
    if _client is None:
        _client = storage.Client()
    return _client


def upload_photo(file_bytes: bytes, path: str, content_type: str) -> str:
    """Upload bytes to GCS and return the public URL."""
    client = _get_client()
    bucket = client.bucket(BUCKET)
    blob = bucket.blob(path)
    blob.upload_from_string(file_bytes, content_type=content_type)
    blob.make_public()
    return blob.public_url
