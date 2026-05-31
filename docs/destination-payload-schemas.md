# Destination Payload Schemas — suggestorder

**Date**: 2026-05-29
**Status**: Design draft

## 1. Overview

`suggestorder` is an AI-assisted mobile ordering web app organized as `org → store → entry → session`. An `entry` represents a physical QR location (a specific table, a takeout counter, a drive-through window), and a `session` is a single customer's interaction with that entry. The customer builds a tab (cart) through AI-guided inquiries; when the tab closes (either immediately on `send` mode, or on explicit checkout in `tab` mode) the tab contents are dispatched to a configured **Destination**. Catalog data (items, prices, modifiers) is mastered in suggestorder's MenuAdmin and reconciled with each destination through a PR-style, AI-assisted sync flow that maintains a mapping table between internal IDs and destination-side IDs (e.g., Square `catalog_object_id`).

There is intentionally **no shared internal canonical order model**. Each destination has its own outbound payload schema, produced by a dedicated adapter. This is the Adapter pattern: the cart (stored server-side, readable by the merchant) is the only internal representation, and every adapter is responsible for projecting that cart into the destination's native shape. This avoids the "lowest common denominator" trap that a canonical order model would impose (Square's `Order` and a standalone intake screen genuinely need different fields), and it lets each adapter evolve at the pace of its target system. Once dispatched, the destination becomes the System of Record for that order; suggestorder retains only a thin reference (destination ID + reference_id) for traceability.

## 2. Mapping rules

| suggestorder concept | Square POS adapter | Standalone intake adapter |
|---|---|---|
| `org` | Square `merchant_id` (configured at integration setup, not in payload) | `org_id` |
| `store` | `order.location_id` (1:1 with Square Location) | `store.id` + `store.name` |
| `entry` | `fulfillments[].pickup_details.note` + `metadata.entry_*` (no native field) | `entry` object with `id`, `label`, `kind` |
| `entry.kind = table` | `fulfillment.type = PICKUP` + `pickup_details.note = "Dine-in: テーブル5"` | `entry.kind = "dine_in"`, `entry.label = "テーブル5"` |
| `entry.kind = takeout` | `fulfillment.type = PICKUP` + `pickup_details.recipient` | `entry.kind = "takeout"` |
| `entry.kind = delivery` | `fulfillment.type = DELIVERY` | `entry.kind = "delivery"` |
| `session.id` | `order.reference_id` (also mirrored in `metadata.session_id`) | `source.session_id` |
| Cart line item | `line_items[]` with `catalog_object_id` | `line_items[]` with `item_id` (internal) |
| Modifier | `line_items[].modifiers[].catalog_object_id` | `line_items[].modifiers[]` |
| Tab close timestamp | implicit (Square sets `created_at`) | `closed_at` |
| Mode (`send` / `tab`) | identical payload; differs only in *when* dispatched | identical payload |
| AI inquiry trail | `metadata.ai_*` (key/value, ≤60 chars per Square limits) | `cart_source` block (full fidelity) |
| Payment | follow-up `CreatePayment` + `PayOrder` | `payment` block; status updated by merchant UI |

## 3. Square POS adapter

### 3.1 CreateOrder payload

`POST /v2/orders`

```json
{
  "idempotency_key": "so_ord_01HXYZ7K3M8N0PQR2STUVWX9YZ",
  "order": {
    "location_id": "L7K3M8N0PQR2S",
    "reference_id": "sess_01HXYZ7K3M8N0PQR2STUVWX9YZ",
    "source": {
      "name": "suggestorder"
    },
    "line_items": [
      {
        "uid": "li_01HXYZA1",
        "quantity": "2",
        "catalog_object_id": "SQ_ITEM_VAR_ABCDEF1234567",
        "catalog_version": 1716800000000,
        "note": "氷少なめ",
        "modifiers": [
          {
            "uid": "mod_01HXYZA1_01",
            "catalog_object_id": "SQ_MOD_OAT_MILK_XYZ",
            "catalog_version": 1716800000000
          }
        ]
      },
      {
        "uid": "li_01HXYZA2",
        "quantity": "1",
        "catalog_object_id": "SQ_ITEM_VAR_GHIJKL7654321",
        "catalog_version": 1716800000000
      }
    ],
    "fulfillments": [
      {
        "uid": "ful_01HXYZ7K",
        "type": "PICKUP",
        "state": "PROPOSED",
        "pickup_details": {
          "recipient": {
            "display_name": "テーブル 5"
          },
          "pickup_at": "2026-05-29T12:42:00+09:00",
          "note": "Dine-in / entry=entry_table_05 / session=sess_01HXYZ7K3M8N0PQR2STUVWX9YZ"
        }
      }
    ],
    "metadata": {
      "so_session_id": "sess_01HXYZ7K3M8N0PQR2STUVWX9YZ",
      "so_entry_id": "entry_table_05",
      "so_entry_kind": "dine_in",
      "so_entry_label": "テーブル5",
      "so_mode": "tab",
      "so_ai_tags": "vegan,cold,quick"
    }
  }
}
```

