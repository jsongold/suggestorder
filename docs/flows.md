# Suggestorder Flows: Customer × Merchant × Configuration

**Date**: 2026-05-29
**Status**: Design draft
**Scope**: Sequence diagrams for all configuration combinations defined in PRD

This document expands the high-level UX flow in `PRD.md` into concrete sequence diagrams for each combination of:

- **Mode** (per entry): `no` / `send` / `tab`
- **Destination** (per store): `SquarePOS` / `StandaloneIntake`
- **PaymentChannel** (per store): `Web` / `Terminal`

The customer-facing flow is largely identical across combinations; the merchant-facing flow diverges most.

---

## 0. Configuration Matrix

```
                                      Destination
                              ┌──────────┬────────────┐
                              │ SquarePOS│ Standalone │
       PaymentChannel ┌───────┼──────────┼────────────┤
                      │  Web  │   Q1     │    Q2      │
                      │Terminal│   Q3    │    Q4      │
                      └───────┴──────────┴────────────┘

  Mode (per entry):
    no    — applies regardless of destination/payment (no send)
    send  — close triggered per customer "Order" tap
    tab   — close triggered per customer "Checkout" tap
```

| Combination | Use case |
|-------------|---------|
| no | Stores using suggestorder as a smart menu display |
| send + Q1 | Café with Square POS and online customer payment |
| send + Q2 | Café without Square POS; uses StandaloneIntake + customer pays online |
| send + Q3 | Café with Square POS and customer pays at counter terminal |
| send + Q4 | Café without Square POS; customer pays at counter terminal |
| tab + Q1..Q4 | Same as send variants, but customer accumulates over time |

---

## 1. Mode = `no` (no destination, no payment)

Pure menu + AI suggestion. Tab persists but never closes.

```mermaid
sequenceDiagram
    actor C as Customer
    participant M as Menu
    participant API as MenuAPI
    participant MC as MenuCatalog
    participant IS as ItemSuggest
    participant CP as CustomerPref

    C->>M: scan QR (org/store/entry)
    M->>API: GET /catalog?store=...&entry=...
    API->>MC: fetch catalog
    MC-->>API: items
    API-->>M: menu data
    M-->>C: render menu + inquiry UI

    C->>M: tap tags (#cold, #sweet)
    M->>API: POST /suggest
    API->>IS: rank candidates
    IS-->>API: Top 3 + reasoning
    API->>CP: log intent + suggestion
    API-->>M: 3 cards
    M-->>C: render cards

    C->>M: tap "Add to Tab"
    M->>API: POST /tab/add (session, item)
    API-->>M: tab state
    M-->>C: tab updated (memo)

    note over C,M: No "Order" or "Checkout" button.<br/>Tab persists indefinitely.<br/>Merchant takes order verbally.
```

---

## 2. Mode = `send`, **Q1** (Web Payments + Square POS)

Customer pays on their phone, order pushes to Square POS.

```mermaid
sequenceDiagram
    actor C as Customer
    participant M as Menu
    participant API as MenuAPI
    participant PC as PaymentChannel<br/>(WebPaymentsAdapter)
    participant DG as DestinationGateway<br/>(SquarePOSAdapter)
    participant SQ as Square API
    participant MAdm as MenuAdmin

    note over C,M: [Catalog + Suggest + Add-to-Tab steps<br/>identical to Mode=no, omitted for brevity]

    C->>M: tap "Order" (close tab + send)
    M->>API: POST /tab/close
    API->>PC: initiate(amount, order_ref)
    PC-->>M: Web Payments SDK token request
    M-->>C: card form (Square hosted)
    C->>M: enter card / Apple Pay
    M->>PC: tokenize → CreatePayment(autocomplete=false, order_ref)
    PC->>SQ: POST /v2/payments
    SQ-->>PC: payment APPROVED
    PC-->>API: payment ref
    API->>DG: send(tab, payment_ref)
    DG->>SQ: POST /v2/orders (CreateOrder)
    SQ-->>DG: order_id
    DG->>SQ: POST /v2/orders/{id}/pay (payment_ids)
    SQ-->>DG: order COMPLETED
    DG->>SQ: POST /v2/payments/{id}/complete (capture)
    SQ-->>DG: payment COMPLETED
    DG-->>API: send result
    API-->>M: success
    M-->>C: "ご注文を送信しました"

    note over SQ,MAdm: Order now visible in Square POS/KDS/Order Manager.<br/>Merchant fulfills via Square workflow.
```

---

## 3. Mode = `send`, **Q2** (Web Payments + Standalone)

Customer pays on their phone, order shows on merchant's StandaloneIntake screen.

