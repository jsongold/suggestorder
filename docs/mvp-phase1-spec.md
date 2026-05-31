# MVP Phase 1 Implementation Spec

**Scope**: mode=`no` + mode=`send` × Destination=Standalone × Payment=Stub
**Date**: 2026-05-29
**Status**: Implementation in progress (parallel agents)

This is the single source of truth for parallel implementation. All agents work from here.

---

## 1. Out of Scope (Phase 1)

- mode=`tab` (defer to Phase 2)
- Square Orders API / Square POS destination
- Square Web Payments / Terminal (stub only — `payment_channel="stub"`)
- Catalog PR-style sync (use existing /admin endpoints to seed)
- OAuth, multi-tenant auth beyond API key
- Real-time push (use HTTP polling for intake)
- `org` admin UI (seed via script)

---

## 2. DB Schema (already written in `apps/api/db/models.py`)

Entities: `Org`, `Store`, `Entry`, `Product`, `Session`, `Tab`, `TabItem`, `StandaloneOrder`, `DispatchLog`, `SuggestionLog`.

Key fields per the design:

- `Store.destination_type`: `'standalone' | 'square_pos'` (Phase 1: always `'standalone'`)
- `Store.payment_channel`: `'stub' | 'web_payments' | 'terminal'` (Phase 1: always `'stub'`)
- `Entry.mode`: `'no' | 'send' | 'tab'` (Phase 1: support `'no'` and `'send'`)
- `Entry.kind`: `'dine_in' | 'takeout' | 'counter'`
- `Tab.state`: `'open' | 'closed'`
- `StandaloneOrder.status`: `'received' | 'preparing' | 'ready' | 'handed' | 'canceled'`
- `StandaloneOrder.payment_status`: `'unpaid' | 'paid'`

DB is recreated via `Base.metadata.create_all` in lifespan. No Alembic. To reset: `docker compose down -v && docker compose up -d db redis`.

---

## 3. API Endpoints (contract)

### Public (customer-facing) — no auth, session cookie

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/entries/{entry_id}` | Resolve entry context (store name, label, mode) |
| POST | `/sessions` | Create/resume session for `entry_id`. Returns `session_id` (also set as cookie `so_sid`) |
| GET | `/catalog/{store_id}/products` | Public catalog for a store |
| POST | `/sessions/{session_id}/suggest` | AI suggest (existing logic, modified to use session_id) |
| GET | `/sessions/{session_id}/tab` | Get current open tab (auto-create on first call) |
| POST | `/sessions/{session_id}/tab/items` | Add item to tab |
| DELETE | `/sessions/{session_id}/tab/items/{tab_item_id}` | Remove item from tab |
| PATCH | `/sessions/{session_id}/tab/items/{tab_item_id}` | Update quantity/note |
| POST | `/sessions/{session_id}/tab/close` | Close tab → dispatch to destination |

### Merchant intake (Standalone) — auth via `X-Api-Key` header

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/intake/{store_id}/orders` | List orders. Query params: `status` (filter), `since` (polling cursor) |
| GET | `/intake/{store_id}/orders/{order_id}` | Single order detail |
| PATCH | `/intake/{store_id}/orders/{order_id}/status` | Update status `{state, reason?}` |
| PATCH | `/intake/{store_id}/orders/{order_id}/payment` | Update payment status `{status, method?}` |

### Admin (org/store/entry management) — auth via `X-Api-Key`

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/admin/orgs` | Create org (returns admin api_key) |
| POST | `/admin/stores` | Create store under org |
| GET | `/admin/stores` | List stores in org |
| POST | `/admin/stores/{store_id}/entries` | Create entry (table/counter QR target) |
| GET | `/admin/stores/{store_id}/entries` | List entries |
| PATCH | `/admin/entries/{entry_id}` | Update label/mode/is_active (soft delete via is_active=false) |
| (existing) | `/admin/products` | Product CRUD — keep mostly as-is, just scope to store via header |

### Payment stub

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/payment/stub/charge` | Stub: returns `{payment_id, status: "completed"}` immediately |

---

## 4. Standalone payload (sent to destination at tab close)

Conforms to `docs/destination-payload-schemas.md` §4.1. Stored in `StandaloneOrder.payload`.

```json
{
  "schema_version": "1.0",
  "order_id": "<uuid>",
  "org_id": "<uuid>",
  "store": {"id": "<uuid>", "name": "...", "timezone": "Asia/Tokyo"},
  "entry": {"id": "<uuid>", "kind": "dine_in", "label": "テーブル5"},
  "session": {"id": "<uuid>", "started_at": "..."},
  "mode": "send",
  "closed_at": "...",
  "line_items": [...],
  "totals": {"subtotal": {...}, "tax": {...}, "total": {...}},
  "cart_source": {"ai_assisted": true, "inquiry_tags": [...]},
  "payment": {"status": "unpaid"},
  "status": {"current": "received", "updated_at": "...", "history": [...]}
}
```

Tax calculation: Phase 1 = `0` (no tax). Just `subtotal = total`. Add proper tax later.

---

## 5. Session / Cookie

- Cookie name: `so_sid`, HttpOnly, Secure (only in prod), SameSite=Lax
- Value: session UUID (no separate token)
- Lifetime: 24h sliding window
- Created on first `POST /sessions` if cookie not present
- Frontend: send cookie automatically (CORS `credentials: 'include'`)
- For local dev (HTTP), `Secure=false`

---