### 3.2 Field-by-field rationale

- **`idempotency_key`** — `so_ord_` + ULID derived deterministically from `sha256(session_id || tab_close_ts || cart_hash)[:26]`. The same `(session, close_ts, cart)` tuple must always produce the same key so that retries from the suggestorder side never double-create a Square order. A *new* tab close (e.g., merchant reopens the tab and re-sends) produces a new key.
- **`order.location_id`** — resolved from `store.square_location_id`, set during the org→Square integration onboarding. One suggestorder `store` maps to exactly one Square Location in MVP.
- **`reference_id`** — set to `session.id` so the Square Dashboard surfaces the suggestorder session as a single string; this is the canonical back-link for support and reconciliation.
- **`source.name`** — `"suggestorder"`. Appears in Square reporting so merchants can filter.
- **`line_items[].catalog_object_id`** — taken from the sync mapping table. We always send `catalog_object_id` (never ad-hoc `name`+`base_price_money`) when a mapping exists, so Square computes prices, taxes, and modifiers authoritatively. `catalog_version` is pinned to the version at sync time to avoid silent re-pricing.
- **`line_items[].uid`** — stable per cart line so that subsequent updates (in `tab` mode, if we ever support patch) can target the same line.
- **`line_items[].note`** — free-text customer note ("氷少なめ"). Surfaces on Square KDS.
- **`fulfillments[]`** — Square's Orders API only supports `PICKUP`, `SHIPMENT`, and `DELIVERY`. **There is no native dine-in type.** For `entry.kind = dine_in` we use `PICKUP` with `recipient.display_name = "テーブル 5"` and a structured `note` that embeds `entry_id` and `session_id`. KDS staff see "テーブル 5" prominently; the structured `note` is for downstream tooling.
- **`metadata`** — Square metadata is a flat string-keyed, string-valued map (≤60 chars per value, ≤10 keys). We mirror the critical identifiers there so a Square-side query can pivot back to suggestorder without parsing the `note`.

### 3.3 Follow-up CreatePayment + PayOrder

After `CreateOrder` returns an `order.id`, payment is taken in one of two ways depending on whether the customer pays in suggestorder (card on file / Web Payments SDK token) or at the counter.

**`POST /v2/payments` (customer paid in-app)**

```json
{
  "idempotency_key": "so_pay_01HXYZ7K3M8N0PQR2STUVWX9YZ",
  "source_id": "cnon:card-nonce-from-web-payments-sdk",
  "amount_money": {
    "amount": 1480,
    "currency": "JPY"
  },
  "order_id": "sq_order_abcdef1234567",
  "location_id": "L7K3M8N0PQR2S",
  "reference_id": "sess_01HXYZ7K3M8N0PQR2STUVWX9YZ",
  "autocomplete": true,
  "note": "suggestorder session sess_01HXYZ7K…"
}
```

`autocomplete: true` captures immediately and auto-pays the order, so `PayOrder` is not needed in this path.

**`POST /v2/orders/{order_id}/pay` (split / external payment IDs)**

```json
{
  "idempotency_key": "so_payord_01HXYZ7K3M8N0PQR2STUVWX9YZ",
  "order_id": "sq_order_abcdef1234567",
  "payment_ids": [
    "sq_payment_aaa111",
    "sq_payment_bbb222"
  ]
}
```

Used when we have multiple `Payment` IDs already in `APPROVED` state (e.g., split bill) and need to atomically close the order.

### 3.4 Idempotency strategy