```mermaid
sequenceDiagram
    actor C as Customer
    participant M as Menu
    participant API as MenuAPI
    participant PC as PaymentChannel<br/>(WebPaymentsAdapter)
    participant DG as DestinationGateway<br/>(StandaloneIntakeAdapter)
    participant SI as StandaloneIntake UI
    actor Sf as Staff

    note over C,M: [Catalog + Suggest + Add-to-Tab steps omitted]

    C->>M: tap "Order"
    M->>API: POST /tab/close
    API->>PC: initiate(amount, order_ref)
    PC-->>M: Web Payments SDK token request
    M-->>C: card form
    C->>M: enter card
    M->>PC: tokenize → CreatePayment(autocomplete=true)
    PC-->>API: payment COMPLETED
    API->>DG: send(tab, payment_ref)
    DG->>SI: persist + push (WS or SSE)
    SI-->>Sf: chime + new order card
    DG-->>API: send result
    API-->>M: success
    M-->>C: "ご注文を送信しました"

    Sf->>SI: tap "Preparing" → "Ready" → "Handed"
    SI->>DG: status update (write-back)

    note over Sf,SI: All order state lives in suggestorder DB.<br/>Daily CSV export for accounting.
```

---

## 4. Mode = `send`, **Q3** (Terminal + Square POS)

Customer scans QR, builds tab, then completes payment at the counter Square Terminal.

```mermaid
sequenceDiagram
    actor C as Customer
    participant M as Menu
    participant API as MenuAPI
    participant PC as PaymentChannel<br/>(TerminalAdapter)
    participant DG as DestinationGateway<br/>(SquarePOSAdapter)
    participant SQ as Square API
    participant T as Square Terminal<br/>(device)
    actor Sf as Staff

    note over C,M: [Catalog + Suggest + Add-to-Tab steps omitted]

    C->>M: tap "Order"
    M->>API: POST /tab/close
    API->>DG: pre-create order (CreateOrder, OPEN, no payment yet)
    DG->>SQ: POST /v2/orders
    SQ-->>DG: order_id
    API->>PC: initiate(amount, order_id, device_id)
    PC->>SQ: POST /v2/terminals/checkouts
    SQ->>T: push checkout request
    T-->>Sf: terminal screen activates
    M-->>C: "Please tap at the counter terminal"

    C->>T: tap card / NFC / PayPay
    T->>SQ: payment captured
    SQ-->>PC: webhook terminal.checkout.updated (COMPLETED)
    PC-->>API: payment ref
    API->>DG: pay(order_id, payment_ref)
    DG->>SQ: POST /v2/orders/{id}/pay
    SQ-->>DG: order COMPLETED
    DG-->>API: send result
    API-->>M: success (push to customer)
    M-->>C: "ご注文を送信しました"
```

---

## 5. Mode = `send`, **Q4** (Terminal + Standalone)

Niche combo. Customer pays at Square Terminal but order intake is suggestorder's own UI.

```mermaid
sequenceDiagram
    actor C as Customer
    participant M as Menu
    participant API as MenuAPI
    participant PC as PaymentChannel<br/>(TerminalAdapter)
    participant DG as DestinationGateway<br/>(StandaloneIntakeAdapter)
    participant SI as StandaloneIntake UI
    participant SQ as Square API
    participant T as Square Terminal
    actor Sf as Staff

    note over C,M: [Catalog + Suggest + Add-to-Tab steps omitted]

    C->>M: tap "Order"
    M->>API: POST /tab/close
    API->>PC: initiate(amount, ext_ref, device_id)
    PC->>SQ: POST /v2/terminals/checkouts
    SQ->>T: push request
    T-->>Sf: terminal active
    M-->>C: "Please tap at the counter"

    C->>T: tap card
    T->>SQ: captured
    SQ-->>PC: webhook
    PC-->>API: payment ref
    API->>DG: send(tab, payment_ref)
    DG->>SI: persist + push
    SI-->>Sf: new order card
    DG-->>API: send result
    API-->>M: success
    M-->>C: "ご注文を送信しました"
```

---

## 6. Mode = `tab` (any quadrant)

`tab` mode is identical to `send` mode in **destination/payment flows**. The only difference is the **close trigger**: instead of every "Order" tap, the customer presses "Checkout" once at the end.

```mermaid
sequenceDiagram
    actor C as Customer
    participant M as Menu
    participant API as MenuAPI

    note over C,M: [QR scan + initial catalog load identical]

    loop Multiple times over a meal
        C->>M: browse, suggest, tap items
        M->>API: POST /tab/add
        API-->>M: tab updated (accumulating)
        M-->>C: show tab total
    end

    note over C,M: (Hours may pass)

    C->>M: tap "Checkout" (close tab)
    note right of M: From here:<br/>identical to the close+send<br/>flow in Q1/Q2/Q3/Q4 above
    M->>API: POST /tab/close
    API-->>M: success
    M-->>C: "ご注文を送信しました"
```

