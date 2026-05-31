from __future__ import annotations
import jwt
from fastapi import HTTPException
from db.client import settings


def verify_supabase_token(token: str) -> str:
    """Verify a Supabase JWT and return the Supabase user_id (sub claim)."""
    if not settings.supabase_jwt_secret:
        raise HTTPException(status_code=500, detail="Supabase not configured on this server")
    try:
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
        user_id: str = payload["sub"]
        return user_id
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}")