- **Order creation:** key = `"so_ord_" + ulid(sha256(session_id || tab_close_ts_ms || cart_content_hash))`. Deterministic, so HTTP-level retries (timeouts, 5xx) are safe. Square retains idempotency keys for 24h, which covers our retry window.
- **Payment creation:** key = `"so_pay_" + session_id`-derived ULID with a payment attempt counter suffix, because a customer may legitimately retry payment with a different card.
- **PayOrder:** key = `"so_payord_" + order_id`, since this is a one-shot finalization.

### 3.5 Webhook events to subscribe

- `order.created`
- `order.updated`
- `order.fulfillment.updated`
- `payment.created`
- `payment.updated`
- `refund.created`
- `refund.updated`
- `catalog.version.updated` (drives PR-style catalog re-sync)

### 3.6 Known limitations

- **No native dine-in fulfillment type.** Modeled as `PICKUP` with a structured note; some Square reports will count dine-in tabs as pickup.
- **Ad-hoc items.** If an AI suggestion produces an item not yet mapped to a Square catalog object, we must either (a) block the send and trigger sync, or (b) fall back to a line item with `name` + `base_price_money` and no `catalog_object_id`. MVP: option (a), strict.
- **Metadata caps.** 10 keys × 60 chars. AI inquiry trails longer than that are truncated and the full record stays in the suggestorder cart record.
- **Catalog version drift.** If `catalog_version` is rejected, we auto-refetch and retry once; subsequent failure surfaces to the merchant.
- **No native "tab" semantic.** Square `OPEN` orders exist but their lifecycle differs; MVP sends only on tab close.
- **Modifier price overrides** are not currently supported by the adapter.

## 4. Standalone intake adapter

### 4.1 Schema (TypeScript-style)

```typescript
type StandaloneOrderPayload = {
  schema_version: "1.0";
  order_id: string;                     // ULID, suggestorder-issued
  org_id: string;
  store: {
    id: string;
    name: string;                       // "カフカ渋谷店"
    timezone: string;                   // "Asia/Tokyo"
  };
  entry: {
    id: string;
    kind: "dine_in" | "takeout" | "delivery" | "counter";
    label: string;                      // "テーブル5", "テイクアウト窓口"
  };
  session: {
    id: string;
    started_at: string;                 // ISO-8601
    customer_hint?: string;             // optional, e.g. nickname entered by customer
  };
  mode: "send" | "tab";                 // tab vs immediate send (payload identical)
  closed_at: string;                    // ISO-8601, tab close timestamp
  line_items: Array<{
    line_id: string;                    // stable per cart line
    item_id: string;                    // internal suggestorder ID
    name: string;                       // snapshot of display name at close time
    quantity: number;
    unit_price: { amount: number; currency: string };  // minor units
    subtotal: { amount: number; currency: string };
    modifiers?: Array<{
      modifier_id: string;
      name: string;
      price_delta: { amount: number; currency: string };
    }>;
    note?: string;                      // free-text customer note
  }>;
  totals: {
    subtotal: { amount: number; currency: string };
    tax: { amount: number; currency: string };
    discount?: { amount: number; currency: string };
    total: { amount: number; currency: string };
  };
  cart_source: {
    ai_assisted: boolean;
    inquiry_tags: string[];             // e.g. ["vegan", "cold", "quick"]
    inquiry_trail?: Array<{             // optional, full Q&A trail
      step: number;
      question: string;
      answer: string;
    }>;
  };
  payment: {
    status: "unpaid" | "authorized" | "paid" | "refunded" | "void";
    method?: "cash" | "card" | "qr" | "in_app" | "other";
    paid_at?: string;
    external_ref?: string;              // e.g. cash register receipt no.
  };
  status: {
    current: "received" | "preparing" | "ready" | "handed" | "canceled";
    updated_at: string;
    history: Array<{
      state: "received" | "preparing" | "ready" | "handed" | "canceled";
      at: string;
      actor?: string;                   // staff member ID, if known
      reason?: string;                  // required for "canceled"
    }>;
  };
};
```

### 4.2 Sample payload