**Key differences in `tab` mode**:
- Tab close trigger is one-shot ("Checkout"), not per item batch
- Tab state may persist for hours
- Merchant can view tab contents read-only while open
- Out-of-stock items added earlier are validated only at close time

---

## 7. Merchant Flow: Square POS Destination

Once `DestinationGateway → SquarePOSAdapter` completes, the order is in Square's hands.

```mermaid
sequenceDiagram
    participant DG as DestinationGateway
    participant SQ as Square Backend
    participant POS as Square POS app
    participant KDS as Square KDS
    actor Sf as Staff

    DG->>SQ: CreateOrder + PayOrder
    SQ->>POS: route to POS Order Manager
    SQ->>KDS: route to KDS (if configured)
    POS-->>Sf: new order alert
    KDS-->>Sf: ticket displayed
    Sf->>POS: mark preparing → ready → completed
    POS->>SQ: state updates (internal)

    note over DG,SQ: suggestorder does NOT track post-send state.<br/>SOT for the order is now Square.<br/>Webhook subscription only for revoke/error cases.
```

---

## 8. Merchant Flow: Standalone Intake Destination

```mermaid
sequenceDiagram
    participant DG as DestinationGateway
    participant SI as StandaloneIntake (suggestorder backend)
    participant UI as Intake UI (browser)
    actor Sf as Staff

    DG->>SI: persist new order
    SI->>UI: WebSocket push (chime + new card)
    UI-->>Sf: new order: "Table 5, Latte ×1, Sandwich ×1"
    Sf->>UI: tap "Accept"
    UI->>SI: status → preparing
    Sf->>UI: tap "Ready"
    UI->>SI: status → ready
    Sf->>UI: tap "Handed"
    UI->>SI: status → handed

    note over SI,Sf: Daily CSV export available for accounting.<br/>No automatic reconciliation with external POS.
```

---

## 9. Catalog Sync (PR-style, merchant-triggered)

```mermaid
sequenceDiagram
    actor Sf as Merchant
    participant MAdm as MenuAdmin
    participant MC as MenuCatalog
    participant CG as CatalogGen (AI)
    participant SQ as Square Catalog API

    Sf->>MAdm: trigger "Sync with Square"
    alt direction = pull
        MAdm->>SQ: SearchCatalogItems / ListCatalog
        SQ-->>MAdm: items
        MAdm->>MC: load local items
        MAdm->>CG: compare local vs remote per item
        CG-->>MAdm: PR-style diff<br/>(new/modified/conflict/deleted)
    else direction = push
        MAdm->>MC: load local items
        MAdm->>SQ: fetch corresponding remote items
        MAdm->>CG: compute reverse diff
        CG-->>MAdm: PR-style diff
    end
    MAdm-->>Sf: display PR view (per-item approve/reject/edit)
    Sf->>MAdm: approve item A, reject B, edit C
    MAdm->>MC: apply approved local-side changes
    MAdm->>SQ: UpsertCatalogObject for approved remote-side changes
    SQ-->>MAdm: ack
    MAdm-->>Sf: sync complete
```

---

## 10. Edge Cases (informal)

### Out-of-stock during tab open
1. Merchant marks item sold-out in MenuAdmin (or destination triggers update)
2. Tab UI does NOT auto-refresh (per design — no live notification)
3. On `/tab/close`, server validates each item against current catalog
4. If any item is sold-out: send fails, return validation error to customer
5. Customer removes item, retries
6. Real-world fallback: merchant verbally informs at fulfillment ("申し訳ありません、品切れです")

### Destination unreachable on close
1. Tab close attempted
2. DestinationGateway returns transient failure
3. MenuAPI retries with backoff (3 attempts)
4. On final failure:
   - If payment already captured: queue for retry, alert merchant via internal dashboard
   - If payment not captured: void payment, show error to customer ("ネットワークエラー、もう一度お試しください")

### Customer reloads mid-tab (mode=tab)
- Pending session design (see `docs/session-design-research.md`)

### Multiple customers at same entry
- Pending session design

### Tab open for days (mode=tab abandoned)
- Per PRD: no timeout, no cleanup. Tab persists.
- merchant can manually mark "abandoned" via MenuAdmin (read-only view + soft-archive)

---

## 11. Notes for Implementation Planning

- **Phase 1 (highest coverage / lowest risk)**: Mode=no + Mode=send Q2 (Web Payments + Standalone). This combo has zero Square Orders/Catalog API dependencies.
- **Phase 2**: Mode=send Q1 (Web Payments + Square POS). Requires Square Orders + Catalog API.
- **Phase 3**: Mode=send Q3/Q4 (Terminal). Requires Terminal API + device pairing.
- **Phase 4**: Mode=tab across all quadrants. Same destination/payment logic; UI difference only.

Each phase ships independently — merchants on later phases can adopt earlier-phase features today.
