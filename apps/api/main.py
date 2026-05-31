import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from db.client import Base, engine
from routers import admin, catalog, entry, intake, payment_stub, suggest, tab


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


app = FastAPI(title="suggestorder API", lifespan=lifespan)


# CORS — credentials must be allowed for cookie-based sessions, which means
# we cannot use the "*" wildcard for origins.
_default_origins = "http://localhost:3000"
_origins = [
    o.strip()
    for o in os.environ.get("CORS_ORIGINS", _default_origins).split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(admin.router, prefix="/admin", tags=["admin"])
app.include_router(catalog.router, prefix="/catalog", tags=["catalog"])
app.include_router(entry.entries_router, prefix="/entries", tags=["entries"])
app.include_router(entry.sessions_router, prefix="/sessions", tags=["sessions"])
app.include_router(suggest.router, prefix="/sessions", tags=["suggest"])
app.include_router(tab.router, prefix="/sessions", tags=["tab"])
app.include_router(intake.router, prefix="/intake", tags=["intake"])
app.include_router(payment_stub.router, prefix="/payment/stub", tags=["payment-stub"])


@app.get("/health")
async def health():
    return {"status": "ok"}