## 6. File ownership (parallel agent boundaries)

To avoid edit conflicts, each agent owns specific files. **Do not write outside your assigned files.**

### Agent A: Backend routers + adapters
**Owned files**:
- `apps/api/routers/tab.py` (new)
- `apps/api/routers/intake.py` (new)
- `apps/api/routers/entry.py` (new) — GET /entries/{id}, POST /sessions
- `apps/api/routers/payment_stub.py` (new)
- `apps/api/services/adapters/standalone_intake.py` (new)
- `apps/api/services/dispatcher.py` (new) — DestinationGateway
- `apps/api/schemas.py` (rewrite — add Tab, StandaloneOrder, Entry schemas)
- `apps/api/routers/admin.py` (modify — add org/store/entry CRUD, keep product CRUD)
- `apps/api/routers/suggest.py` (modify — use new Session model)
- `apps/api/routers/catalog.py` (modify — minor, keep mostly)
- `apps/api/main.py` (modify — register new routers)

### Agent B: Frontend customer
**Owned files**:
- `apps/web/app/e/[entry_id]/page.tsx` (new — replaces old `[store_id]`)
- `apps/web/app/e/[entry_id]/TabView.tsx` (new)
- `apps/web/app/e/[entry_id]/SuggestionCards.tsx` (new or extract)
- `apps/web/app/e/[entry_id]/MenuList.tsx` (new or extract)
- `apps/web/app/e/[entry_id]/SendButton.tsx` (new)
- `apps/web/lib/api.ts` (new — typed API client)
- `apps/web/app/[store_id]/page.tsx` (delete or stub redirect)
- `apps/web/app/page.tsx` (modify if needed for landing)

### Agent C: Frontend merchant intake
**Owned files**:
- `apps/web/app/merchant/[store_id]/intake/page.tsx` (new)
- `apps/web/app/merchant/[store_id]/intake/OrderCard.tsx` (new)
- `apps/web/app/merchant/[store_id]/intake/useOrderPolling.ts` (new — polling hook)
- `apps/web/app/admin/page.tsx` (modify — minimal, just product CRUD lookup. Keep existing logic)

### Agent D: seed + tests
**Owned files**:
- `scripts/seed.py` (rewrite — create org, store, entries, products)
- `tests/test_e2e.py` (rewrite — cover Phase 1 flow)
- `README.md` (update setup instructions)

---

## 7. Conventions for all agents

- **Python**: Python 3.12, async/await throughout, type hints, FastAPI patterns. No new dependencies unless documented.
- **TypeScript/React**: Next.js 14 App Router, TailwindCSS (already in project), React Server Components where appropriate, client components for interactivity.
- **Auth header for admin/intake**: `X-Api-Key: <api_key>` + `X-Store-ID: <uuid>`
- **Date/time**: ISO 8601 with timezone (UTC in DB, Asia/Tokyo display)
- **IDs**: All UUIDs (no ULIDs for MVP — simpler)
- **Currency**: JPY only, integer amounts (no decimals)
- **Idempotency**: Phase 1 punt — only `tab/close` should be idempotent (use `tab_id` as natural key, return same StandaloneOrder if already dispatched)
- **Error format**: FastAPI default (`{"detail": "..."}`)

---

## 8. Customer flow (target behavior)

```
1. Customer scans QR → /e/{entry_id}
2. Frontend: GET /entries/{entry_id} → resolve store + mode
   If no cookie: POST /sessions → set cookie
3. Frontend: GET /catalog/{store_id}/products → menu list
4. Customer taps tags → POST /sessions/{id}/suggest → Top 3
5. Customer taps "Add to Tab"
   → POST /sessions/{id}/tab/items
6. (mode=send) Customer taps "Order" button
   → POST /sessions/{id}/tab/close
   → backend: dispatch via StandaloneIntakeAdapter
   → returns success
7. UI shows "ご注文を送信しました"
```

For mode=`no`: hide "Order" button, show "Add to Memo" instead. No close. Tab persists.

---

## 9. Merchant flow (target behavior)

```
Merchant opens /merchant/{store_id}/intake (auth via session/api_key)
  ↓ poll every 5 seconds: GET /intake/{store_id}/orders?status=active
  ↓ new order arrives → audio chime + new card
Merchant taps "Preparing" → PATCH .../status {state: "preparing"}
Merchant taps "Ready" → PATCH .../status {state: "ready"}
Merchant taps "Handed" → PATCH .../status {state: "handed"}
Merchant marks paid (cash) → PATCH .../payment {status: "paid", method: "cash"}
```

---

## 10. Stub Payment behavior

`POST /payment/stub/charge` body:
```json
{"amount": 1700, "currency": "JPY", "tab_id": "..."}
```
returns:
```json
{"payment_id": "stub_<uuid>", "status": "completed", "amount": 1700, "currency": "JPY"}
```

Tab close in Phase 1 does NOT call payment endpoint — payment_status stays `unpaid` in StandaloneOrder, and merchant marks it paid manually after cash collection.

The stub endpoint exists for future use / e2e test demonstration, but is not wired into the main flow.

---

## 11. Done criteria

- DB recreates cleanly
- seed.py creates: 1 org, 1 store, 2 entries (table & takeout), 5+ products
- Customer can open `/e/{entry_id}`, see menu, get AI suggestions, add to tab, tap "Order"
- Merchant can open `/merchant/{store_id}/intake`, see incoming orders, advance status
- e2e test passes the full happy path
- README updated with new commands