```json
{
  "schema_version": "1.0",
  "order_id": "ord_01HXYZ7K3M8N0PQR2STUVWX9YZ",
  "org_id": "org_cafkah",
  "store": {
    "id": "store_shibuya",
    "name": "カフカ渋谷店",
    "timezone": "Asia/Tokyo"
  },
  "entry": {
    "id": "entry_table_05",
    "kind": "dine_in",
    "label": "テーブル5"
  },
  "session": {
    "id": "sess_01HXYZ7K3M8N0PQR2STUVWX9YZ",
    "started_at": "2026-05-29T12:28:11+09:00"
  },
  "mode": "tab",
  "closed_at": "2026-05-29T12:42:00+09:00",
  "line_items": [
    {
      "line_id": "li_01HXYZA1",
      "item_id": "item_oat_latte",
      "name": "オーツラテ",
      "quantity": 2,
      "unit_price": { "amount": 580, "currency": "JPY" },
      "subtotal": { "amount": 1160, "currency": "JPY" },
      "modifiers": [
        {
          "modifier_id": "mod_oat_milk",
          "name": "オーツミルク変更",
          "price_delta": { "amount": 60, "currency": "JPY" }
        }
      ],
      "note": "氷少なめ"
    },
    {
      "line_id": "li_01HXYZA2",
      "item_id": "item_carrot_cake",
      "name": "キャロットケーキ",
      "quantity": 1,
      "unit_price": { "amount": 480, "currency": "JPY" },
      "subtotal": { "amount": 480, "currency": "JPY" }
    }
  ],
  "totals": {
    "subtotal": { "amount": 1700, "currency": "JPY" },
    "tax": { "amount": 136, "currency": "JPY" },
    "total": { "amount": 1836, "currency": "JPY" }
  },
  "cart_source": {
    "ai_assisted": true,
    "inquiry_tags": ["vegan", "cold", "quick"],
    "inquiry_trail": [
      { "step": 1, "question": "気分は？", "answer": "さっぱり" },
      { "step": 2, "question": "甘いものも？", "answer": "はい" }
    ]
  },
  "payment": {
    "status": "unpaid"
  },
  "status": {
    "current": "received",
    "updated_at": "2026-05-29T12:42:00+09:00",
    "history": [
      { "state": "received", "at": "2026-05-29T12:42:00+09:00" }
    ]
  }
}
```

### 4.3 Field-by-field rationale

- **`schema_version`** — explicit version so the intake UI can refuse unknown shapes rather than silently misrender.
- **`order_id`** — ULID issued at tab close. Sortable by time, globally unique, URL-safe.
- **`store` / `entry`** — both carry human-readable labels (`name`, `label`) so the intake screen never has to do its own lookups; the payload is self-contained.
- **`entry.kind`** — distinct from Square: standalone supports `dine_in` natively, removing the Square workaround.
- **`session.id`** — kept so support can pivot back to the cart audit log.
- **`mode`** — recorded for analytics (how often `tab` is used vs `send`), but does not change downstream processing.
- **`closed_at`** — single authoritative timestamp for "when did this become an order"; drives SLA timers.
- **`line_items[]`** — name and price are *snapshotted* at close time, not referenced live. The merchant must see what the customer agreed to, even if MenuAdmin changes the item later.
- **`totals`** — pre-computed by suggestorder. Tax math lives server-side, not in the intake UI.
- **`cart_source`** — first-class block. The whole point of suggestorder is AI-assisted ordering; the merchant can learn from which `inquiry_tags` and trail led to this cart. Square's adapter loses most of this; standalone keeps it.
- **`payment`** — starts `unpaid` for `dine_in` (pay at counter) and may start `paid` for in-app prepay flows. `external_ref` is the bridge to a non-integrated POS or cash register.
- **`status` / `status.history`** — current state plus full history for auditability.

### 4.4 Order status state machine

```
                    ┌──────────────────────────────────┐
                    │                                  ▼
   [received] ──► [preparing] ──► [ready] ──► [handed]
       │              │              │
       │              │              │
       └──────────────┴──────────────┴──► [canceled]   (reason required)
```

Rules:
- Initial state on payload arrival: `received`.
- Forward transitions only: `received → preparing → ready → handed`.
- `canceled` is reachable from any non-terminal state and requires `reason`.
- `handed` and `canceled` are terminal.
- Skipping forward (e.g., `received → ready`) is allowed for fast operations (cold drinks) but logged.
- Backward transitions are not allowed; mistakes are corrected via `canceled` + new order.

### 4.5 How merchant status updates flow back

The merchant intake UI is a thin client over suggestorder's own backend (the standalone destination is *internal*, unlike Square). Status updates are:

1. Merchant taps a state button on the intake screen.
2. UI calls `PATCH /v1/orders/{order_id}/status` with `{ state, reason? }`.
3. Backend validates the transition against the state machine, appends to `status.history`, updates `status.current` and `status.updated_at`.
4. Backend pushes the new status to the customer's session over the existing realtime channel (so the customer's phone shows "ready").
5. Status changes are emitted as internal events so analytics and notifications can consume them.

Payment status updates follow the same `PATCH /v1/orders/{order_id}/payment` pattern.

## 5. Cross-cutting concerns

### 5.1 entry → destination mapping

| `entry.kind` | Square | Standalone |
|---|---|---|
| `dine_in` | `PICKUP` + `recipient.display_name = entry.label` + structured `note` | `entry.kind = "dine_in"`, `entry.label = "テーブル5"` |
| `takeout` | `PICKUP` + `recipient.display_name = customer_hint or "Takeout"` | `entry.kind = "takeout"` |
| `delivery` | `DELIVERY` + `delivery_details` | `entry.kind = "delivery"` |
| `counter` | `PICKUP` | `entry.kind = "counter"` |

The adapter is the only place that performs this mapping; entry semantics never leak into transport code.

### 5.2 Error handling at the adapter boundary

- **Validation errors (4xx, our fault).** Adapter raises a typed `AdapterValidationError` referencing the offending field path. Tab is *not* re-closed; merchant sees a "送信できません" banner with the field and a "retry" button after correction. No retry storms.
- **Transient errors (5xx, network).** Exponential backoff with jitter, up to 5 attempts over ~2 minutes, using the same `idempotency_key`. After exhaustion, the order is parked in a `dispatch_failed` queue visible to the merchant.
- **Catalog drift (Square `catalog_version` mismatch).** One automatic refetch + retry; second failure surfaces as a sync issue and opens a sync PR.
- **Partial success.** `CreateOrder` succeeded but `CreatePayment` failed → order exists in Square in unpaid state; merchant can complete payment at the Square terminal. We do not auto-cancel the order.
- **Unmapped items.** Hard fail before send in MVP; merchant sees which items need mapping.
- **All adapter errors** are logged with `session_id`, `order_id` (if assigned), adapter name, attempt number, and the destination's raw error payload.

### 5.3 Versioning

- **Standalone schema:** `schema_version` field, semver-style. Backwards-compatible additions bump the minor (`1.1`); breaking changes bump the major (`2.0`) and run side-by-side with `1.x` until consumers migrate.
- **Square adapter:** pinned to a specific Square API version via the `Square-Version` header; upgrades are explicit and tested.
- **Catalog mapping table:** versioned per item with `catalog_version` so we can detect drift.
- **Adapter code itself:** each adapter declares the `schema_version` / `Square-Version` it emits; the dispatcher logs both alongside each send for forensics.

## 6. Open questions

1. **Dine-in modeling on Square.** Is the `PICKUP` + note workaround acceptable to merchants, or should we explore Square's Open Tabs / Invoices API for a closer fit?
2. **Multi-location stores.** MVP assumes one Square Location per suggestorder `store`. Do we need many-to-one support for stores with bar + kitchen as separate Square Locations?
3. **Ad-hoc items.** Strict-block in MVP — but should AI-suggested items that *almost* match an existing catalog item auto-propose a sync PR instead of failing?
4. **Tab mode partial sends.** Should `tab` mode ever push intermediate state to the destination (e.g., for KDS visibility), or remain truly silent until close?
5. **Payment in `tab` mode.** When should we call `CreatePayment` — at tab close, or pre-authorize at session start?
6. **Refunds / cancellations.** Do refunds originate on the destination side (merchant cancels in Square / standalone) and webhook back to suggestorder, or can the customer trigger from the app?
7. **Multi-currency.** Currency is always `JPY` in MVP. When we expand, does pricing live per-store or per-org?
8. **AI inquiry trail PII.** The `inquiry_trail` may contain free-text customer answers. What is the retention policy, and does it need redaction before storage?
9. **Standalone status push to customer.** Realtime channel (WebSocket / SSE / FCM) is unspecified. Which?
10. **Reconciliation cadence.** How located often do we cross-check destination order state against our `dispatch_failed` queue and our `reference_id`-linked records?
